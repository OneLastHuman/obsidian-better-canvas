import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveLaunchCommand } from "./agent-launcher";
import { resolveAgentBinary } from "./local-agent-discovery";
import { loadNodeRuntimeModules } from "./node-runtime";

export interface CodexModelOption {
  id: string;
  name: string;
}

export interface CodexModelListOptions {
  binaryPath?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface PendingRequest {
  id: number;
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function abortError(): Error {
  const error = new Error("Codex model discovery was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Read the configured CLI's model catalog without starting a thread or prompt.
 * A catalog entry does not guarantee that the configured provider grants access.
 */
export async function listCodexModels(options: CodexModelListOptions = {}): Promise<CodexModelOption[]> {
  if (options.signal?.aborted) throw abortError();
  const runtime = await loadNodeRuntimeModules();
  if (options.signal?.aborted) throw abortError();
  const binary = resolveAgentBinary(options.binaryPath, "codex", runtime);
  const configuredTimeout = options.timeoutMs ?? 15_000;
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 1000), 60_000)
    : 15_000;


  const launch = await resolveLaunchCommand(binary, ["app-server", "--listen", "stdio://"], runtime);
  if (options.signal?.aborted) throw abortError();
  return await new Promise<CodexModelOption[]>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = runtime.childProcess.spawn(launch.binary, launch.args, {
        cwd: runtime.os.tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let closed = false;
    let stdoutBuffer = "";
    let stdoutSize = 0;
    let stderrTail = "";
    let nextId = 0;
    let pending: PendingRequest | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      if (closed || child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill("SIGTERM"); } catch { /* child may have exited */ }
      if (closed) return;
      killTimer = setTimeout(() => {
        if (!closed && child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch { /* child may have exited */ }
        }
      }, 1500);
      killTimer.unref?.();
    };

    const finish = (error?: Error, models: CodexModelOption[] = []) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      pending?.reject(error ?? new Error("Codex model discovery has finished."));
      pending = undefined;
      stdoutBuffer = "";
      try { child.stdin.end(); } catch { /* stdin may already be closed */ }
      terminate();
      if (error) reject(error);
      else resolve(models);
    };

    const send = (message: Record<string, unknown>) => {
      if (settled || child.stdin.destroyed || !child.stdin.writable) {
        throw new Error("Codex app-server input is closed.");
      }
      // Codex's JSONL protocol omits the JSON-RPC version field.
      child.stdin.write(JSON.stringify(message) + "\n");
    };

    const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
      return new Promise((requestResolve, requestReject) => {
        const id = ++nextId;
        pending = { id, method, resolve: requestResolve, reject: requestReject };
        try { send({ id, method, params }); } catch (error) {
          pending = undefined;
          requestReject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    const consumeLine = (line: string) => {
      if (settled || !line.trim()) return;
      let message: Record<string, unknown> | undefined;
      try { message = record(JSON.parse(line)); } catch { return; }
      if (!message) return;
      if (typeof message.method === "string") {
        if (typeof message.id === "number" || typeof message.id === "string") {
          try {
            send({ id: message.id, error: { code: -32601, message: "Model discovery does not support client methods." } });
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        }
        return;
      }
      if (!pending || message.id !== pending.id) return;
      const entry = pending;
      pending = undefined;
      if (message.error !== undefined) {
        const detail = record(message.error)?.message;
        entry.reject(new Error(
          "Codex " + entry.method + " failed: " +
          (typeof detail === "string" ? detail.slice(0, 1200) : "unknown protocol error")
        ));
      } else if (Object.hasOwn(message, "result")) {
        entry.resolve(message.result);
      } else {
        entry.reject(new Error("Codex app-server returned an invalid " + entry.method + " response."));
      }
    };

    const onAbort = () => finish(abortError());
    options.signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      finish(new Error("Codex model discovery timed out after " + Math.round(timeoutMs / 1000) + " seconds."));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      stdoutSize += chunk.length;
      stdoutBuffer += chunk;
      if (stdoutSize > 4_000_000 || stdoutBuffer.length > 1_000_000) {
        finish(new Error("Codex model discovery output exceeded the size limit."));
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (!settled) stderrTail = (stderrTail + chunk).slice(-4000);
    });
    child.stdin.on("error", (error: Error) => {
      finish(new Error("Unable to write to Codex app-server: " + error.message));
    });
    child.once("error", (error: Error) => {
      finish(new Error(/ENOENT/i.test(error.message)
        ? "Codex CLI was not found. Install it, use Find in Better Canvas settings to locate it, or set its executable path."
        : "Unable to start Codex app-server: " + error.message));
    });
    child.once("close", (code: number | null) => {
      closed = true;
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      finish(new Error(
        "Codex app-server exited before returning the model list (code " + String(code) + ")." +
        (stderrTail.trim() ? " " + stderrTail.trim().slice(-1200) : " Check that the installed CLI supports app-server.")
      ));
    });

    void (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "obsidian-better-canvas", title: "Better Canvas", version: "0.1.0" }
        });
        send({ method: "initialized" });
        const models = new Map<string, CodexModelOption>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          const result = record(await request("model/list", {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {})
          }));
          if (!Array.isArray(result?.data)) throw new Error("Codex returned an invalid model list.");
          if (result.data.length > 1000) throw new Error("Codex returned too many models.");
          for (const value of result.data) {
            const model = record(value);
            if (model?.hidden === true || typeof model?.model !== "string") continue;
            const id = model.model.trim();
            if (!id || id.length > 1024) continue;
            const name = typeof model.displayName === "string" ? model.displayName.trim().slice(0, 1024) : "";
            if (!models.has(id)) models.set(id, { id, name: name || id });
            if (models.size > 1000) throw new Error("Codex returned too many models.");
          }
          if (result.nextCursor === undefined || result.nextCursor === null || result.nextCursor === "") {
            finish(undefined, [...models.values()]);
            return;
          }
          if (typeof result.nextCursor !== "string" || result.nextCursor.length > 4096 || cursors.has(result.nextCursor)) {
            throw new Error("Codex returned an invalid or repeated model-list cursor.");
          }
          cursor = result.nextCursor;
          cursors.add(cursor);
        }
        throw new Error("Codex model discovery exceeded the pagination limit.");
      } catch (error) {
        finish(options.signal?.aborted ? abortError() : error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}
