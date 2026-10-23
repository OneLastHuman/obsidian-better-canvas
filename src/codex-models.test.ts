import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCodexModels, type CodexModelListOptions } from "./codex-models";
import { loadNodeRuntimeModules } from "./node-runtime";

vi.mock("./node-runtime", () => ({
  loadNodeRuntimeModules: vi.fn()
}));

interface Message {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

class FakeStdin extends Writable {
  constructor(private readonly onMessage: (message: Message) => void) { super(); }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    for (const line of chunk.toString().trim().split("\n")) {
      this.onMessage(JSON.parse(line) as Message);
    }
    callback();
  }
}

class FakeChild extends EventEmitter {
  messages: Message[] = [];
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new FakeStdin(message => {
    this.messages.push(message);
    this.emit("message", message);
  });
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: string[] = [];

  kill(signal: string): boolean {
    this.killed.push(signal);
    return true;
  }

  close(code = 0): void {
    this.exitCode = code;
    this.emit("close", code);
  }

  respond(request: Message, result: unknown): void {
    this.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
  }

  waitFor(method: string, cursor?: string): Promise<Message> {
    const matches = (message: Message) =>
      message.method === method && (cursor === undefined || message.params?.cursor === cursor);
    const existing = this.messages.find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      const listener = (message: Message) => {
        if (!matches(message)) return;
        this.off("message", listener);
        resolve(message);
      };
      this.on("message", listener);
    });
  }
}

const spawn = vi.fn();
const runtime = {
  childProcess: { spawn },
  os: { tmpdir: () => "/tmp/codex-model-list" },
  process: { platform: "linux" }
};
const children: FakeChild[] = [];

function startRun(options: CodexModelListOptions = {}) {
  const child = new FakeChild();
  children.push(child);
  spawn.mockReturnValue(child);
  return { child, promise: listCodexModels(options) };
}

async function initialize(child: FakeChild): Promise<Message> {
  const init = await child.waitFor("initialize");
  child.respond(init, { userAgent: "codex-test" });
  return child.waitFor("model/list");
}

describe("Codex model discovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(loadNodeRuntimeModules).mockResolvedValue(runtime);
  });

  afterEach(() => {
    for (const child of children.splice(0)) child.close();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("discovers the configured CLI catalog without creating a thread or sending a prompt", async () => {
    const { child, promise } = startRun({ binaryPath: " /usr/local/bin/codex " });
    const request = await initialize(child);
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["app-server", "--listen", "stdio://"],
      { cwd: "/tmp/codex-model-list", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false }
    );
    expect(child.messages).toEqual([
      {
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "obsidian-better-canvas", title: "Better Canvas", version: "0.1.0" } }
      },
      { method: "initialized" },
      { id: 2, method: "model/list", params: { limit: 100, includeHidden: false } }
    ]);

    child.respond(request, {
      data: [{ id: "catalog-entry", model: "configured-model", displayName: "Configured Model", hidden: false }],
      nextCursor: null
    });
    await expect(promise).resolves.toEqual([{ id: "configured-model", name: "Configured Model" }]);
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed).toEqual(["SIGTERM"]);
    child.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows pagination, deduplicates executable IDs, and ignores hidden or malformed entries", async () => {
    const { child, promise } = startRun();
    const first = await initialize(child);
    child.respond(first, {
      data: [
        { id: "catalog-a", model: " model-a ", displayName: " Model A " },
        { model: "hidden-model", displayName: "Hidden", hidden: true },
        { id: "no-executable-model", displayName: "Missing model" },
        { model: "" },
        { model: 17 },
        null
      ],
      nextCursor: "next"
    });
    const second = await child.waitFor("model/list", "next");
    child.respond(second, {
      data: [
        { model: "model-a", displayName: "Duplicate" },
        { model: "model-b", displayName: " " },
        { model: "model-c" }
      ],
      nextCursor: null
    });
    await expect(promise).resolves.toEqual([
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "model-b" },
      { id: "model-c", name: "model-c" }
    ]);
    expect(spawn.mock.calls[0][0]).toBe("codex");
  });

  it("parses chunked JSONL and ignores notifications, malformed lines, and unrelated response IDs", async () => {
    const { child, promise } = startRun();
    const request = await initialize(child);
    child.stdout.write("not json\nnull\n{\"method\":\"catalog/updated\"}\n{\"id\":77,\"result\":{}}\n");
    const response = JSON.stringify({ id: request.id, result: { data: [{ model: "chunked" }] } });
    child.stdout.write(response.slice(0, 10));
    child.stdout.write(response.slice(10) + "\r\n");
    await expect(promise).resolves.toEqual([{ id: "chunked", name: "chunked" }]);
  });

  it("returns an empty catalog without replacing it with hard-coded models", async () => {
    const { child, promise } = startRun();
    child.respond(await initialize(child), { data: [], nextCursor: null });
    await expect(promise).resolves.toEqual([]);
  });

  it("declines server requests without executing a client tool", async () => {
    const { child, promise } = startRun();
    const request = await initialize(child);
    child.stdout.write(JSON.stringify({ id: "approval", method: "item/commandExecution/requestApproval", params: {} }) + "\n");
    expect(child.messages.at(-1)).toEqual({
      id: "approval",
      error: { code: -32601, message: "Model discovery does not support client methods." }
    });
    child.respond(request, { data: [] });
    await expect(promise).resolves.toEqual([]);
  });

  it("reports initialization errors and never attempts model/list", async () => {
    const { child, promise } = startRun();
    const request = await child.waitFor("initialize");
    child.stdout.write(JSON.stringify({ id: request.id, error: { code: -32000, message: "Unsupported client" } }) + "\n");
    await expect(promise).rejects.toThrow("Codex initialize failed: Unsupported client");
    expect(child.messages.map(message => message.method)).toEqual(["initialize"]);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("reports model-list errors without treating them as an empty catalog", async () => {
    const { child, promise } = startRun();
    const request = await initialize(child);
    child.stdout.write(JSON.stringify({ id: request.id, error: { code: -32601, message: "Method not found" } }) + "\n");
    await expect(promise).rejects.toThrow("Codex model/list failed: Method not found");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it.each([
    { result: { models: [] }, message: "invalid model list" },
    { result: null, message: "invalid model list" },
    { result: { data: [], nextCursor: 7 }, message: "invalid or repeated model-list cursor" }
  ])("rejects malformed responses: $message", async ({ result, message }) => {
    const { child, promise } = startRun();
    child.respond(await initialize(child), result);
    await expect(promise).rejects.toThrow(message);
  });

  it("rejects repeated pagination cursors", async () => {
    const { child, promise } = startRun();
    child.respond(await initialize(child), { data: [], nextCursor: "repeated" });
    child.respond(await child.waitFor("model/list", "repeated"), { data: [], nextCursor: "repeated" });
    await expect(promise).rejects.toThrow("repeated model-list cursor");
    expect(child.messages.filter(message => message.method === "model/list")).toHaveLength(2);
  });

  it("limits the number of pages", async () => {
    const { child, promise } = startRun();
    let request = await initialize(child);
    for (let page = 0; page < 20; page++) {
      const cursor = "page-" + page;
      child.respond(request, { data: [], nextCursor: cursor });
      if (page < 19) request = await child.waitFor("model/list", cursor);
    }
    await expect(promise).rejects.toThrow("pagination limit");
    expect(child.messages.filter(message => message.method === "model/list")).toHaveLength(20);
  });

  it("limits the accumulated model catalog", async () => {
    const { child, promise } = startRun();
    child.respond(await initialize(child), {
      data: Array.from({ length: 1000 }, (_, index) => ({ model: "model-" + index })),
      nextCursor: "overflow"
    });
    child.respond(await child.waitFor("model/list", "overflow"), { data: [{ model: "one-too-many" }] });
    await expect(promise).rejects.toThrow("too many models");
  });

  it("bounds an unterminated stdout line and stops the child", async () => {
    const { child, promise } = startRun();
    await child.waitFor("initialize");
    child.stdout.write("x".repeat(1_000_001));
    await expect(promise).rejects.toThrow("size limit");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("bounds total stdout even when each individual JSONL message is small", async () => {
    const { child, promise } = startRun();
    await child.waitFor("initialize");
    const notifications = (JSON.stringify({ method: "notice", params: "x".repeat(200) }) + "\n").repeat(3000);
    for (let chunk = 0; chunk < 6; chunk++) child.stdout.write(notifications);
    await expect(promise).rejects.toThrow("size limit");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("reports a missing executable and cleans up the discovery timer", async () => {
    const { child, promise } = startRun();
    await child.waitFor("initialize");
    child.emit("error", new Error("spawn codex ENOENT"));
    await expect(promise).rejects.toThrow("Codex CLI was not found");
    child.close(-2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a bounded stderr tail when the process exits", async () => {
    const { child, promise } = startRun();
    await child.waitFor("initialize");
    child.stderr.write("x".repeat(6000) + " authentication failed");
    child.close(7);
    const error = await promise.catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("code 7");
    expect((error as Error).message).toContain("authentication failed");
    expect((error as Error).message.length).toBeLessThan(1400);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates the child on stdin failure", async () => {
    const { child, promise } = startRun();
    await child.waitFor("initialize");
    child.stdin.emit("error", new Error("broken pipe"));
    await expect(promise).rejects.toThrow("Unable to write to Codex app-server: broken pipe");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("cancels active discovery and escalates termination if the child stays alive", async () => {
    const controller = new AbortController();
    const { child, promise } = startRun({ signal: controller.signal });
    await initialize(child);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(child.killed).toEqual(["SIGTERM", "SIGKILL"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out and clears forced termination when the process closes", async () => {
    const { child, promise } = startRun({ timeoutMs: 1000 });
    await initialize(child);
    const rejection = expect(promise).rejects.toThrow("timed out after 1 seconds");
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(child.killed).toEqual(["SIGTERM"]);
    child.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("rejects an already-cancelled request without loading the runtime or spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listCodexModels({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(loadNodeRuntimeModules).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("checks for cancellation again after loading the runtime", async () => {
    const controller = new AbortController();
    let finishLoading!: (value: typeof runtime) => void;
    vi.mocked(loadNodeRuntimeModules).mockReturnValue(new Promise(resolve => { finishLoading = resolve; }));
    const promise = listCodexModels({ signal: controller.signal });
    controller.abort();
    finishLoading(runtime);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
