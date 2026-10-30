import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveAgentBinary } from "./local-agent-discovery";
import { loadNodeRuntimeModules } from "./node-runtime";

export interface ACPChatMessage {
  role: string;
  content: unknown;
}

export interface OpenCodeACPOptions {
  binaryPath?: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

type ACPRequest = (method: string, params: Record<string, unknown>) => Promise<any>;

interface ACPModelCatalog {
  options: Array<{ id: string; name: string }>;
  configId?: string;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  method: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: any) => {
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    if (part?.type === "image_url") return "[image attached in the original message]";
    if (part?.type === "file_data") return "[file attached in the original message]";
    return "";
  }).filter(Boolean).join("\n");
}

/** ACP has one prompt content field instead of separate chat roles, so preserve roles explicitly. */
export function buildACPUserPrompt(messages: ACPChatMessage[]): string {
  const labels: Record<string, string> = {
    system: "System instructions",
    user: "User",
    assistant: "Previous assistant response"
  };
  return messages.map(message => {
    const text = contentText(message.content).trim();
    if (!text) return "";
    return "[" + (labels[message.role] || message.role) + "]\n" + text;
  }).filter(Boolean).join("\n\n");
}

/** True when text-only ACP would silently lose image or file context. */
export function hasUnsupportedACPContent(messages: ACPChatMessage[]): boolean {
  return messages.some(message =>
    Array.isArray(message.content) &&
    message.content.some((part: any) => part && typeof part === "object" && part.type !== "text")
  );
}

/** Extract user-visible answer chunks; ignore tool progress and unrelated sessions. */
export function textFromACPUpdate(value: unknown, expectedSessionId?: string): string {
  const message = value as JsonRpcMessage | null;
  if (!message || message.method !== "session/update" || !message.params) return "";
  if (expectedSessionId && message.params.sessionId && message.params.sessionId !== expectedSessionId) return "";
  const update = message.params.update;
  if (!update || update.sessionUpdate !== "agent_message_chunk") return "";
  if (update.content?.type === "text" && typeof update.content.text === "string") return update.content.text;
  return "";
}

function abortError(): Error {
  const error = new Error("OpenCode ACP generation was cancelled.");
  error.name = "AbortError";
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelCatalog(session: any): ACPModelCatalog {
  const configuration = Array.isArray(session?.configOptions)
    ? session.configOptions.find((option: any) =>
      option?.type === "select" &&
      (option.category === "model" || (!option.category && option.id === "model"))
    )
    : undefined;
  const entries: any[] = [];
  if (configuration) {
    if (typeof configuration.id !== "string" || !configuration.id.trim() || !Array.isArray(configuration.options)) {
      throw new Error("OpenCode ACP 返回了无效的模型配置。");
    }
    for (const option of configuration.options) {
      if (option && typeof option.group === "string" && Array.isArray(option.options)) {
        entries.push(...option.options);
      } else {
        entries.push(option);
      }
    }
  } else if (Array.isArray(session?.models?.availableModels)) {
    entries.push(...session.models.availableModels);
  }

  const models = new Map<string, { id: string; name: string }>();
  for (const entry of entries) {
    const id = configuration ? entry?.value : entry?.modelId;
    if (typeof id !== "string" || !id.trim()) continue;
    if (!models.has(id)) {
      models.set(id, { id, name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id });
    }
  }
  if (models.size === 0) {
    throw new Error("OpenCode ACP 没有提供可选择的模型。请检查 OpenCode 的模型配置或更新 OpenCode。");
  }
  return { options: [...models.values()], configId: configuration?.id };
}

async function selectSessionModel(session: any, model: string, request: ACPRequest): Promise<void> {
  const catalog = modelCatalog(session);
  if (!catalog.options.some(option => option.id === model)) {
    throw new Error("OpenCode ACP 当前未提供所选模型：" + model + "。请在设置中刷新模型列表后重新选择。");
  }
  if (catalog.configId) {
    const result = await request("session/set_config_option", {
      sessionId: session.sessionId,
      configId: catalog.configId,
      value: model
    });
    const confirmed = Array.isArray(result?.configOptions) && result.configOptions.some((option: any) =>
      option?.id === catalog.configId && option.currentValue === model
    );
    if (!confirmed) throw new Error("OpenCode ACP 未确认应用所选模型，已停止生成。");
  } else {
    await request("session/set_model", { sessionId: session.sessionId, modelId: model });
  }
}

/** Discover the installed agent's catalog without submitting a generation prompt. */
export async function listOpenCodeModels(
  options: Pick<OpenCodeACPOptions, "binaryPath" | "timeoutMs" | "signal"> = {}
): Promise<Array<{ id: string; name: string }>> {
  return withOpenCodeSession(
    { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
    async session => modelCatalog(session).options,
    true
  );
}

export async function runOpenCodeACP(
  messages: ACPChatMessage[],
  options: OpenCodeACPOptions = {}
): Promise<string> {
  const prompt = buildACPUserPrompt(messages);
  if (!prompt.trim()) throw new Error("没有可发送给 OpenCode ACP 的文本内容。");
  return withOpenCodeSession(options, async (session, request, answer) => {
    const model = options.model?.trim();
    if (model) await selectSessionModel(session, model, request);

    const result = await request("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: prompt }]
    });
    if (result?.stopReason === "cancelled" || options.signal?.aborted) throw abortError();
    if (result?.stopReason === "error") {
      throw new Error("OpenCode ACP 生成失败。" + (result?.error?.message ? " " + result.error.message : ""));
    }
    if (!answer().trim()) throw new Error("OpenCode ACP 结束了请求，但没有返回可显示的文本内容。");
    return answer().trim();
  });
}

/**
 * Run OpenCode as an ACP subprocess. The temp working directory deliberately
 * avoids exposing the Vault or an active project as the agent's workspace.
 */
async function withOpenCodeSession<T>(
  options: OpenCodeACPOptions,
  action: (session: any, request: ACPRequest, answer: () => string) => Promise<T>,
  deleteSessionAfterwards = false
): Promise<T> {
  if (options.signal?.aborted) throw abortError();

  const runtime = await loadNodeRuntimeModules();
  const { spawn } = runtime.childProcess;
  const { tmpdir } = runtime.os;
  if (options.signal?.aborted) throw abortError();

  const binary = resolveAgentBinary(options.binaryPath, "opencode", runtime);
  // cmd.exe needs the executable quoted when its path contains spaces.
  const launch = runtime.process.platform === "win32" && /\s/.test(binary) ? '"' + binary + '"' : binary;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 300_000, 10_000), 900_000);

  return await new Promise<T>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch, ["acp"], {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        // OpenCode is commonly installed as opencode.cmd on Windows.
        shell: runtime.process.platform === "win32"
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let stdoutBuffer = "";
    let stderrTail = "";
    let answer = "";
    let nextId = 0;
    let activeSessionId = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<string, PendingRequest>();

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill("SIGTERM"); } catch { /* child may have exited */ }
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }, 1500);
      killTimer.unref?.();
    };

    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) {
        for (const request of pending.values()) request.reject(error);
        pending.clear();
      }
      try { child.stdin.end(); } catch { /* stdin may already be closed */ }
      terminate();
      if (error) reject(error);
      else resolve(result as T);
    };

    const send = (message: Record<string, unknown>) => {
      if (settled || child.stdin.destroyed || !child.stdin.writable) {
        throw new Error("OpenCode ACP 的标准输入已经关闭。");
      }
      child.stdin.write(JSON.stringify(message) + "\n");
    };

    const notify = (method: string, params: Record<string, unknown>) => {
      try { send({ jsonrpc: "2.0", method, params }); } catch { /* process is terminating */ }
    };

    const request = (method: string, params: Record<string, unknown>): Promise<any> => {
      const id = ++nextId;
      return new Promise((requestResolve, requestReject) => {
        pending.set(String(id), { method, resolve: requestResolve, reject: requestReject });
        try {
          send({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          pending.delete(String(id));
          requestReject(new Error(errorMessage(error)));
        }
      });
    };

    const rejectPermission = (message: JsonRpcMessage) => {
      const choices = Array.isArray(message.params?.options) ? message.params.options : [];
      const rejectOption = choices.find((item: any) =>
        typeof item?.optionId === "string" && (item.kind === "reject_once" || item.kind === "reject_always")
      );
      // ACP v1 wraps the selected/cancelled outcome in an outcome object.
      const result = rejectOption
        ? { outcome: { outcome: "selected", optionId: rejectOption.optionId } }
        : { outcome: { outcome: "cancelled" } };
      try { send({ jsonrpc: "2.0", id: message.id, result }); } catch { /* process is terminating */ }
    };

    const consumeLine = (line: string) => {
      if (!line.trim() || settled) return;
      let message: JsonRpcMessage;
      try { message = JSON.parse(line) as JsonRpcMessage; } catch { return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) return;

      if (message.id !== undefined && !message.method) {
        const entry = pending.get(String(message.id));
        if (!entry) return;
        pending.delete(String(message.id));
        if (message.error) {
          const detail = message.error.message || "未知的 ACP 错误";
          const authHint = /auth_required|authentication|required.*auth/i.test(detail)
            ? "；请先在终端运行 opencode auth login"
            : "";
          entry.reject(new Error("OpenCode ACP " + entry.method + " 失败：" + detail + authHint));
        } else {
          entry.resolve(message.result ?? {});
        }
        return;
      }

      if (message.method === "session/update") {
        const delta = textFromACPUpdate(message, activeSessionId);
        if (delta) {
          answer += delta;
          if (answer.length > 2_000_000) {
            finish(new Error("OpenCode ACP 输出超过 2 MB，已终止以保护内存。"));
            return;
          }
          try { options.onDelta?.(delta); } catch { /* keep protocol handling isolated from UI callbacks */ }
        }
        return;
      }

      if (message.method === "session/request_permission" && message.id !== undefined) {
        // This client has no interactive permission UI; decline tool and file operations by default.
        rejectPermission(message);
        return;
      }

      if (message.method && message.id !== undefined) {
        try {
          send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not supported by Better Canvas ACP client" }
          });
        } catch { /* process is terminating */ }
      }
    };

    const onAbort = () => {
      if (activeSessionId) notify("session/cancel", { sessionId: activeSessionId });
      finish(abortError());
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      finish(new Error("OpenCode ACP 超时（" + Math.round(timeoutMs / 1000) + " 秒）。"));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      if (stdoutBuffer.length > 2_000_000) {
        finish(new Error("OpenCode ACP 协议输出过大，已终止以保护内存。"));
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-8000);
    });

    child.once("error", (error: Error) => {
      const hint = /ENOENT/i.test(error.message)
        ? "找不到 OpenCode CLI。请安装 OpenCode，或在设置中点击「查找」自动定位，或填写 opencode 可执行文件的绝对路径。"
        : "无法启动 OpenCode ACP：" + error.message;
      finish(new Error(hint));
    });

    child.once("close", (code: number | null, signalName: string | null) => {
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      const detail = stderrTail.trim();
      const suffix = detail ? "；stderr：" + detail.slice(-1200) : "";
      finish(new Error("OpenCode ACP 进程已退出（code=" + String(code) + ", signal=" + String(signalName) + "）" + suffix));
    });

    child.stdin.once("error", (error: Error) => {
      finish(new Error("无法向 OpenCode ACP 发送请求：" + error.message));
    });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    void (async () => {
      try {
        const init = await request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
        });
        if (init?.protocolVersion !== 1) throw new Error("OpenCode ACP 返回了不兼容的协议版本。");

        const session = await request("session/new", { cwd: tmpdir(), mcpServers: [] });
        if (typeof session?.sessionId !== "string" || !session.sessionId) {
          throw new Error("OpenCode ACP 没有返回有效的 sessionId。");
        }
        activeSessionId = session.sessionId;

        let result: T | undefined;
        let actionError: Error | undefined;
        try {
          result = await action(session, request, () => answer);
        } catch (error) {
          actionError = new Error(errorMessage(error));
        } finally {
          const deleteCapability = init?.agentCapabilities?.sessionCapabilities?.delete;
          // Model discovery creates no conversation; remove its empty history entry when supported.
          if (deleteSessionAfterwards && !settled && deleteCapability &&
              typeof deleteCapability === "object" && !Array.isArray(deleteCapability)) {
            try {
              await request("session/delete", { sessionId: activeSessionId });
            } catch (error) {
              const detail = "无法删除模型列表查询创建的临时会话，OpenCode 历史可能保留一个空会话：" + errorMessage(error);
              actionError = new Error(actionError ? actionError.message + "；" + detail : detail);
            }
          }
        }
        if (actionError) throw actionError;
        finish(undefined, result);
      } catch (error) {
        if (options.signal?.aborted) finish(abortError());
        else finish(new Error(errorMessage(error)));
      }
    })();
  });
}
