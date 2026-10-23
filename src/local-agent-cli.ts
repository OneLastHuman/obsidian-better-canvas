import type { ChatMessage } from "./ai";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { loadNodeRuntimeModules, type NodeRuntimeModules } from "./node-runtime";
import type { AdditionalAgentBackend } from "./local-agent-settings";

export type { AdditionalAgentBackend } from "./local-agent-settings";

export interface LocalAgentOptions {
  backend: AdditionalAgentBackend;
  binaryPath?: string;
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
}

const MAX_OUTPUT = 4_000_000;
const MAX_PROMPT = 1_000_000;
const BINARIES: Record<AdditionalAgentBackend, string> = {
  "claude-code": "claude",
  "cursor-agent": "cursor-agent",
  "gemini-cli": "gemini",
  "copilot-cli": "copilot",
  "qwen-code": "qwen",
  aider: "aider",
  bob: "bob"
};

function abortError(): Error {
  const error = new Error("Local agent generation was cancelled.");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function buildPrompt(messages: ChatMessage[]): string {
  const turns = messages.map(message => {
    const content = typeof message.content === "string"
      ? message.content
      : message.content.map(part => {
        if (part.type !== "text") {
          throw new Error("This local agent backend supports text only. Use an API backend for image or file input.");
        }
        return part.text;
      }).join("\n");
    return message.role.toUpperCase() + ":\n" + content;
  });
  const prompt = [
    "Answer the following conversation using only the supplied text.",
    "Return the requested answer directly. Do not use tools, inspect files, or change the filesystem.",
    ...turns
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT) throw new Error("Local agent prompt exceeds the 1 MB limit.");
  return prompt;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text).join("");
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value.slice(-3000);
  const detail = object(value);
  if (typeof detail.message === "string") return detail.message.slice(-3000);
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join("\n").slice(-3000);
  return "The CLI reported an unsuccessful result.";
}

/** CLI events are deliberately buffered: only a successful assistant answer leaves this module. */
class AgentOutput {
  private pending = "";
  private total = 0;
  private assistant = "";
  private partial = "";
  private final: string | undefined;
  private failed = "";
  private copilotCall = "";
  private copilotChunkCount = 0;
  private copilotChunks = new Map<number, string>();

  constructor(private backend: AdditionalAgentBackend) {}

  write(chunk: string): void {
    this.total += chunk.length;
    if (this.total > MAX_OUTPUT) throw new Error("Local agent output exceeds the 4 MB limit.");
    // Aider's stdout includes reasoning, banners and token reports. Its answer is read separately.
    if (this.backend === "aider") return;
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.consume(line);
  }

  finish(): string {
    if (this.pending.trim()) this.consume(this.pending);
    if (this.failed) throw new Error("Local agent failed: " + this.failed);
    if (this.copilotChunkCount && this.copilotChunks.size !== this.copilotChunkCount) {
      throw new Error("Copilot CLI exited with an incomplete assistant response.");
    }
    const answer = (this.final ?? (this.assistant || this.partial)).trim();
    if (!answer) throw new Error("The local agent exited without a usable assistant response. Check its version and authentication.");
    return answer;
  }

  private consume(line: string): void {
    if (!line.trim()) return;
    let event: JsonObject;
    try { event = object(JSON.parse(line)); } catch { return; }
    const data = object(event.data);
    if (event.type === "session.error") {
      this.failed = errorText(data);
      return;
    }
    if (event.type === "error" && event.severity !== "warning") {
      this.failed = errorText(event.error ?? event.message ?? event);
      return;
    }
    if (event.type === "result") {
      if (event.is_error || event.status === "error" || String(event.subtype ?? "").startsWith("error")) {
        this.failed = errorText(event.error ?? event.errors ?? event.result ?? event.last_message);
      } else {
        const value = this.backend === "bob" ? event.last_message : event.result;
        if (typeof value === "string") this.final = value;
      }
      return;
    }
    if (this.backend === "copilot-cli") {
      // SDK-compatible CLI events distinguish assistant text from reasoning and subagent messages.
      if (event.agentId || data.parentToolCallId) return;
      if (event.type === "assistant.message" && typeof data.content === "string") {
        const index = data.chunkIndex;
        const count = data.chunkCount;
        if (typeof data.apiCallId === "string" && typeof index === "number" && Number.isInteger(index) &&
            typeof count === "number" && Number.isInteger(count) && index >= 0 && index < count) {
          if (this.copilotCall !== data.apiCallId) this.copilotChunks.clear();
          this.copilotCall = data.apiCallId;
          this.copilotChunkCount = count;
          this.copilotChunks.set(index, data.content);
          this.assistant = [...this.copilotChunks].sort(([a], [b]) => a - b).map(([, text]) => text).join("");
        } else {
          this.copilotChunkCount = 0;
          this.copilotCall = "";
          this.copilotChunks.clear();
          this.assistant = data.content;
        }
      } else if (event.type === "assistant.message_delta" && typeof data.deltaContent === "string") {
        this.partial += data.deltaContent;
      }
      return;
    }
    if (this.backend === "gemini-cli" || this.backend === "bob") {
      if (event.type !== "message" || event.role !== "assistant" || event.isReasoning) return;
      const text = textContent(event.content);
      if (event.delta) this.partial += text;
      else this.assistant = text;
      return;
    }
    if (event.type === "assistant" && !event.parent_tool_use_id) {
      const message = object(event.message);
      if (!message.role || message.role === "assistant") this.assistant = textContent(message.content);
    }
    if (event.type === "stream_event") {
      const inner = object(event.event);
      const delta = object(inner.delta);
      if (inner.type === "content_block_delta" && delta.type === "text_delta" && typeof delta.text === "string") {
        this.partial += delta.text;
      }
    }
  }
}

async function commandArgs(
  backend: AdditionalAgentBackend,
  model: string,
  workspace: string,
  prompt: string,
  runtime: NodeRuntimeModules
): Promise<{ args: string[]; history?: string }> {
  const io = runtime.fs.promises;
  const join = runtime.path.join;
  let args: string[];
  let history: string | undefined;
  switch (backend) {
    case "claude-code":
      args = [
        "--print", "--verbose", "--output-format", "stream-json",
        "--no-session-persistence", "--tools", "", "--disallowedTools", "*", "--permission-mode", "plan"
      ];
      break;
    case "cursor-agent": {
      // Project deny rules take precedence over saved global allows. Preserve the user's authentication.
      const configDir = join(workspace, ".cursor");
      await io.mkdir(configDir, { recursive: true });
      const roots = runtime.process.platform === "win32"
        ? ["/**", "//**", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", drive => drive + ":/**")]
        : ["/**"];
      await io.writeFile(join(configDir, "cli.json"), JSON.stringify({
        permissions: {
          allow: [],
          deny: [
            "Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)", "Mcp(*:*)",
            ...roots.flatMap(root => ["Read(" + root + ")", "Write(" + root + ")"])
          ]
        }
      }), { mode: 0o600 });
      // Trust applies only to this fresh workspace containing our restrictive permission configuration.
      args = ["--print", "--output-format", "stream-json", "--mode", "ask", "--trust"];
      break;
    }
    case "gemini-cli": {
      const policy = join(workspace, "deny-tools.toml");
      await io.writeFile(policy, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', { mode: 0o600 });
      args = ["--output-format", "stream-json", "--approval-mode", "plan", "--policy", policy];
      break;
    }
    case "copilot-cli":
      args = [
        "--output-format", "json", "--no-ask-user", "--no-auto-update",
        "--no-custom-instructions", "--disable-builtin-mcps",
        "--available-tools=view", "--deny-tool=read", "--deny-tool=write",
        "--deny-tool=shell", "--deny-tool=url", "--deny-tool=memory"
      ];
      break;
    case "qwen-code":
      args = [
        "--output-format", "stream-json", "--approval-mode", "plan",
        "--exclude-tools", "run_shell_command,write_file,replace,web_fetch,mcp_tool"
      ];
      break;
    case "aider": {
      const messageFile = join(workspace, "prompt.txt");
      history = join(workspace, "llm-history.txt");
      await Promise.all([
        io.writeFile(messageFile, prompt, { mode: 0o600 }),
        io.writeFile(history, "", { mode: 0o600 })
      ]);
      args = [
        "--chat-mode", "ask", "--dry-run", "--no-git", "--no-auto-commits",
        "--no-dirty-commits", "--no-auto-lint", "--no-auto-test", "--no-pretty",
        "--no-stream", "--no-check-update", "--no-analytics", "--no-notifications",
        "--message-file", messageFile, "--llm-history-file", history,
        "--chat-history-file", join(workspace, "chat-history.txt"),
        "--input-history-file", join(workspace, "input-history.txt")
      ];
      break;
    }
    case "bob":
      if (model) throw new Error("IBM Bob does not expose a model-selection flag. Select the CLI default model.");
      args = [
        "run", "--format", "stream-json", "--mode", "ask", "--disable-mcp", "--disable-subagents",
        "--disable-tool-groups", "read,edit,execute,mcp,skill,todo,subagent,mode"
      ];
      break;
    default:
      throw new Error("Unknown local agent backend.");
  }
  if (model) args.push("--model", model);
  return { args, history };
}

async function readAiderAnswer(history: string, runtime: NodeRuntimeModules): Promise<string> {
  const io = runtime.fs.promises;
  const stat = await io.stat(history);
  if (stat.size > MAX_OUTPUT) throw new Error("Aider response history exceeds the 4 MB limit.");
  const log: string = await io.readFile(history, "utf8");
  // Aider prefixes every completion line; separate reasoning and diagnostic output are never in this block.
  let collecting = false;
  let lines: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (/^LLM RESPONSE \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(line)) {
      collecting = true;
      lines = [];
    } else if (collecting && line.startsWith("ASSISTANT ")) {
      lines.push(line.slice("ASSISTANT ".length));
    } else if (collecting && line.trim()) {
      collecting = false;
    }
  }
  const answer = lines.join("\n").trim();
  if (!answer) throw new Error("Aider exited without a usable assistant response in its LLM history.");
  return answer;
}

async function executable(
  binary: string, args: string[], runtime: NodeRuntimeModules
): Promise<{ binary: string; args: string[] }> {
  if (runtime.process.platform !== "win32") return { binary, args };
  const path = runtime.path;
  const io = runtime.fs.promises;
  const isFile = async (file: string): Promise<boolean> => {
    try { return (await io.stat(file)).isFile(); } catch { return false; }
  };
  const env = runtime.process.env ?? {};
  const search = String(env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
  let resolved = binary;
  if (!path.isAbsolute(binary) && !/[\\/]/.test(binary)) {
    for (const directory of search) {
      const candidates = path.extname(binary) ? [binary] : [binary + ".exe", binary + ".cmd", binary + ".bat"];
      for (const candidate of candidates) {
        const fullPath = path.join(directory.replace(/^"|"$/g, ""), candidate);
        if (await isFile(fullPath)) { resolved = fullPath; break; }
      }
      if (resolved !== binary) break;
    }
  }
  if (/\.(cmd|bat)$/i.test(resolved)) {
    const stat = await io.stat(resolved);
    if (stat.size > 64_000) throw new Error("The configured Windows launcher is too large to inspect safely.");
    const wrapper: string = await io.readFile(resolved, "utf8");
    // Read the npm shim's literal JS target, never execute batch commands or interpolate a prompt into a shell.
    const target = wrapper.match(/"%dp0%[\\/]((?:node_modules)[\\/][^"\r\n%]+\.(?:c?js|mjs))"/i)?.[1];
    if (!target || target.split(/[\\/]/).includes("..")) {
      throw new Error("Unsupported Windows .cmd/.bat launcher. Select the agent's native .exe or JavaScript entry file in settings.");
    }
    resolved = path.resolve(path.dirname(resolved), target);
    if (!await isFile(resolved)) throw new Error("The npm launcher points to a missing JavaScript entry file. Reinstall the CLI.");
  }
  if (/\.(?:c?js|mjs)$/i.test(resolved)) {
    const nodeCandidates = [
      ...(path.basename(runtime.process.execPath ?? "").toLowerCase() === "node.exe" ? [runtime.process.execPath] : []),
      ...search.map((directory: string) => path.join(directory.replace(/^"|"$/g, ""), "node.exe"))
    ];
    for (const candidate of nodeCandidates) {
      if (await isFile(candidate)) return { binary: candidate, args: [resolved, ...args] };
    }
    throw new Error("This Windows CLI requires node.exe on PATH. Install Node.js or select a native agent executable.");
  }
  return { binary: resolved, args };
}

async function runProcess(
  binary: string,
  args: string[],
  workspace: string,
  prompt: string,
  options: LocalAgentOptions,
  runtime: NodeRuntimeModules
): Promise<AgentOutput> {
  const parser = new AgentOutput(options.backend);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 300_000, 10_000), 900_000);
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      checkAbort(options.signal);
      child = runtime.childProcess.spawn(binary, args, {
        cwd: workspace,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
        env: {
          ...runtime.process.env, NO_COLOR: "1",
          ...(options.backend === "copilot-cli" ? {
            COPILOT_ALLOW_ALL: "false", COPILOT_AUTO_UPDATE: "false",
            GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "false"
          } : {})
        }
      });
    } catch (error) { reject(error); return; }

    let settled = false;
    let failure: Error | undefined;
    let stderr = "";
    let stderrSize = 0;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let killDeadline: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      globalThis.clearTimeout(forceKill);
      globalThis.clearTimeout(killDeadline);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(parser);
    };
    const terminate = (error: Error) => {
      if (settled || failure) return;
      failure = error;
      try { child.kill("SIGTERM"); } catch { /* The close event may already be queued. */ }
      if (settled) return;
      forceKill = globalThis.setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* Best effort when the process has disappeared. */ }
        if (!settled) killDeadline = globalThis.setTimeout(() => finish(failure), 1500);
      }, 1500);
    };
    const onAbort = () => terminate(abortError());
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = globalThis.setTimeout(() => terminate(new Error("Local agent timed out after " + Math.round(timeoutMs / 1000) + " seconds.")), timeoutMs);

    child.once("error", (error: Error) => {
      const detail = /ENOENT|EINVAL/i.test(error.message)
        ? "Cannot start the local CLI. Install and log in to it, or select its executable path in settings."
        : "Cannot start the local CLI: " + error.message;
      finish(failure ?? new Error(detail));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled || failure) return;
      try { parser.write(chunk); } catch (error) { terminate(error as Error); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (settled || failure) return;
      stderrSize += chunk.length;
      stderr = (stderr + chunk).slice(-3000);
      if (stderrSize > MAX_OUTPUT) terminate(new Error("Local agent diagnostic output exceeds the 4 MB limit."));
    });
    child.once("close", (code: number | null, signal: string | null) => {
      if (failure) { finish(failure); return; }
      if (code !== 0) {
        finish(new Error(
          "Local CLI exited with code " + String(code) + (signal ? " (" + signal + ")" : "") +
          (stderr.trim() ? ": " + stderr.trim() : ". Check authentication, model access, and CLI version.")
        ));
      } else finish();
    });
    child.stdin.once("error", (error: Error) => terminate(new Error("Cannot send the local CLI prompt: " + error.message)));
    if (options.signal?.aborted) { onAbort(); return; }
    try { child.stdin.end(options.backend === "aider" ? "" : prompt + "\n"); }
    catch (error) { terminate(new Error("Cannot send the local CLI prompt: " + String(error))); }
  });
}

/**
 * Uses the installed agent's authentication in an isolated temporary workspace.
 * Capability restrictions are explicit CLI flags, never prompt-only safeguards.
 */
export async function runLocalAgent(messages: ChatMessage[], options: LocalAgentOptions): Promise<string> {
  checkAbort(options.signal);
  const prompt = buildPrompt(messages);
  const runtime = await loadNodeRuntimeModules();
  checkAbort(options.signal);
  if (!runtime.fs?.promises || !runtime.path) throw new Error("Local CLI execution requires the desktop filesystem bridge.");
  const workspace = await runtime.fs.promises.mkdtemp(runtime.path.join(runtime.os.tmpdir(), "better-canvas-agent-"));
  try {
    checkAbort(options.signal);
    const spec = await commandArgs(options.backend, options.model?.trim() ?? "", workspace, prompt, runtime);
    const command = await executable(options.binaryPath?.trim() || BINARIES[options.backend], spec.args, runtime);
    checkAbort(options.signal);
    const output = await runProcess(command.binary, command.args, workspace, prompt, options, runtime);
    checkAbort(options.signal);
    const answer = spec.history ? await readAiderAnswer(spec.history, runtime) : output.finish();
    checkAbort(options.signal);
    options.onDelta?.(answer);
    return answer;
  } finally {
    await runtime.fs.promises.rm(workspace, { recursive: true, force: true });
  }
}
