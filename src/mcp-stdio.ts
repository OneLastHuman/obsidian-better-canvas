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

async function oneStdioRequest<T>(
  config: LocalMcpServerConfig,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 60_000,
  catalogKey?: "tools" | "resources" | "prompts"
): Promise<T> {
  // Load Node-only modules only when the user explicitly calls stdio MCP.
  const [{ spawn }, { tmpdir }, processModule] = await Promise.all([
    import("node:child_process"),
    import("node:os"),
    import("node:process")
  ]);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let stderrTail = "";
    let sequence = 0;
    const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(config.command, config.args ?? [], {
        cwd: config.cwd || tmpdir(),
        env: { ...processModule.env, ...(config.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stopChild = () => {
      try { child.kill("SIGTERM"); } catch { /* it may have exited */ }
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }, 1200);
    };

    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      for (const item of pending.values()) {
        item.reject(error ?? new Error("MCP stdio session closed."));
      }
      pending.clear();
      stopChild();
      if (error) reject(error);
      else resolve(value as T);
    };

    const write = (message: Record<string, unknown>) => {
      if (settled) throw new Error("MCP stdio session is already closed.");
      const line = JSON.stringify(message) + "\n";
      child.stdin!.write(line, "utf8", (error?: Error | null) => {
        if (error && !settled) finish(new Error("向 MCP stdio 写入请求失败：" + error.message));
      });
    };

    const request = <R>(rpcMethod: string, rpcParams: Record<string, unknown>): Promise<R> => {
      const id = "bc-stdio-" + (++sequence);
      return new Promise<R>((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        try {
          write({ jsonrpc: "2.0", id, method: rpcMethod, params: rpcParams });
        } catch (error) {
          pending.delete(id);
          rejectRequest(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    child.once("error", (error: Error) => {
      const message = /ENOENT/i.test(error.message)
        ? "找不到本地 MCP 命令。请确认 command 已安装，并且 Obsidian 进程可访问该程序。"
        : "无法启动 MCP stdio 服务：" + error.message;
      finish(new Error(message));
    });

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 2_000_000) {
        finish(new Error("MCP stdio 输出超过 2 MB，已关闭进程。"));
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });

    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-8000);
    });

    const consumeLine = (line: string) => {
      if (!line.trim() || settled) return;
      let message: RpcEnvelope;
      try {
        message = JSON.parse(line) as RpcEnvelope;
      } catch {
        // Servers must reserve stdout for protocol messages. Tolerate logs,
        // but do not expose them as tool results.
        return;
      }
      if (typeof message.id !== "string") return;
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
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
    };

    child.once("close", (code: number | null) => {
      if (settled) return;
      if (buffer.trim()) consumeLine(buffer);
      if (settled) return;
      finish(new Error(
        "MCP stdio 服务意外退出（状态码 " + String(code) + "）" +
        (stderrTail.trim() ? "：" + stderrTail.trim().slice(-3000) : "")
      ));
    });

    timeout = setTimeout(() => {
      finish(new Error("MCP stdio 请求超时（" + Math.round(timeoutMs / 1000) + " 秒）。"));
    }, timeoutMs);

    // The child is restarted for each operation; no persistent session state is stored.
    void (async () => {
      try {
        await request("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
        });
        write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
        let result: any = await request<any>(method, params);
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
            const page: any = await request<any>(method, { ...params, cursor });
            if (!Array.isArray(page?.[catalogKey])) {
              throw new Error("MCP stdio 后续页面没有返回有效的 " + catalogKey + " 数组。");
            }
            result[catalogKey].push(...page[catalogKey]);
            cursor = typeof page.nextCursor === "string" ? page.nextCursor : "";
          }
          delete result.nextCursor;
        }
        finish(undefined, result);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
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
