import { parseCodexJsonEvent } from "./codex-cli-events";

export interface LocalCodexOptions {
  binaryPath?: string;
  timeoutMs?: number;
  signal: AbortSignal;
  onProgress?: (message: string) => void;
}

function abortError(): Error {
  const error = new Error("Local Codex generation was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * Run the installed Codex CLI without a shell wrapper or a Vault working
 * directory. Codex receives the prompt over stdin and is restricted to the
 * read-only sandbox; this helper never passes arbitrary shell commands.
 */
export async function runLocalCodex(prompt: string, options: LocalCodexOptions): Promise<string> {
  if (options.signal.aborted) throw abortError();

  // Dynamic imports keep Node-only modules out of the normal/mobile plugin load path.
  const [{ spawn }, { tmpdir }] = await Promise.all([
    import("node:child_process"),
    import("node:os")
  ]);

  if (options.signal.aborted) throw abortError();
  const binary = options.binaryPath?.trim() || "codex";
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 300_000, 10_000), 900_000);
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-"
  ];

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = "";
    let stderrTail = "";
    let streamedText = "";
    let finalText = "";
    let fatalEvent = "";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, args, {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false
      });
    } catch (error) {
      reject(error);
      return;
    }

    const removeListeners = () => {
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal.removeEventListener("abort", onAbort);
    };

    const finish = (error?: Error, output?: string) => {
      if (settled) return;
      settled = true;
      removeListeners();
      if (error) reject(error);
      else resolve(String(output ?? ""));
    };

    const terminate = () => {
      if (settled) return;
      try { child.kill("SIGTERM"); } catch { /* child may have exited */ }
      forceKill = setTimeout(() => {
        if (!settled) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }, 1500);
    };

    const onAbort = () => {
      terminate();
      finish(abortError());
    };

    options.signal.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      terminate();
      finish(new Error("Local Codex timed out after " + Math.round(timeoutMs / 1000) + " seconds."));
    }, timeoutMs);

    child.once("error", (error: Error) => {
      const message = /ENOENT/i.test(error.message)
        ? "找不到 Codex CLI。请安装并登录 Codex CLI，或在 Better Canvas 设置中填写 codex 可执行文件的完整路径。"
        : "无法启动 Codex CLI：" + error.message;
      finish(new Error(message));
    });

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      if (stdoutBuffer.length > 1_000_000) {
        terminate();
        finish(new Error("Codex CLI 输出超过 1 MB，已终止以保护内存。"));
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    });

    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-8000);
    });

    const consumeLine = (line: string) => {
      if (!line.trim() || settled) return;
      const event = parseCodexJsonEvent(line);
      if (!event) return;
      if (event.error) {
        fatalEvent = event.error;
        return;
      }
      if (event.textDelta) streamedText += event.textDelta;
      if (event.finalText !== undefined) finalText = event.finalText;
      if (event.textDelta || event.finalText !== undefined) {
        options.onProgress?.("Codex 正在生成回复…");
      }
    };

    child.once("close", (code: number | null, signalName: string | null) => {
      if (settled) return;
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
      if (settled) return;

      if (fatalEvent) {
        finish(new Error("Codex 执行失败：" + fatalEvent + (stderrTail ? "\n" + stderrTail.trim() : "")));
        return;
      }
      if (code !== 0) {
        const detail = stderrTail.trim();
        finish(new Error(
          "Codex CLI 退出，状态码 " + String(code) +
          (signalName ? "（signal " + signalName + "）" : "") +
          (detail ? "：" + detail.slice(-3000) : "。请确认 Codex 已安装且已完成登录。")
        ));
        return;
      }

      const answer = finalText.trim() || streamedText.trim();
      if (!answer) {
        finish(new Error("Codex CLI 已结束，但没有返回可用的助手文本。"));
        return;
      }
      finish(undefined, answer);
    });

    child.stdin!.once("error", (error: Error) => {
      if (!settled) finish(new Error("无法向 Codex CLI 发送提示词：" + error.message));
    });
    child.stdin!.end(prompt + "\n");
  });
}
