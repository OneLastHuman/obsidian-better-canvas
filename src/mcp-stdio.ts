import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
import { isJsonObject } from "./prompt-input";
import { normalizeMcpToolResult, type RemoteMcpResult } from "./mcp-result";
import {
  formatMcpPromptResult,
  formatMcpResourceRead,
  normalizeMcpPromptPage,
  normalizeMcpResourcePage,
  normalizeMcpTools,
  type McpPrompt,
  type McpResource
} from "./mcp-catalog";
import { t } from "./i18n";
import { loadNodeRuntimeModules } from "./node-runtime";

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
  if (!raw.trim()) throw new Error(t("Enter the local MCP stdio configuration JSON in settings.", "请在设置中填写本地 MCP stdio 配置 JSON。"));
  if (raw.length > 30_000) throw new Error(t("The MCP stdio configuration is too long.", "MCP stdio 配置过长。"));
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(t("The MCP stdio configuration is not valid JSON.", "MCP stdio 配置不是有效 JSON。"));
  }
  if (!isJsonObject(value) || typeof value.command !== "string" || !value.command.trim()) {
    throw new Error(t('The MCP stdio configuration must include a non-empty "command" string.', 'MCP stdio 配置必须包含非空的 "command" 字符串。'));
  }
  const args = value.args === undefined ? [] : value.args;
  if (!Array.isArray(args) || args.length > 64 ||
      !args.every((arg: unknown): arg is string => typeof arg === "string" && arg.length <= 2000)) {
    throw new Error(t('"args" must be an array of at most 64 strings.', '"args" 必须是最多 64 项的字符串数组。'));
  }
  const cwd = value.cwd === undefined ? "" : value.cwd;
  if (typeof cwd !== "string" || cwd.length > 2000) {
    throw new Error(t('"cwd" must be a valid path string.', '"cwd" 必须是有效的路径字符串。'));
  }
  const rawEnv = value.env === undefined ? {} : value.env;
  if (!isJsonObject(rawEnv) || Object.keys(rawEnv).length > 64) {
    throw new Error(t('"env" must be an object mapping environment variable names to string values.', '"env" 必须是环境变量名到字符串值的对象。'));
  }
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawEnv)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof val !== "string" || val.length > 4000) {
      throw new Error(t('"env" must be an object mapping environment variable names to string values.', '"env" 必须是环境变量名到字符串值的对象。'));
    }
    env[key] = val;
  }

  return {
    command: value.command.trim(),
    args,
    cwd: cwd.trim(),
    env
  };
}


type PendingRpc = {
  resolve: (value: unknown) => void;
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
  private child: ChildProcessWithoutNullStreams | null = null;
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
    this.idleTimer.unref();
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
    const runtime = await loadNodeRuntimeModules();
    const { spawn } = runtime.childProcess;
    const { tmpdir } = runtime.os;
    const processModule = runtime.process;
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
      throw new Error(t("Could not start the MCP stdio server: ", "无法启动 MCP stdio 服务：") + (error instanceof Error ? error.message : String(error)));
    }

    this.child.once("error", (error: Error) => {
      const message = /ENOENT/i.test(error.message)
        ? t("Local MCP command not found. Make sure command is installed and accessible to the Obsidian process.", "找不到本地 MCP 命令。请确认 command 已安装，并且 Obsidian 进程可访问该程序。")
        : t("Could not start the MCP stdio server: ", "无法启动 MCP stdio 服务：") + error.message;
      this.fail(new Error(message));
    });
    this.child.once("close", (code: number | null) => {
      if (this.closed) return;
      if (this.buffer.trim()) this.consumeLine(this.buffer);
      if (this.closed) return;
      this.fail(new Error(
        t("MCP stdio server exited unexpectedly (exit code " + String(code) + ")", "MCP stdio 服务意外退出（状态码 " + String(code) + "）") +
        (this.stderrTail.trim() ? ": " + this.stderrTail.trim().slice(-3000) : "")
      ));
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      if (this.closed) return;
      this.buffer += chunk;
      if (this.buffer.length > 2_000_000) {
        this.fail(new Error(t("MCP stdio output exceeded 2 MB; the process was closed.", "MCP stdio 输出超过 2 MB，已关闭进程。")));
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
      if (error && !this.closed) this.fail(new Error(t("Failed to write the request to MCP stdio: ", "向 MCP stdio 写入请求失败：") + error.message));
    });
  }

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Local MCP stdio session is closed."));
    const id = "bc-stdio-" + (++this.sequence);
    return new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        // An unresolved request makes server state ambiguous. Close this session
        // so the next command starts a clean child process rather than reuse it.
        this.fail(new Error(t("MCP stdio request timed out (" + Math.round(timeoutMs / 1000) + "s); the session was reset.", "MCP stdio 请求超时（" + Math.round(timeoutMs / 1000) + " 秒）；会话已重置。")));
      }, timeoutMs);
      timer.unref();
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
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Servers must reserve stdout for protocol messages. Tolerate logs,
      // but do not expose them as tool results.
      return;
    }
    if (!isJsonObject(message) || typeof message.id !== "string") return;
    const handler = this.pending.get(message.id);
    if (!handler) return;
    this.pending.delete(message.id);
    clearTimeout(handler.timer);
    if (message.error) {
      const error = message.error;
      const code = isJsonObject(error) && typeof error.code === "number" ? " (" + error.code + ")" : "";
      const detail = isJsonObject(error) && typeof error.message === "string" ? error.message : JSON.stringify(error);
      handler.reject(new Error(t("MCP stdio error", "MCP stdio 错误") + code + ": " + detail));
    } else if ("result" in message) {
      handler.resolve(message.result);
    } else {
      handler.reject(new Error(t("MCP stdio returned an incomplete JSON-RPC response.", "MCP stdio 返回了不完整的 JSON-RPC 响应。")));
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
      this.killTimer.unref();
    }
    this.onClosed();
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    await this.ensureStarted();
    if (this.closed) throw new Error("Local MCP stdio session is closed.");
    this.clearIdleTimer();
    return await this.sendRequest(method, params, timeoutMs);
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
    const oldest = localSessions.entries().next().value;
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

const LOCAL_MCP_CATALOG_MAX_PAGES = 50;
const LOCAL_MCP_CATALOG_MAX_ENTRIES = 1000;

function catalogEntryKey(
  item: unknown,
  catalogKey: "tools" | "resources" | "prompts"
): string | undefined {
  if (!isJsonObject(item)) return undefined;
  const value = catalogKey === "resources" ? item.uri : item.name;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deduplicateCatalogEntries(
  items: unknown[],
  catalogKey: "tools" | "resources" | "prompts"
): unknown[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = catalogEntryKey(item, catalogKey);
    // Keep malformed entries here so the established catalog normalizers can
    // discard them consistently after pagination has completed.
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function oneStdioRequest(
  config: LocalMcpServerConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = LOCAL_MCP_REQUEST_TIMEOUT_MS,
  catalogKey?: "tools" | "resources" | "prompts"
): Promise<unknown> {
  const session = getLocalMcpSession(config);
  const result = await session.request(method, params, timeoutMs);
  if (!catalogKey) return result;
  if (!isJsonObject(result)) {
    throw new Error(t("MCP stdio did not return a valid " + catalogKey + " array.", "MCP stdio 没有返回有效的 " + catalogKey + " 数组。"));
  }
  const firstEntries = result[catalogKey];
  if (!Array.isArray(firstEntries)) {
    throw new Error(t("MCP stdio did not return a valid " + catalogKey + " array.", "MCP stdio 没有返回有效的 " + catalogKey + " 数组。"));
  }
  let receivedEntryCount = firstEntries.length;
  if (receivedEntryCount > LOCAL_MCP_CATALOG_MAX_ENTRIES) {
    throw new Error("MCP stdio catalog exceeded the 1000-entry safety limit.");
  }
  let entries = deduplicateCatalogEntries(firstEntries, catalogKey);
  const cursorSet = new Set<string>();
  let cursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
  let pageCount = 1;
  while (cursor) {
    if (cursorSet.has(cursor)) throw new Error(t("MCP stdio catalog returned a repeated pagination cursor.", "MCP stdio catalog 返回重复 pagination cursor。"));
    cursorSet.add(cursor);
    if (++pageCount > LOCAL_MCP_CATALOG_MAX_PAGES) {
      throw new Error(t("MCP stdio catalog exceeded the 50-page safety limit.", "MCP stdio catalog 超过 50 页安全限制。"));
    }
    const page = await session.request(method, { ...params, cursor }, timeoutMs);
    const pageEntries = isJsonObject(page) ? page[catalogKey] : undefined;
    if (!isJsonObject(page) || !Array.isArray(pageEntries)) {
      throw new Error(t("An MCP stdio follow-up page did not return a valid " + catalogKey + " array.", "MCP stdio 后续页面没有返回有效的 " + catalogKey + " 数组。"));
    }
    receivedEntryCount += pageEntries.length;
    if (receivedEntryCount > LOCAL_MCP_CATALOG_MAX_ENTRIES) {
      throw new Error("MCP stdio catalog exceeded the 1000-entry safety limit.");
    }
    const nextEntries: unknown[] = pageEntries;
    entries = deduplicateCatalogEntries([...entries, ...nextEntries], catalogKey);
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : "";
  }
  const combined = { ...result, [catalogKey]: entries };
  delete combined.nextCursor;
  return combined;
}

export async function listLocalMcpTools(configJson: string): Promise<LocalMcpTool[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest(config, "tools/list", {}, 60_000, "tools");
  const tools = isJsonObject(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) throw new Error(t("The local MCP stdio server did not return a tools array.", "本地 MCP stdio 服务没有返回 tools 数组。"));
  return normalizeMcpTools(tools);
}

export async function callLocalMcpTool(
  configJson: string,
  name: string,
  args: Record<string, unknown>
): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!name.trim()) throw new Error(t("MCP tool name cannot be empty.", "MCP tool 名称不能为空。"));
  const result = await oneStdioRequest(config, "tools/call", {
    name: name.trim(),
    arguments: args
  });
  if (isJsonObject(result) && result.isError) throw new Error(t("Local MCP tool call failed: ", "本地 MCP 工具执行失败：") + JSON.stringify(result.content ?? result));
  return normalizeMcpToolResult(result);
}


export async function listLocalMcpResources(configJson: string): Promise<McpResource[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest(config, "resources/list", {}, 60_000, "resources");
  return normalizeMcpResourcePage(result).items;
}

export async function readLocalMcpResource(configJson: string, uri: string): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!uri.trim()) throw new Error(t("MCP resource URI cannot be empty.", "MCP resource URI 不能为空。"));
  const result = await oneStdioRequest(config, "resources/read", { uri: uri.trim() });
  return formatMcpResourceRead(uri.trim(), result);
}

export async function listLocalMcpPrompts(configJson: string): Promise<McpPrompt[]> {
  const config = parseLocalMcpConfig(configJson);
  const result = await oneStdioRequest(config, "prompts/list", {}, 60_000, "prompts");
  return normalizeMcpPromptPage(result).items;
}

export async function getLocalMcpPrompt(
  configJson: string,
  name: string,
  args: Record<string, string>
): Promise<RemoteMcpResult> {
  const config = parseLocalMcpConfig(configJson);
  if (!name.trim()) throw new Error(t("MCP prompt name cannot be empty.", "MCP prompt 名称不能为空。"));
  const result = await oneStdioRequest(config, "prompts/get", {
    name: name.trim(),
    arguments: args
  });
  return formatMcpPromptResult(name.trim(), result);
}
