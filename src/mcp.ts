import { requestUrl, type RequestUrlResponse } from "obsidian";
import { normalizeMcpToolResult, type RemoteMcpResult } from "./mcp-result";
import { isJsonObject } from "./prompt-input";
import { t } from "./i18n";
import {
  collectMcpCatalogPages,
  formatMcpPromptResult,
  formatMcpResourceRead,
  normalizeMcpPromptPage,
  normalizeMcpResourcePage,
  normalizeMcpTools,
  type McpPrompt,
  type McpResource
} from "./mcp-catalog";
export { normalizeMcpToolResult } from "./mcp-result";
export type { RemoteMcpImage, RemoteMcpResult } from "./mcp-result";

export interface RemoteMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function parseResponse(response: RequestUrlResponse): unknown {
  const json: unknown = response.json;
  if (json && typeof json === "object") return json;
  const body = response.text;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    const dataLine = body.split("\n").find(line => line.startsWith("data:"));
    if (dataLine) {
      try {
        const parsed: unknown = JSON.parse(dataLine.slice(5).trim());
        return parsed;
      } catch { /* continue */ }
    }
  }
  return body;
}

async function rpc(
  endpoint: string,
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<{ body: unknown; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (apiKey.trim()) headers.Authorization = "Bearer " + apiKey.trim();
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const notification = method.startsWith("notifications/");
  const message: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params,
    ...(notification ? {} : { id: "better-canvas-" + Math.random().toString(16).slice(2) })
  };
  const response = await requestUrl({
    url: endpoint.trim(),
    method: "POST",
    headers,
    body: JSON.stringify(message),
    throw: false
  });
  const body = parseResponse(response);
  const record = isJsonObject(body) ? body : {};
  const error = record.error;
  const errorMessage = isJsonObject(error) ? error.message : undefined;
  if (response.status < 200 || response.status >= 300) {
    const detail = errorMessage ?? record.message ?? response.text;
    throw new Error(t("MCP request failed (HTTP " + response.status + ")", "MCP 请求失败（HTTP " + response.status + "）") +
      (detail ? ": " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  }
  if (error) throw new Error(t("MCP error: ", "MCP 错误: ") +
    (typeof errorMessage === "string" ? errorMessage : JSON.stringify(error)));
  return { body: record.result ?? body, sessionId: response.headers["mcp-session-id"] ?? sessionId };
}

async function initialize(endpoint: string, apiKey: string): Promise<{ sessionId?: string }> {
  const init = await rpc(endpoint, apiKey, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
  });
  await rpc(endpoint, apiKey, "notifications/initialized", {}, init.sessionId);
  return { sessionId: init.sessionId };
}

export async function listRemoteTools(endpoint: string, apiKey: string): Promise<RemoteMcpTool[]> {
  if (!endpoint.trim()) throw new Error(t("Set the MCP Streamable HTTP endpoint in settings first.", "请先在设置中填写 MCP Streamable HTTP endpoint。"));
  const init = await initialize(endpoint, apiKey);
  const result = await rpc(endpoint, apiKey, "tools/list", {}, init.sessionId);
  const tools = isJsonObject(result.body) ? result.body.tools : undefined;
  if (!Array.isArray(tools)) throw new Error(t("The MCP server did not return a tools array.", "MCP 服务没有返回 tools 数组。"));
  return normalizeMcpTools(tools);
}

export async function callRemoteTool(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<RemoteMcpResult> {
  if (!endpoint.trim()) throw new Error(t("Set the MCP Streamable HTTP endpoint in settings first.", "请先在设置中填写 MCP Streamable HTTP endpoint。"));
  if (!name.trim()) throw new Error(t("MCP tool name cannot be empty.", "MCP tool 名称不能为空。"));
  const init = await initialize(endpoint, apiKey);
  const result = await rpc(endpoint, apiKey, "tools/call", {
    name: name.trim(),
    arguments: args
  }, init.sessionId);
  const value = result.body;
  if (isJsonObject(value) && value.isError) throw new Error(t("MCP tool call failed: ", "MCP 工具执行失败: ") + JSON.stringify(value.content ?? value));
  return normalizeMcpToolResult(value);
}


async function remoteCatalog<T>(
  endpoint: string,
  apiKey: string,
  method: string,
  normalizePage: (value: unknown) => { items: T[]; nextCursor?: string },
  keyOf: (item: T) => string
): Promise<T[]> {
  if (!endpoint.trim()) throw new Error(t("Set the MCP Streamable HTTP endpoint in settings first.", "请先在设置中填写 MCP Streamable HTTP endpoint。"));
  const init = await initialize(endpoint, apiKey);
  let sessionId = init.sessionId;
  return await collectMcpCatalogPages(async cursor => {
    const response = await rpc(endpoint, apiKey, method, cursor ? { cursor } : {}, sessionId);
    sessionId = response.sessionId;
    return normalizePage(response.body);
  }, keyOf);
}

export async function listRemoteResources(endpoint: string, apiKey: string): Promise<McpResource[]> {
  return await remoteCatalog(endpoint, apiKey, "resources/list", normalizeMcpResourcePage, item => item.uri);
}

export async function readRemoteResource(endpoint: string, apiKey: string, uri: string): Promise<RemoteMcpResult> {
  if (!endpoint.trim()) throw new Error(t("Set the MCP Streamable HTTP endpoint in settings first.", "请先在设置中填写 MCP Streamable HTTP endpoint。"));
  if (!uri.trim()) throw new Error(t("MCP resource URI cannot be empty.", "MCP resource URI 不能为空。"));
  const init = await initialize(endpoint, apiKey);
  const response = await rpc(endpoint, apiKey, "resources/read", { uri: uri.trim() }, init.sessionId);
  return formatMcpResourceRead(uri.trim(), response.body);
}

export async function listRemotePrompts(endpoint: string, apiKey: string): Promise<McpPrompt[]> {
  return await remoteCatalog(endpoint, apiKey, "prompts/list", normalizeMcpPromptPage, item => item.name);
}

export async function getRemotePrompt(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, string>
): Promise<RemoteMcpResult> {
  if (!endpoint.trim()) throw new Error(t("Set the MCP Streamable HTTP endpoint in settings first.", "请先在设置中填写 MCP Streamable HTTP endpoint。"));
  if (!name.trim()) throw new Error(t("MCP prompt name cannot be empty.", "MCP prompt 名称不能为空。"));
  const init = await initialize(endpoint, apiKey);
  const response = await rpc(endpoint, apiKey, "prompts/get", {
    name: name.trim(),
    arguments: args
  }, init.sessionId);
  return formatMcpPromptResult(name.trim(), response.body);
}
