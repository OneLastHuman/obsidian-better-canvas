import { normalizeMcpToolResult, type RemoteMcpResult } from "./mcp-result";
import type { RemoteMcpTool } from "./mcp";
import {
  collectMcpCatalogPages,
  formatMcpPromptResult,
  formatMcpResourceRead,
  normalizeMcpPromptPage,
  normalizeMcpResourcePage,
  type McpPrompt,
  type McpResource
} from "./mcp-catalog";

export interface SseFrame {
  event: string;
  data: string;
}

/** Split a growing Server-Sent Events buffer into complete frames. */
export function splitSseFrames(buffer: string): { frames: SseFrame[]; remainder: string } {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const chunk of chunks) {
    let event = "message";
    const data: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) frames.push({ event, data: data.join("\n") });
  }
  return { frames, remainder };
}

/** Resolve the endpoint event emitted by the legacy MCP SSE transport. */
export function resolveSsePostUrl(streamUrl: string, endpointData: string): string {
  let stream: URL;
  let target: URL;
  try {
    stream = new URL(streamUrl);
    target = new URL(endpointData.trim(), stream);
  } catch {
    throw new Error("MCP SSE endpoint event did not contain a valid URL.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("MCP SSE message endpoint must use HTTP or HTTPS.");
  }
  // Prevent an untrusted endpoint event from redirecting a configured bearer
  // token to another origin.
  if (target.origin !== stream.origin) {
    throw new Error("MCP SSE message endpoint must stay on the configured server origin.");
  }
  return target.toString();
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

export class SseMcpConnection {
  private controller = new AbortController();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private streamUrl: string;
  private apiKey: string;
  private postUrl = "";
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private stderr = "";
  private pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private endpointPromise: Promise<void>;
  private resolveEndpoint!: () => void;
  private rejectEndpoint!: (error: Error) => void;

  constructor(streamUrl: string, apiKey: string) {
    this.streamUrl = streamUrl.trim();
    this.apiKey = apiKey;
    this.endpointPromise = new Promise<void>((resolve, reject) => {
      this.resolveEndpoint = resolve;
      this.rejectEndpoint = reject;
    });
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: accept };
    if (this.apiKey.trim()) headers.Authorization = "Bearer " + this.apiKey.trim();
    return headers;
  }

  async connect(): Promise<void> {
    if (!this.streamUrl) throw new Error("请先填写远程 MCP SSE endpoint URL。");
    let parsed: URL;
    try {
      parsed = new URL(this.streamUrl);
    } catch {
      throw new Error("MCP SSE endpoint URL 格式不正确。");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("MCP SSE endpoint 必须使用 HTTP 或 HTTPS。");
    }

    const response = await this.waitFor(fetch(parsed.toString(), {
      method: "GET",
      headers: this.headers("text/event-stream"),
      signal: this.controller.signal
    }), 15_000, "MCP SSE 连接请求超时。");
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 1000);
      throw new Error("MCP SSE 连接失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
    }
    if (!response.body) throw new Error("MCP SSE 响应没有可读取的事件流。");
    this.reader = response.body.getReader();
    void this.readEvents();
    await this.waitFor(this.endpointPromise, 15_000, "MCP SSE 连接成功，但没有收到 endpoint 事件。");
  }

  private async waitFor<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(value => {
        clearTimeout(timer);
        resolve(value);
      }, error => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async readEvents(): Promise<void> {
    if (!this.reader) return;
    const decoder = new TextDecoder();
    try {
      while (!this.closed) {
        const result = await this.reader.read();
        if (result.done) break;
        this.buffer += decoder.decode(result.value, { stream: true });
        if (this.buffer.length > 2_000_000) throw new Error("MCP SSE event buffer exceeded 2 MB.");
        const parsed = splitSseFrames(this.buffer);
        this.buffer = parsed.remainder;
        for (const frame of parsed.frames) this.handleFrame(frame);
      }
      this.buffer += decoder.decode();
      if (this.buffer.trim()) {
        const final = splitSseFrames(this.buffer + "\n\n");
        for (const frame of final.frames) this.handleFrame(frame);
      }
      if (!this.closed) this.fail(new Error("MCP SSE event stream ended unexpectedly."));
    } catch (error) {
      if (!this.closed) this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleFrame(frame: SseFrame): void {
    if (frame.event === "error") {
      throw new Error("MCP SSE 服务报告错误：" + frame.data.slice(0, 1000));
    }
    if (frame.event === "endpoint") {
      try {
        this.postUrl = resolveSsePostUrl(this.streamUrl, frame.data);
        this.resolveEndpoint();
      } catch (error) {
        this.rejectEndpoint(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }
    if (frame.event !== "message" && frame.event !== "") return;

    let response: JsonRpcResponse;
    try {
      response = JSON.parse(frame.data) as JsonRpcResponse;
    } catch {
      return;
    }
    if (response.id === undefined || response.id === null) return;
    const key = String(response.id);
    const handler = this.pending.get(key);
    if (!handler) return;
    this.pending.delete(key);
    clearTimeout(handler.timer);
    if (response.error) {
      handler.reject(new Error("MCP SSE JSON-RPC 错误" +
        (response.error.code === undefined ? "" : " (" + response.error.code + ")") +
        "：" + String(response.error.message ?? JSON.stringify(response.error))));
    } else if ("result" in response) {
      handler.resolve(response.result);
    } else {
      handler.reject(new Error("MCP SSE 返回了不完整的 JSON-RPC 响应。"));
    }
  }

  private post(method: string, params: Record<string, unknown>, id?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error("MCP SSE connection is closed."));
    if (!this.postUrl) return Promise.reject(new Error("MCP SSE message endpoint 尚未就绪。"));
    const message: Record<string, unknown> = { jsonrpc: "2.0", method, params };
    if (id !== undefined) message.id = id;

    return fetch(this.postUrl, {
      method: "POST",
      headers: { ...this.headers("application/json, text/event-stream"), "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: this.controller.signal
    }).then(async response => {
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 1200);
        throw new Error("MCP SSE POST 失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
      }
      if (id !== undefined) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const body = await response.json().catch(() => null) as JsonRpcResponse | null;
          if (body && String(body.id) === id) this.handleFrame({ event: "message", data: JSON.stringify(body) });
        } else {
          // Drain any small acknowledgement body (usually 202 with no content).
          await response.text().catch(() => "");
        }
      } else {
        await response.text().catch(() => "");
      }
    });
  }

  async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.waitFor(this.post(method, params), 60_000, "MCP SSE notification 请求超时。");
  }

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.closed) throw new Error("MCP SSE connection is closed.");
    const id = "bc-sse-" + (++this.sequence);
    const resultPromise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MCP SSE 请求超时：" + method));
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    void this.post(method, params, id).catch(error => {
      const handler = this.pending.get(id);
      if (!handler) return;
      this.pending.delete(id);
      clearTimeout(handler.timer);
      handler.reject(error instanceof Error ? error : new Error(String(error)));
    });
    return await resultPromise as T;
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    void this.reader?.cancel().catch(() => undefined);
    this.rejectEndpoint(error);
    for (const handler of this.pending.values()) {
      clearTimeout(handler.timer);
      handler.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    void this.reader?.cancel().catch(() => undefined);
    const error = new Error("MCP SSE connection closed.");
    for (const handler of this.pending.values()) {
      clearTimeout(handler.timer);
      handler.reject(error);
    }
    this.pending.clear();
  }
}

async function withSse<T>(
  endpoint: string,
  apiKey: string,
  callback: (connection: SseMcpConnection) => Promise<T>
): Promise<T> {
  const connection = new SseMcpConnection(endpoint, apiKey);
  try {
    await connection.connect();
    await connection.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
    });
    await connection.notify("notifications/initialized", {});
    return await callback(connection);
  } finally {
    connection.close();
  }
}

export async function listSseMcpTools(endpoint: string, apiKey: string): Promise<RemoteMcpTool[]> {
  return await withSse(endpoint, apiKey, async connection => {
    const result = await connection.request<any>("tools/list", {});
    if (!Array.isArray(result?.tools)) throw new Error("MCP SSE 服务没有返回 tools 数组。");
    return result.tools.filter((tool: any) => typeof tool?.name === "string").map((tool: any) => ({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {}
    }));
  });
}

export async function callSseMcpTool(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<RemoteMcpResult> {
  if (!name.trim()) throw new Error("MCP tool 名称不能为空。");
  return await withSse(endpoint, apiKey, async connection => {
    const result = await connection.request<any>("tools/call", {
      name: name.trim(),
      arguments: args
    });
    if (result?.isError) throw new Error("MCP SSE 工具执行失败：" + JSON.stringify(result.content ?? result));
    return normalizeMcpToolResult(result);
  });
}


export async function listSseMcpResources(endpoint: string, apiKey: string): Promise<McpResource[]> {
  return await withSse(endpoint, apiKey, async connection => await collectMcpCatalogPages(
    async cursor => normalizeMcpResourcePage(await connection.request<any>("resources/list", cursor ? { cursor } : {})),
    resource => resource.uri
  ));
}

export async function readSseMcpResource(endpoint: string, apiKey: string, uri: string): Promise<RemoteMcpResult> {
  if (!uri.trim()) throw new Error("MCP resource URI 不能为空。");
  return await withSse(endpoint, apiKey, async connection => {
    const result = await connection.request<any>("resources/read", { uri: uri.trim() });
    return formatMcpResourceRead(uri.trim(), result);
  });
}

export async function listSseMcpPrompts(endpoint: string, apiKey: string): Promise<McpPrompt[]> {
  return await withSse(endpoint, apiKey, async connection => await collectMcpCatalogPages(
    async cursor => normalizeMcpPromptPage(await connection.request<any>("prompts/list", cursor ? { cursor } : {})),
    prompt => prompt.name
  ));
}

export async function getSseMcpPrompt(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, string>
): Promise<RemoteMcpResult> {
  if (!name.trim()) throw new Error("MCP prompt 名称不能为空。");
  return await withSse(endpoint, apiKey, async connection => {
    const result = await connection.request<any>("prompts/get", { name: name.trim(), arguments: args });
    return formatMcpPromptResult(name.trim(), result);
  });
}
