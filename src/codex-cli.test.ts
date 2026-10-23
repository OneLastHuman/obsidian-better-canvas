import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runLocalCodex } from "./codex-cli";
import { loadNodeRuntimeModules } from "./node-runtime";

vi.mock("./node-runtime", () => ({
  loadNodeRuntimeModules: vi.fn()
}));

class FakeStdin extends Writable {
  text = "";

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString();
    callback();
  }
}

/** Minimal stand-in for a spawned CLI process. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new FakeStdin();
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: string[] = [];

  kill(signal: string): boolean {
    this.killed.push(signal);
    return true;
  }
}

const spawn = vi.fn();
const runtime = {
  childProcess: { spawn },
  os: { tmpdir: () => "/tmp/codex-tmp" },
  process: { platform: "linux" }
};

/** Resolves as soon as the CLI process is spawned, so tests never guess at timing. */
function startRun(options: { binaryPath?: string; model?: string; signal?: AbortSignal } = {}) {
  const child = new FakeChild();
  // tsconfig targets ES2022, which predates Promise.withResolvers.
  let onSpawned = () => { /* assigned below */ };
  const spawned = new Promise<void>(resolve => { onSpawned = resolve; });
  spawn.mockImplementation(() => {
    onSpawned();
    return child;
  });
  const promise = runLocalCodex("PROMPT", {
    binaryPath: options.binaryPath,
    model: options.model,
    signal: options.signal ?? new AbortController().signal
  });
  return { child, promise, spawned };
}

describe("Local Codex CLI process handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadNodeRuntimeModules).mockResolvedValue(runtime);
  });

  it("spawns a shell-free read-only sandbox and pipes the prompt over stdin", async () => {
    const { child, promise, spawned } = startRun({ binaryPath: "/usr/local/bin/codex" });
    await spawned;

    expect(loadNodeRuntimeModules).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/codex",
      ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-"],
      { cwd: "/tmp/codex-tmp", stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false }
    );
    expect(child.stdin.text).toBe("PROMPT\n");

    child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer" } }) + "\n");
    child.emit("close", 0, null);
    await expect(promise).resolves.toBe("Answer");
  });

  it("falls back to codex on PATH when no binary is configured", async () => {
    const { child, promise, spawned } = startRun();
    await spawned;
    expect(spawn.mock.calls[0][0]).toBe("codex");
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow(/没有返回可用的助手文本/);
  });

  it("passes the selected model as one argument without changing sandbox restrictions", async () => {
    const { child, promise, spawned } = startRun({ model: "  provider/custom-model  " });
    await spawned;
    expect(spawn.mock.calls[0][1]).toEqual([
      "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
      "--model", "provider/custom-model", "-"
    ]);
    child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer" } }) + "\n");
    child.emit("close", 0, null);
    await expect(promise).resolves.toBe("Answer");
  });

  it("keeps the CLI default when the selected model is blank", async () => {
    const { child, promise, spawned } = startRun({ model: " \n " });
    await spawned;
    expect(spawn.mock.calls[0][1]).not.toContain("--model");
    child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Answer" } }) + "\n");
    child.emit("close", 0, null);
    await expect(promise).resolves.toBe("Answer");
  });

  it("surfaces a friendly message when the executable is missing", async () => {
    const { child, promise, spawned } = startRun();
    await spawned;
    child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }));
    await expect(promise).rejects.toThrow("找不到 Codex CLI");
  });

  it("rejects on a non-zero exit and keeps the stderr tail", async () => {
    const { child, promise, spawned } = startRun();
    await spawned;
    child.stderr.write("not logged in");
    child.exitCode = 1;
    child.emit("close", 1, null);
    await expect(promise).rejects.toThrow(/状态码 1[\s\S]*not logged in/);
  });

  it("reports a fatal stream error even when the process exits cleanly", async () => {
    const { child, promise, spawned } = startRun();
    await spawned;
    child.stdout.write(JSON.stringify({ type: "error", message: "Not authenticated" }) + "\n");
    child.emit("close", 0, null);
    await expect(promise).rejects.toThrow(/Not authenticated/);
  });

  it("terminates the child and rejects when the request is aborted", async () => {
    const controller = new AbortController();
    const { child, promise, spawned } = startRun({ signal: controller.signal });
    await spawned;
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/i);
    expect(child.killed).toContain("SIGTERM");
    child.exitCode = 0;
    child.emit("close", 0, null);
  });

  it("rejects without spawning when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runLocalCodex("PROMPT", { signal: controller.signal })).rejects.toThrow(/cancelled/i);
    expect(spawn).not.toHaveBeenCalled();
  });
});
