import { loadNodeRuntimeModules, type NodeRuntimeModules } from "./node-runtime";

/** Executable suffixes tried on Windows when a command name has no extension. */
const DEFAULT_WINDOWS_EXTENSIONS = [".com", ".exe", ".bat", ".cmd"];
const MAX_VERSION_DIRECTORIES = 24;

export interface AgentBinarySearchOptions {
  /**
   * Windows executable suffixes to accept. Defaults to PATHEXT, then
   * .com/.exe/.bat/.cmd. Backends that spawn without a shell pass [".exe"]
   * because CreateProcess cannot run .cmd shims directly.
   */
  windowsExtensions?: readonly string[];
}

interface PathLike {
  join(...parts: string[]): string;
}

interface DirectoryEntry {
  name: string;
  isDirectory?(): boolean;
}

interface FileSystemLike {
  statSync(file: string): { isFile?(): boolean } | unknown;
  readdirSync(directory: string, options: { withFileTypes: true }): DirectoryEntry[];
}

export interface AgentBinaryCandidatesInput {
  platform: string;
  env: Record<string, string | undefined>;
  home: string;
  path: PathLike;
  fs?: FileSystemLike;
  windowsExtensions?: readonly string[];
}

const discoveredBinaries = new Map<string, string>();

/** Clears successful lookups; used by tests and after reinstallation. */
export function clearAgentDiscoveryCache(): void {
  discoveredBinaries.clear();
}

function envValue(env: Record<string, string | undefined>, ...names: string[]): string {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function splitSearchPath(value: string, platform: string): string[] {
  return value
    .split(platform === "win32" ? ";" : ":")
    .map(entry => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function executableNames(name: string, context: AgentBinaryCandidatesInput): string[] {
  if (context.platform !== "win32" || /\.[^\\/]+$/.test(name)) return [name];
  const pathext = splitSearchPath(envValue(context.env, "PATHEXT"), "win32");
  const configured = context.windowsExtensions?.length
    ? context.windowsExtensions
    : pathext.length ? pathext : DEFAULT_WINDOWS_EXTENSIONS;
  const names = new Set<string>();
  for (const extension of configured) {
    const suffix = extension.toLowerCase().startsWith(".") ? extension : "." + extension;
    names.add(name + suffix.toLowerCase());
  }
  return [...names];
}

function versionDirectories(
  context: AgentBinaryCandidatesInput,
  roots: Array<[string, string[]]>
): string[] {
  const { fs, path } = context;
  if (!fs?.readdirSync) return [];
  const directories: string[] = [];
  for (const [root, suffix] of roots) {
    let entries: DirectoryEntry[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const versions = entries
      .filter(entry => entry && (typeof entry.isDirectory !== "function" || entry.isDirectory()))
      .map(entry => String(entry.name))
      .sort()
      .reverse()
      .slice(0, MAX_VERSION_DIRECTORIES);
    for (const version of versions) directories.push(path.join(root, version, ...suffix));
  }
  return directories;
}

/** Installation directories worth probing when the app's PATH is incomplete. */
function searchDirectories(context: AgentBinaryCandidatesInput, command: string): string[] {
  const { platform, env, home, path } = context;
  const directories: string[] = [];
  const add = (directory: unknown) => {
    if (typeof directory === "string" && directory.trim()) directories.push(directory.trim());
  };

  for (const directory of splitSearchPath(envValue(env, "PATH", "Path"), platform)) add(directory);
  add(envValue(env, "PNPM_HOME"));
  const bunInstall = envValue(env, "BUN_INSTALL");
  if (bunInstall) add(path.join(bunInstall, "bin"));
  const voltaHome = envValue(env, "VOLTA_HOME");
  if (voltaHome) add(path.join(voltaHome, "bin"));
  const cargoHome = envValue(env, "CARGO_HOME");
  if (cargoHome) add(path.join(cargoHome, "bin"));
  add(envValue(env, "NVM_BIN"));
  add(envValue(env, "NVM_SYMLINK"));
  add(envValue(env, "OPENCODE_INSTALL_DIR"));
  const xdgDataHome = envValue(env, "XDG_DATA_HOME");
  if (xdgDataHome) add(path.join(xdgDataHome, "pnpm"));

  if (platform === "win32") {
    const appData = envValue(env, "APPDATA");
    const localAppData = envValue(env, "LOCALAPPDATA");
    const programData = envValue(env, "ProgramData");
    const programFiles = envValue(env, "ProgramFiles");
    if (appData) add(path.join(appData, "npm"));
    if (localAppData) {
      add(path.join(localAppData, "pnpm"));
      add(path.join(localAppData, "Volta", "bin"));
      add(path.join(localAppData, "Microsoft", "WinGet", "Links"));
      add(path.join(localAppData, "Programs", "nodejs"));
      add(path.join(localAppData, "Yarn", "bin"));
    }
    if (programData) add(path.join(programData, "chocolatey", "bin"));
    if (programFiles) add(path.join(programFiles, "nodejs"));
    add(envValue(env, "NVM_HOME"));
    if (home) {
      add(path.join(home, "scoop", "shims"));
      add(path.join(home, ".bun", "bin"));
      add(path.join(home, ".local", "bin"));
      add(path.join(home, ".cargo", "bin"));
      add(path.join(home, ".opencode", "bin"));
      add(path.join(home, ".npm-global", "bin"));
    }
    if (localAppData) {
      const miseInstalls = path.join(localAppData, "mise", "installs");
      directories.push(...versionDirectories(context, [
        [path.join(miseInstalls, command), []],
        [path.join(miseInstalls, command), ["bin"]],
        [path.join(miseInstalls, "node"), ["bin"]]
      ]));
    }
    return directories;
  }

  add("/opt/homebrew/bin");
  add("/usr/local/bin");
  add("/usr/local/sbin");
  add("/opt/local/bin");
  add("/home/linuxbrew/.linuxbrew/bin");
  add("/usr/bin");
  add("/bin");
  add("/snap/bin");
  add("/run/current-system/sw/bin");
  if (home) {
    add(path.join(home, ".local", "bin"));
    add(path.join(home, ".bun", "bin"));
    add(path.join(home, ".npm-global", "bin"));
    add(path.join(home, ".opencode", "bin"));
    add(path.join(home, ".cargo", "bin"));
    add(path.join(home, ".volta", "bin"));
    add(path.join(home, ".asdf", "shims"));
    add(path.join(home, ".local", "share", "mise", "shims"));
    add(path.join(home, ".local", "share", "pnpm"));
    add(path.join(home, "Library", "pnpm"));
    add(path.join(home, ".local", "share", "fnm", "aliases", "default", "bin"));
    add(path.join(home, "n", "bin"));
    add(path.join(home, ".nvm", "current", "bin"));
    add(path.join(home, ".nix-profile", "bin"));
    directories.push(...versionDirectories(context, [
      [path.join(home, ".nvm", "versions", "node"), ["bin"]],
      [path.join(home, "Library", "Application Support", "fnm", "node-versions"), ["installation", "bin"]],
      [path.join(home, ".local", "share", "fnm", "node-versions"), ["installation", "bin"]]
    ]));
    const miseInstalls = path.join(home, ".local", "share", "mise", "installs");
    directories.push(...versionDirectories(context, [
      [path.join(miseInstalls, command), []],
      [path.join(miseInstalls, command), ["bin"]],
      [path.join(miseInstalls, "node"), ["bin"]]
    ]));
  }
  return directories;
}

/** Ordered executable paths for a command name, PATH first, then common installs. */
export function agentBinaryCandidates(name: string, context: AgentBinaryCandidatesInput): string[] {
  const command = name.trim();
  if (!command) return [];
  if (/[\\/]/.test(command)) return [command];

  const { path } = context;
  const files = executableNames(command, context);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const directory of searchDirectories(context, command)) {
    for (const file of files) {
      const fullPath = path.join(directory, file);
      const key = context.platform === "win32" ? fullPath.toLowerCase() : fullPath;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(fullPath);
    }
  }
  return candidates;
}

function isExecutableFile(fs: FileSystemLike, file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (stat && typeof stat === "object" && "isFile" in stat) {
      return typeof stat.isFile === "function" ? stat.isFile() : false;
    }
    return Boolean(stat);
  } catch {
    return false;
  }
}

/**
 * Locate an installed CLI in PATH and in directories that GUI apps commonly
 * miss (Homebrew, npm global, Bun, Volta, nvm/fnm, ~/.local/bin, ~/.opencode).
 * Returns null when the process environment has no PATH to search.
 */
export function findAgentBinary(
  name: string,
  runtime: NodeRuntimeModules,
  options: AgentBinarySearchOptions = {}
): string | null {
  const command = name.trim();
  if (!command) return null;
  const fs = runtime.fs as FileSystemLike | undefined;
  const path = runtime.path as PathLike | undefined;
  if (!fs?.statSync || !path?.join) return null;

  const platform = runtime.process?.platform ?? "linux";
  const env = (runtime.process?.env ?? {}) as Record<string, string | undefined>;
  const searchPath = envValue(env, "PATH", "Path");
  // Without a PATH there is nothing reliable to search; let spawn do its own lookup.
  if (!searchPath) return null;
  const home = typeof runtime.os?.homedir === "function"
    ? String(runtime.os.homedir() ?? "")
    : envValue(env, "HOME", "USERPROFILE");
  const extensions = options.windowsExtensions?.join(",") ?? "";
  const cacheKey = [platform, command, searchPath, extensions].join("\u0000");

  const cached = discoveredBinaries.get(cacheKey);
  if (cached) {
    if (isExecutableFile(fs, cached)) return cached;
    discoveredBinaries.delete(cacheKey);
  }

  for (const candidate of agentBinaryCandidates(command, {
    platform, env, home, path, fs, windowsExtensions: options.windowsExtensions
  })) {
    if (isExecutableFile(fs, candidate)) {
      discoveredBinaries.set(cacheKey, candidate);
      return candidate;
    }
  }
  return null;
}

function expandHome(value: string, runtime: NodeRuntimeModules, env: Record<string, string | undefined>): string {
  if (!/^~[\\/]/.test(value)) return value;
  const home = typeof runtime.os?.homedir === "function"
    ? String(runtime.os.homedir() ?? "")
    : envValue(env, "HOME", "USERPROFILE");
  if (!home) return value;
  return runtime.path?.join ? runtime.path.join(home, value.slice(2)) : value;
}

/**
 * Resolve the executable used for spawn: an explicit path is used as-is,
 * otherwise the command name is looked up in PATH and common install
 * directories. Falls back to the bare name so spawn's own error is preserved.
 */
export function resolveAgentBinary(
  configured: string | undefined,
  fallback: string,
  runtime: NodeRuntimeModules,
  options: AgentBinarySearchOptions = {}
): string {
  const env = (runtime.process?.env ?? {}) as Record<string, string | undefined>;
  const raw = (configured ?? "").trim().replace(/^"|"$/g, "").trim();
  const value = expandHome(raw, runtime, env);
  if (value && /[\\/]/.test(value)) return value;
  const command = value || fallback;
  return findAgentBinary(command, runtime, options) ?? command;
}

/** User-initiated lookup used by the settings "Find" button. */
export async function discoverAgentBinary(
  name: string,
  options: AgentBinarySearchOptions = {}
): Promise<string | null> {
  const runtime = await loadNodeRuntimeModules();
  return findAgentBinary(name, runtime, options);
}
