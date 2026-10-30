import { findAgentBinary } from "./local-agent-discovery";
import type { NodeRuntimeModules } from "./node-runtime";

/**
 * Convert a command into something the OS can spawn directly. On Windows,
 * npm installs CLIs as .cmd/.bat shims that CreateProcess cannot execute, so
 * the shim's literal JavaScript target is read and launched with node.exe.
 * Native executables and other platforms are returned unchanged.
 */
export async function resolveLaunchCommand(
  binary: string, args: string[], runtime: NodeRuntimeModules
): Promise<{ binary: string; args: string[] }> {
  if (runtime.process.platform !== "win32") return { binary, args };
  const path = runtime.path;
  const io = runtime.fs?.promises;
  if (!path || !io) return { binary, args };
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
    // GUI apps often miss the Node.js directory on PATH; reuse executable discovery.
    const discoveredNode = findAgentBinary("node", runtime);
    if (discoveredNode) return { binary: discoveredNode, args: [resolved, ...args] };
  }
  return { binary: resolved, args };
}
