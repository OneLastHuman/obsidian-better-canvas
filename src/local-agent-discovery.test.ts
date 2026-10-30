import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agentBinaryCandidates,
  clearAgentDiscoveryCache,
  findAgentBinary,
  resolveAgentBinary,
  type AgentBinaryCandidatesInput
} from "./local-agent-discovery";
import type { NodeRuntimeModules } from "./node-runtime";

function fakeFileSystem(files: string[], directories: Record<string, string[]> = {}) {
  const present = new Set(files.map(file => path.normalize(file)));
  return {
    statSync(file: string) {
      if (present.has(path.normalize(file))) return { isFile: () => true };
      throw new Error("ENOENT: " + file);
    },
    readdirSync(directory: string) {
      const entries = directories[path.normalize(directory)];
      if (!entries) throw new Error("ENOENT: " + directory);
      return entries.map(name => ({ name, isDirectory: () => true }));
    }
  };
}

function testRuntime(options: {
  platform?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  files?: string[];
  directories?: Record<string, string[]>;
} = {}): NodeRuntimeModules {
  return {
    childProcess: {},
    os: { homedir: () => options.home ?? "/home/tester" },
    process: { platform: options.platform ?? "linux", env: options.env ?? { PATH: "/usr/bin:/bin" } },
    fs: fakeFileSystem(options.files ?? [], options.directories ?? {}),
    path
  };
}

function candidates(name: string, overrides: Partial<AgentBinaryCandidatesInput> = {}): string[] {
  return agentBinaryCandidates(name, {
    platform: "linux",
    env: { PATH: "/usr/bin:/bin", HOME: "/home/tester" },
    home: "/home/tester",
    path,
    ...overrides
  });
}

beforeEach(() => {
  clearAgentDiscoveryCache();
});

describe("agent binary candidate paths", () => {
  it("searches PATH first, then install directories GUI apps often miss", () => {
    const list = candidates("opencode");
    expect(list[0]).toBe("/usr/bin/opencode");
    expect(list).toEqual(expect.arrayContaining([
      "/opt/homebrew/bin/opencode",
      "/usr/local/bin/opencode",
      "/home/tester/.opencode/bin/opencode",
      "/home/tester/.local/bin/opencode",
      "/home/tester/.bun/bin/opencode",
      "/home/tester/.nix-profile/bin/opencode",
      "/run/current-system/sw/bin/opencode"
    ]));
  });

  it("expands mise tool installs and the shared node runtime", () => {
    const list = candidates("opencode", {
      fs: fakeFileSystem([], {
        "/home/tester/.local/share/mise/installs/opencode": ["latest"],
        "/home/tester/.local/share/mise/installs/node": ["26.7.0"]
      })
    });
    expect(list).toEqual(expect.arrayContaining([
      "/home/tester/.local/share/mise/installs/opencode/latest/opencode",
      "/home/tester/.local/share/mise/installs/opencode/latest/bin/opencode",
      "/home/tester/.local/share/mise/installs/node/26.7.0/bin/opencode"
    ]));
  });

  it("deduplicates directories shared by PATH and the known list", () => {
    const list = candidates("codex", { env: { PATH: "/usr/local/bin:/usr/bin" } });
    expect(list.filter(file => file === "/usr/local/bin/codex")).toHaveLength(1);
  });

  it("expands version-manager node directories", () => {
    const list = candidates("codex", {
      fs: fakeFileSystem([], { "/home/tester/.nvm/versions/node": ["v20.11.0", "v22.3.0"] })
    });
    expect(list).toEqual(expect.arrayContaining([
      "/home/tester/.nvm/versions/node/v20.11.0/bin/codex",
      "/home/tester/.nvm/versions/node/v22.3.0/bin/codex"
    ]));
  });

  it("uses PATHEXT on Windows and can restrict results to native executables", () => {
    const env = {
      Path: "C:\\tools",
      PATHEXT: ".EXE;.CMD",
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      ProgramData: "C:\\ProgramData"
    };
    const home = "C:\\Users\\tester";
    const all = agentBinaryCandidates("codex", { platform: "win32", env, home, path: path.win32 });
    expect(all.slice(0, 2)).toEqual(["C:\\tools\\codex.exe", "C:\\tools\\codex.cmd"]);
    expect(all).toEqual(expect.arrayContaining([
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.exe",
      "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe",
      "C:\\ProgramData\\chocolatey\\bin\\codex.exe"
    ]));
    const native = agentBinaryCandidates("codex", {
      platform: "win32", env, home, path: path.win32, windowsExtensions: [".exe"]
    });
    expect(native[0]).toBe("C:\\tools\\codex.exe");
    expect(native.some(file => file.toLowerCase().endsWith(".cmd"))).toBe(false);
  });

  it("keeps an explicit executable path untouched", () => {
    expect(candidates("/opt/custom/bin/opencode")).toEqual(["/opt/custom/bin/opencode"]);
  });
});

describe("agent binary lookup", () => {
  it("finds a CLI that the app PATH does not expose", () => {
    const runtime = testRuntime({
      env: { PATH: "/usr/bin:/bin" },
      files: ["/home/tester/.opencode/bin/opencode"]
    });
    expect(findAgentBinary("opencode", runtime)).toBe("/home/tester/.opencode/bin/opencode");
  });

  it("prefers the first PATH match", () => {
    const runtime = testRuntime({
      env: { PATH: "/opt/one:/opt/two" },
      files: ["/opt/two/opencode", "/opt/one/opencode"]
    });
    expect(findAgentBinary("opencode", runtime)).toBe("/opt/one/opencode");
  });

  it("does not guess when the runtime exposes no PATH", () => {
    const runtime = testRuntime({ env: {}, files: ["/usr/bin/codex"] });
    expect(findAgentBinary("codex", runtime)).toBeNull();
  });

  it("drops a cached path once the executable disappears", () => {
    const files = new Set(["/usr/bin/codex"]);
    const runtime: NodeRuntimeModules = {
      ...testRuntime({ env: { PATH: "/usr/bin" } }),
      fs: {
        statSync: (file: string) => {
          if (files.has(file)) return { isFile: () => true };
          throw new Error("ENOENT");
        },
        readdirSync: () => { throw new Error("ENOENT"); }
      }
    };
    expect(findAgentBinary("codex", runtime)).toBe("/usr/bin/codex");
    files.clear();
    expect(findAgentBinary("codex", runtime)).toBeNull();
  });
});

describe("executable resolution", () => {
  it("uses a configured absolute path without scanning", () => {
    expect(resolveAgentBinary("/opt/custom/codex", "codex", testRuntime())).toBe("/opt/custom/codex");
  });

  it("expands a leading home directory", () => {
    expect(resolveAgentBinary("~/bin/opencode", "opencode", testRuntime())).toBe("/home/tester/bin/opencode");
  });

  it("strips surrounding quotes from a pasted path", () => {
    expect(resolveAgentBinary('"/opt/custom/codex"', "codex", testRuntime())).toBe("/opt/custom/codex");
  });

  it("replaces a bare command with the discovered path", () => {
    const runtime = testRuntime({ files: ["/home/tester/.bun/bin/codex"] });
    expect(resolveAgentBinary("", "codex", runtime)).toBe("/home/tester/.bun/bin/codex");
    expect(resolveAgentBinary("codex", "codex", runtime)).toBe("/home/tester/.bun/bin/codex");
  });

  it("falls back to the bare command so spawn reports its own error", () => {
    expect(resolveAgentBinary("", "codex", testRuntime({ files: [] }))).toBe("codex");
  });
});
