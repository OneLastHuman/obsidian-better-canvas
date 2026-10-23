import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLocalAgent, type AdditionalAgentBackend, type LocalAgentOptions } from "./local-agent-cli";
import { loadNodeRuntimeModules } from "./node-runtime";
import type { ChatMessage } from "./ai";

vi.mock("./node-runtime", () => ({ loadNodeRuntimeModules: vi.fn() }));

const messages: ChatMessage[] = [
  { role: "system", content: "Respond in Markdown." },
  { role: "user", content: [{ type: "text", text: "Summarize this note; $(do-not-run) `literal` & echo NO." }] }
];

class FakeStdin extends Writable {
  text = "";
  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString();
    callback();
  }
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new FakeStdin();
  killed: string[] = [];
  closeOnKill = true;

  kill(signal: string): boolean {
    this.killed.push(signal);
    if (this.closeOnKill) queueMicrotask(() => this.emit("close", null, signal));
    return true;
  }

  events(...events: unknown[]): void {
    for (const event of events) this.stdout.write(JSON.stringify(event) + "\n");
  }
}

const spawn = vi.fn();
let testRoot: string;
let runtime: any;

function startRun(backend: AdditionalAgentBackend, options: Partial<LocalAgentOptions> = {}) {
  const child = new FakeChild();
  let onSpawned = () => {};
  const spawned = new Promise<void>(resolve => { onSpawned = resolve; });
  spawn.mockImplementation(() => { onSpawned(); return child; });
  const promise = runLocalAgent(messages, { backend, ...options });
  return { child, promise, spawned };
}

function workspace(): string { return spawn.mock.calls[0][2].cwd; }
function args(): string[] { return spawn.mock.calls[0][1]; }
function argument(flag: string): string { return args()[args().indexOf(flag) + 1]; }

async function success(child: FakeChild, backend: AdditionalAgentBackend, answer = "Answer"): Promise<void> {
  if (backend === "aider") {
    await fs.promises.appendFile(
      argument("--llm-history-file"),
      "TO LLM 2026-10-23T12:00:00\nUSER user input\n" +
      "LLM RESPONSE 2026-10-23T12:00:01\n" + answer.split("\n").map(line => "ASSISTANT " + line).join("\n") + "\n"
    );
    child.stdout.write("Banner\n<reasoning>private</reasoning>\nToken cost: 100\n");
  } else if (backend === "gemini-cli") {
    child.events(
      { type: "message", role: "user", content: "Do not return this" },
      { type: "message", role: "assistant", delta: true, content: answer.slice(0, 2) },
      { type: "message", role: "assistant", delta: true, content: answer.slice(2) },
      { type: "tool_result", output: "Do not return this" },
      { type: "result", status: "success" }
    );
  } else if (backend === "bob") {
    child.events(
      { type: "message", role: "assistant", content: "private", isReasoning: true },
      { type: "tool_result", output: "Do not return this" },
      { type: "message", role: "assistant", content: answer },
      { type: "result", status: "success", last_message: answer }
    );
  } else if (backend === "copilot-cli") {
    child.events(
      { type: "assistant.reasoning", data: { content: "private" } },
      { type: "assistant.message_delta", data: { messageId: "1", deltaContent: answer } },
      { type: "assistant.message", agentId: "child", data: { content: "Ignore child" } },
      { type: "assistant.message", data: { parentToolCallId: "tool", content: "Ignore tool" } },
      { type: "assistant.message", data: { content: answer } }
    );
  } else {
    child.events(
      { type: "system", message: "Do not return this" },
      {
        type: "assistant", message: {
          role: "assistant", content: [
            { type: "thinking", thinking: "private" },
            { type: "tool_use", name: "secret", input: {} },
            { type: "text", text: answer }
          ]
        }
      },
      { type: "result", subtype: "success", is_error: false, result: answer }
    );
  }
  child.emit("close", 0, null);
}

beforeEach(async () => {
  vi.clearAllMocks();
  testRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "better-canvas-agent-test-"));
  runtime = {
    childProcess: { spawn },
    os: { tmpdir: () => testRoot },
    process: { platform: "linux", env: { TEST_AGENT_TOKEN: "mock-only" } },
    fs: {
      promises: {
        ...fs.promises,
        mkdtemp: vi.fn(fs.promises.mkdtemp),
        rm: vi.fn(fs.promises.rm)
      }
    },
    path
  };
  vi.mocked(loadNodeRuntimeModules).mockResolvedValue(runtime);
});

afterEach(async () => {
  vi.useRealTimers();
  if (path.dirname(testRoot) === os.tmpdir() && path.basename(testRoot).startsWith("better-canvas-agent-test-")) {
    await fs.promises.rm(testRoot, { recursive: true, force: true });
  }
});

describe("Local agent adapters", () => {
  const cases: Array<[AdditionalAgentBackend, string, string[]]> = [
    ["claude-code", "claude", ["--tools", "", "--disallowedTools", "*", "--permission-mode", "plan"]],
    ["cursor-agent", "cursor-agent", ["--print", "--mode", "ask"]],
    ["gemini-cli", "gemini", ["--approval-mode", "plan", "--policy"]],
    ["copilot-cli", "copilot", ["--available-tools=view", "--deny-tool=read", "--no-ask-user"]],
    ["qwen-code", "qwen", ["--approval-mode", "plan", "--exclude-tools", "run_shell_command,write_file,replace,web_fetch,mcp_tool"]],
    ["aider", "aider", ["--chat-mode", "ask", "--dry-run", "--no-git", "--no-auto-test"]],
    ["bob", "bob", ["run", "--format", "stream-json", "--disable-mcp", "--disable-subagents", "--disable-tool-groups"]]
  ];

  it("keeps Claude Code's authenticated settings available", async () => {
    const { child, promise, spawned } = startRun("claude-code", { model: "sonnet" });
    await spawned;
    expect(args()).not.toContain("--bare");
    expect(args()).toEqual(expect.arrayContaining(["--print", "--output-format", "stream-json"]));
    await success(child, "claude-code");
    await expect(promise).resolves.toBe("Answer");
  });

  it.each(cases)("runs %s with restricted capabilities and returns only assistant text", async (backend, binary, restrictions) => {
    const onDelta = vi.fn();
    const { child, promise, spawned } = startRun(backend, { model: backend === "bob" ? "" : "provider/model", onDelta });
    await spawned;
    expect(spawn.mock.calls[0][0]).toBe(binary);
    expect(args()).toEqual(expect.arrayContaining(restrictions));
    for (const unsafe of ["--yolo", "--allow-all-tools", "--dangerously-skip-permissions"]) {
      expect(args()).not.toContain(unsafe);
    }
    expect(spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    expect(workspace()).not.toBe(testRoot);
    expect(path.dirname(workspace())).toBe(testRoot);
    expect(args().join(" ")).not.toContain("$(do-not-run)");
    if (backend !== "bob") expect(argument("--model")).toBe("provider/model");
    if (backend === "aider") {
      const prompt = await fs.promises.readFile(argument("--message-file"), "utf8");
      expect(prompt).toContain("$(do-not-run) `literal` & echo NO.");
      expect(child.stdin.text).toBe("");
    } else {
      expect(child.stdin.text).toContain("SYSTEM:\nRespond in Markdown.");
      expect(child.stdin.text).toContain("USER:\nSummarize this note;");
    }
    if (backend === "gemini-cli") {
      expect(await fs.promises.readFile(argument("--policy"), "utf8")).toContain('toolName = "*"\ndecision = "deny"');
    }
    if (backend === "cursor-agent") {
      const config = JSON.parse(await fs.promises.readFile(path.join(workspace(), ".cursor", "cli.json"), "utf8"));
      expect(config).toEqual({
        permissions: {
          allow: [],
          deny: ["Shell(*)", "Read(**)", "Write(**)", "WebFetch(*)", "Mcp(*:*)", "Read(/**)", "Write(/**)"]
        }
      });
    }
    if (backend === "copilot-cli") expect(spawn.mock.calls[0][2].env.COPILOT_ALLOW_ALL).toBe("false");
    if (backend === "bob") expect(argument("--disable-tool-groups")).toBe("read,edit,execute,mcp,skill,todo,subagent,mode");
    await success(child, backend, "Final\nanswer");
    await expect(promise).resolves.toBe("Final\nanswer");
    expect(onDelta.mock.calls).toEqual([["Final\nanswer"]]);
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("uses an explicit executable and preserves a model as a single argument", async () => {
    const { child, promise, spawned } = startRun("claude-code", {
      binaryPath: " /opt/agent with spaces ", model: " provider/custom;$(literal) "
    });
    await spawned;
    expect(spawn.mock.calls[0][0]).toBe("/opt/agent with spaces");
    expect(argument("--model")).toBe("provider/custom;$(literal)");
    await success(child, "claude-code");
    await expect(promise).resolves.toBe("Answer");
  });

  it("omits the model flag for the CLI default", async () => {
    const { child, promise, spawned } = startRun("qwen-code", { model: "  " });
    await spawned;
    expect(args()).not.toContain("--model");
    await success(child, "qwen-code");
    await expect(promise).resolves.toBe("Answer");
  });

  it("rejects an unsupported Bob model before spawning and cleans its workspace", async () => {
    await expect(runLocalAgent(messages, { backend: "bob", model: "invented" })).rejects.toThrow("does not expose");
    expect(spawn).not.toHaveBeenCalled();
    expect(await fs.promises.readdir(testRoot)).toEqual([]);
  });

  it("rejects images and oversized prompts before loading the process runtime", async () => {
    await expect(runLocalAgent([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,a" } }] }], {
      backend: "gemini-cli"
    })).rejects.toThrow("text only");
    await expect(runLocalAgent([{ role: "user", content: "a".repeat(1_000_001) }], {
      backend: "claude-code"
    })).rejects.toThrow("prompt exceeds");
    expect(loadNodeRuntimeModules).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("handles fragmented JSON and a final event without a newline", async () => {
    const { child, promise, spawned } = startRun("claude-code");
    await spawned;
    child.stdout.write("unstructured startup notice\n{\"type\":\"res");
    child.stdout.write('ult","subtype":"success","result":"answer"}');
    child.emit("close", 0, null);
    await expect(promise).resolves.toBe("answer");
  });

  it("merges Copilot assistant chunks around reasoning boundaries in order without duplicate snapshots", async () => {
    const onDelta = vi.fn();
    const { child, promise, spawned } = startRun("copilot-cli", { onDelta });
    await spawned;
    const first = { type: "assistant.message", data: { apiCallId: "call", chunkIndex: 0, chunkCount: 2, content: "First.\n\n" } };
    child.events(
      { type: "assistant.message_delta", data: { deltaContent: "First.\n\n" } },
      first,
      { type: "assistant.reasoning", data: { content: "Private reasoning" } },
      { type: "assistant.message", data: { apiCallId: "call", chunkIndex: 1, chunkCount: 2, content: "Second." } },
      first
    );
    child.emit("close", 0, null);
    await expect(promise).resolves.toBe("First.\n\nSecond.");
    expect(onDelta.mock.calls).toEqual([["First.\n\nSecond."]]);
  });

  it("rejects missing Copilot assistant chunks instead of returning a truncated answer", async () => {
    const { child, promise, spawned } = startRun("copilot-cli");
    await spawned;
    child.events({ type: "assistant.message", data: { apiCallId: "call", chunkIndex: 1, chunkCount: 2, content: "Only second." } });
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow("incomplete assistant response");
  });

  it("never uses Aider diagnostic stdout as a fallback answer", async () => {
    const { child, promise, spawned } = startRun("aider");
    await spawned;
    child.stdout.write("Here is private reasoning; Authentication failed.");
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow("LLM history");
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("rejects oversized Aider history before reading its body", async () => {
    const { child, promise, spawned } = startRun("aider");
    await spawned;
    await fs.promises.truncate(argument("--llm-history-file"), 4_000_001);
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow("history exceeds");
  });
});

describe("Local agent lifecycle", () => {
  it.each([
    ["claude-code", { type: "result", is_error: true, subtype: "error_during_execution", errors: ["Authentication failed"] }],
    ["gemini-cli", { type: "result", status: "error", error: { message: "Authentication failed" } }],
    ["copilot-cli", { type: "session.error", data: { message: "Authentication failed" } }],
    ["bob", { type: "error", severity: "error", message: "Authentication failed" }]
  ] as Array<[AdditionalAgentBackend, unknown]>)("rejects %s structured errors even on exit zero", async (backend, error) => {
    const onDelta = vi.fn();
    const { child, promise, spawned } = startRun(backend, { onDelta });
    await spawned;
    child.events(error);
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow("Authentication failed");
    expect(onDelta).not.toHaveBeenCalled();
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("does not publish a partial answer after a nonzero exit", async () => {
    const onDelta = vi.fn();
    const { child, promise, spawned } = startRun("gemini-cli", { onDelta });
    await spawned;
    child.events({ type: "message", role: "assistant", delta: true, content: "Partial" });
    child.stderr.write("unknown model");
    child.emit("close", 42, null);
    await expect(promise).rejects.toThrow(/code 42.*unknown model/);
    expect(onDelta).not.toHaveBeenCalled();
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("cleans up after a spawn error", async () => {
    const { child, promise, spawned } = startRun("claude-code");
    await spawned;
    child.emit("error", new Error("spawn ENOENT"));
    await expect(promise).rejects.toThrow("executable path");
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("terminates the process on a broken stdin pipe", async () => {
    const { child, promise, spawned } = startRun("claude-code");
    await spawned;
    child.stdin.emit("error", new Error("EPIPE"));
    await expect(promise).rejects.toThrow("Cannot send");
    expect(child.killed).toContain("SIGTERM");
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("rejects an already aborted request without runtime or filesystem work", async () => {
    const signal = AbortSignal.abort();
    await expect(runLocalAgent(messages, { backend: "bob", signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadNodeRuntimeModules).not.toHaveBeenCalled();
  });

  it("handles cancellation while the temporary directory is being created", async () => {
    const controller = new AbortController();
    runtime.fs.promises.mkdtemp.mockImplementation(async (prefix: string) => {
      const directory = await fs.promises.mkdtemp(prefix);
      controller.abort();
      return directory;
    });
    await expect(runLocalAgent(messages, { backend: "bob", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
    expect(await fs.promises.readdir(testRoot)).toEqual([]);
  });

  it("terminates and removes temporary files after cancellation", async () => {
    const controller = new AbortController();
    const { child, promise, spawned } = startRun("aider", { signal: controller.signal });
    await spawned;
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.killed).toEqual(["SIGTERM"]);
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("enforces timeouts and escalates a process that ignores termination", async () => {
    vi.useFakeTimers();
    const { child, promise, spawned } = startRun("gemini-cli", { timeoutMs: 10_000 });
    await spawned;
    child.closeOnKill = false;
    const rejected = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.killed).toEqual(["SIGTERM"]);
    expect(fs.existsSync(workspace())).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(child.killed).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(fs.existsSync(workspace())).toBe(false);
  });

  it("caps total output across individually small JSON lines", async () => {
    const { child, promise, spawned } = startRun("gemini-cli");
    await spawned;
    for (let i = 0; i < 42; i++) child.events({ type: "message", role: "assistant", delta: true, content: "x".repeat(100_000) });
    await expect(promise).rejects.toThrow("output exceeds");
    expect(child.killed).toContain("SIGTERM");
  });

  it("caps stderr flooding and never returns it as assistant text", async () => {
    const { child, promise, spawned } = startRun("copilot-cli");
    await spawned;
    child.stderr.write("x".repeat(4_000_001));
    await expect(promise).rejects.toThrow("diagnostic output exceeds");
  });
});

describe("Windows launchers", () => {
  it("denies Cursor reads and writes across drive roots and UNC paths", async () => {
    runtime.process = { platform: "win32", env: {} };
    const { child, promise, spawned } = startRun("cursor-agent");
    await spawned;
    const config = JSON.parse(await fs.promises.readFile(path.join(workspace(), ".cursor", "cli.json"), "utf8"));
    expect(config.permissions.allow).toEqual([]);
    expect(config.permissions.deny).toEqual(expect.arrayContaining([
      "Read(C:/**)", "Write(C:/**)", "Read(c:/**)", "Read(Z:/**)", "Read(//**)", "Mcp(*:*)"
    ]));
    await success(child, "cursor-agent");
    await expect(promise).resolves.toBe("Answer");
  });

  it("unwraps a standard npm shim into node.exe and its entry file without a shell", async () => {
    runtime.process = { platform: "win32", env: { Path: testRoot }, execPath: path.join(testRoot, "node.exe") };
    const entry = path.join(testRoot, "node_modules", "example", "cli.js");
    await fs.promises.mkdir(path.dirname(entry), { recursive: true });
    await fs.promises.writeFile(entry, "// fixture, never executed");
    await fs.promises.writeFile(path.join(testRoot, "node.exe"), "fixture");
    await fs.promises.writeFile(path.join(testRoot, "qwen.cmd"), '@ECHO off\n"%_prog%" "%dp0%/node_modules/example/cli.js" %*\n');
    const { child, promise, spawned } = startRun("qwen-code", { model: "model & echo BAD" });
    await spawned;
    expect(spawn.mock.calls[0][0]).toBe(path.join(testRoot, "node.exe"));
    expect(args()[0]).toBe(entry);
    expect(argument("--model")).toBe("model & echo BAD");
    expect(spawn.mock.calls[0][2].shell).toBe(false);
    await success(child, "qwen-code");
    await expect(promise).resolves.toBe("Answer");
  });

  it("rejects an arbitrary batch wrapper instead of executing it", async () => {
    runtime.process = { platform: "win32", env: { Path: testRoot } };
    const wrapper = path.join(testRoot, "agent.cmd");
    await fs.promises.writeFile(wrapper, "@echo off\ncall unsafe %*\n");
    await expect(runLocalAgent(messages, { backend: "claude-code", binaryPath: wrapper })).rejects.toThrow("Unsupported Windows");
    expect(spawn).not.toHaveBeenCalled();
    expect((await fs.promises.readdir(testRoot)).filter(file => file.startsWith("better-canvas-agent-"))).toEqual([]);
  });
});
