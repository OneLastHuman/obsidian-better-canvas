import { normalizeMcpToolResult, type RemoteMcpResult } from "./mcp-result";
import {
  formatMcpPromptResult,
  formatMcpResourceRead,
  normalizeMcpPromptPage,
  normalizeMcpResourcePage,
  type McpPrompt,
  type McpResource
} from "./mcp-catalog";

export interface LocalMcpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface LocalMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function parseLocalMcpConfig(raw: string): LocalMcpServerConfig {
  if (!raw.trim()) throw new Error("请在设置中填写本地 MCP stdio 配置 JSON。");
  if (raw.length > 30_000) throw new Error("MCP stdio 配置过长。");
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("MCP stdio 配置不是有效 JSON。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.command !== "string" || !value.command.trim()) {
    throw new Error('MCP stdio 配置必须包含非空的 "command" 字符串。');
  }
  const args = value.args === undefined ? [] : value.args;
  if (!Array.isArray(args) || args.length > 64 ||
      args.some((arg: unknown) => typeof arg !== "string" || arg.length > 2000)) {
    throw new Error('"args" 必须是最多 64 项的字符串数组。');
  }
  const cwd = value.cwd === undefined ? "" : value.cwd;
  if (typeof cwd !== "string" || cwd.length > 2000) {
    throw new Error('"cwd" 必须是有效的路径字符串。');
  }
  const env = value.env === undefined ? {} : value.env;
  if (!env || typeof env !== "object" || Array.isArray(env) ||
      Object.keys(env).length > 64 ||
      Object.entries(env).some(([key, val]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof val !== "string" || val.length > 4000
      )) {
    throw new Error('"env" 必须是环境变量名到字符串值的对象。');
  }

  return {
    command: value.command.trim(),
    args: args as string[],
    cwd: cwd.trim(),
    env: env as Record<string, string>
  };
}

interface RpcEnvelope {
  id?: string;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

type PendingRpc = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const LOCAL_MCP_IDLE_TIMEOUT_MS = 5 * 60_000;
const LOCAL_MCP_REQUEST_TIMEOUT_MS = 60_000;
const LOCAL_MCP_MAX_SESSIONS = 4;
const localSessions = new Map<string, LocalMcpSession>();

/**
 * Long-lived JSON-RPC session for one explicitly configured stdio server.
 * The process is spawned without a shell, shared across commands and retired
 * after idle timeout, protocol failure, plugin unload or LRU eviction.
 */
class LocalMcpSession {
  private child: any = null;
  private startPromise: Promise<void> | null = null;
  private closed = false;
  private buffer = "";
  private stderrTail = "";
  private sequence = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pending = new Map<string, PendingRpc>();

  constructor(
    private readonly config: LocalMcpServerConfig,
    private readonly onClosed: () => void
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdleClose(): void {
    this.clearIdleTimer();
    if (this.closed || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      this.fail(new Error("Local MCP stdio session expired after five idle minutes."));
    }, LOCAL_MCP_IDLE_TIMEOUT_MS);
    (this.idleTimer as any).unref?.();
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new Error("Local MCP stdio session is closed.");
    if (!this.startPromise) {
      this.startPromise = this.startProcess().catch(error => {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
    }
    await this.startPromise;
  }

  private async startProcess(): Promise<void> {
    const [{ spawn }, { tmpdir }, processModule] = await Promise.all([
      import("node:child_process"),
      import("node:os"),
      import("node:process")
    ]);
    if (this.closed) throw new Error("Local MCP stdio session is closed.");

    try {
      this.child = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd || tmpdir(),
        env: { ...processModule.env, ...(this.config.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false
      });
    } catch (error) {
      throw new Error("无法启动 MCP stdio 服务：" + (error instanceof Error ? error.message : String(error)));
    }

    this.child.once("error", (error: Error) => {
      const message = /ENOENT/i.test(error.message)
        ? "找不到本地 MCP 命令。请确认 command 已安装，并且 Obsidian 进程可访问该程序。"
        : "无法启动 MCP stdio 服务：" + error.message;
      this.fail(new Error(message));
    });
    this.child.once("close", (code: number | null) => {
      if (this.closed) return;
      if (this.buffer.trim()) this.consumeLine(this.buffer);
      if (this.closed) return;
      this.fail(new Error(
        "MCP stdio 服务意外退出（状态码 " + String(code) + "）" +
        (this.stderrTail.trim() ? "：" + this.stderrTail.trim().slice(-3000) : "")
      ));
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      if (this.closed) return;
      this.buffer += chunk;
      if (this.buffer.length > 2_000_000) {
        this.fail(new Error("MCP stdio 输出超过 2 MB，已关闭进程。"));
        return;
      }
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? "";
      for (const line of lines) this.consumeLine(line);
    });

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-8000);
    });

    await this.sendRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
    }, 30_000);
    this.write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed || !this.child?.stdin) throw new Error("Local MCP stdio session is closed.");
    this.child.stdin.write(JSON.stringify(message) + "\n", "utf8", (error?: Error | null) => {
      if (error && !this.closed) this.fail(new Error("向 MCP stdio 写入请求失败：" + error.message));
    });
  }

  private sendRequest<T>(method: string, params: Record<string, unknown>, timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Local MCP stdio session is closed."));
    const id = "bc-stdio-" + (++this.sequence);
    return new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        // An unresolved request makes server state ambiguous. Close this session
        // so the next command starts a clean child process rather than reuse it.
        this.fail(new Error("MCP stdio 请求超时（" + Math.round(timeoutMs / 1000) + " 秒）；会话已重置。"));
      }, timeoutMs);
      (timer as any).unref?.();
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        rejectRequest(error instanceof Error ? error : new Error(String(error)));
        this.scheduleIdleClose();
      }
    });
  }

  private consumeLine(line: string): void {
    if (!line.trim() || this.closed) return;
    let message: RpcEnvelope;
    try {
      message = JSON.parse(line) as RpcEnvelope;
    } catch {
      // Servers must reserve stdout for protocol messages. Tolerate logs,
      // but do not expose them as tool results.
      return;
    }
    if (typeof message.id !== "string") return;
    const handler = this.pending.get(message.id);
    if (!handler) return;
    this.pending.delete(message.id);
    clearTimeout(handler.timer);
    if (message.error) {
      handler.reject(new Error(
        "MCP stdio 错误" +
        (message.error.code === undefined ? "" : " (" + message.error.code + ")") +
        "：" + String(message.error.message ?? JSON.stringify(message.error))
      ));
    } else if ("result" in message) {
      handler.resolve(message.result);
    } else {
      handler.reject(new Error("MCP stdio 返回了不完整的 JSON-RPC 响应。"));
    }
    this.scheduleIdleClose();
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.clearIdleTimer();
    if (this.killTimer) clearTimeout(this.killTimer);
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(error);
      this.pending.delete(id);
    }
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill("SIGTERM"); } catch { /* Process may already be gone. */ }
      this.killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch { /* Ignore exit races. */ }
        }
      }, 1200);
      (this.killTimer as any).unref?.();
    }
    this.onClosed();
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS): Promise<T> {
    await this.ensureStarted();
    if (this.closed) throw new Error("Local MCP stdio session is closed.");
    this.clearIdleTimer();
    return await this.sendRequest<T>(method, params, timeoutMs);
  }

  close(): void {
    this.fail(new Error("MCP stdio session closed by Better Canvas."));
  }
}

function localSessionKey(config: LocalMcpServerConfig): string {
  // The key exists only in memory and is never logged; env values may contain credentials.
  return JSON.stringify({
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd ?? "",
    env: config.env ?? {}
  });
}

function getLocalMcpSession(config: LocalMcpServerConfig): LocalMcpSession {
  const key = localSessionKey(config);
  const existing = localSessions.get(key);
  if (existing && !existing.isClosed) {
    // Refresh insertion order for least-recently-used session eviction.
    localSessions.delete(key);
    localSessions.set(key, existing);
    return existing;
  }
  if (existing) localSessions.delete(key);

  while (localSessions.size >= LOCAL_MCP_MAX_SESSIONS) {
    const oldest = localSessions.entries().next().value as [string, LocalMcpSession] | undefined;
    if (!oldest) break;
    localSessions.delete(oldest[0]);
    oldest[1].close();
  }

  let session: LocalMcpSession;
  session = new LocalMcpSession(config, () => {
    if (localSessions.get(key) === session) localSessions.delete(key);
  });
  localSessions.set(key, session);
  return session;
}

/** Call on plugin unload or in tests to close every cached stdio process. */
export function closeAllLocalMcpSessions(): void {
  const sessions = [...localSessions.values()];
  localSessions.clear();
  for (const session of sessions) session.close();
}

async function oneStdioRequest<T>(
  config: LocalMcpServerConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS,
  catalogKey?: "tools" | "resources" | "prompts"
): Promise<T> {
  const session = getLocalMcpSession(config);
  let result: any = await session.request<any>(method, params, timeoutMs);
  if (catalogKey) {
    if (!result || typeof result !== "object" || !Array.isArray(result[catalogKey])) {
      throw new Error("MCP stdio 没有返回有效的 " + catalogKey + " 数组。");
    }
    result = { ...result, [catalogKey]: [...result[catalogKey]] };
    const cursorSet = new Set<string>();
    let cursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
    let pageCount = 1;
    while (cursor) {
      if (cursorSet.has(cursor)) throw new Error("MCP stdio catalog 返回重复 pagination cursor。");
      cursorSet.add(cursor);
      if (++pageCount > 50) throw new Error("MCP stdio catalog 超过 50 页安全限制。");
      const page: any = await session.request<any>(method, { ...params, cursor }, timeoutMs);
      if (!Array.isArray(page?.[catalogKey])) {
        throw new Error("MCP stdio 后续页面没有返回有效的 " + catalogKey + " 数组。");
      }
      result[catalogKey].push(...page[catalogKey]);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : "";
    }
    delete result.nextCursor;
  }
  return result as T;
}

export async function listLocalMcpTools(configJson: string): Promise<LocalMcpTool[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest<any>(config, "tools/list", {}, 60_000, "tools");
  const tools = result?.tools;
  if (!Array.isArray(tools)) throw new Error("本地 MCP stdio 服务没有返回 tools 数组。");
  return tools.filter((tool: any) => typeof tool?.name === "string").map((tool: any) => ({
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {}
  }));
}

export async function callLocalMcpTool(
  configJson: string,
  name: string,
  args: Record<string, unknown>
): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!name.trim()) throw new Error("MCP tool 名称不能为空。");
  const result = await oneStdioRequest<any>(config, "tools/call", {
    name: name.trim(),
    arguments: args
  });
  if (result?.isError) throw new Error("本地 MCP 工具执行失败：" + JSON.stringify(result.content ?? result));
  return normalizeMcpToolResult(result);
}


export async function listLocalMcpResources(configJson: string): Promise<McpResource[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest<any>(config, "resources/list", {}, 60_000, "resources");
  return normalizeMcpResourcePage(result).items;
}

export async function readLocalMcpResource(configJson: string, uri: string): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!uri.trim()) throw new Error("MCP resource URI 不能为空。");
  const result = await oneStdioRequest<any>(config, "resources/read", { uri: uri.trim() });
  return formatMcpResourceRead(uri.trim(), result);
}

export async function listLocalMcpPrompts(configJson: string): Promise<McpPrompt[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest<any>(config, "prompts/list", {}, 60_000, "prompts");
  return normalizeMcpPromptPage(result).items;
}

export async function getLocalMcpPrompt(
  configJson: string,
  name: string,
  args: Record<string, string>
): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!name.trim()) throw new Error("MCP prompt 名称不能为空。");
  const result = await oneStdioRequest<any>(config, "prompts/get", {
    name: name.trim(),
    arguments: args
  });
  return formatMcpPromptResult(name.trim(), result);
}
