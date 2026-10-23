import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNodeRuntimeModules } from "./node-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Node runtime module resolution", () => {
  it("uses Obsidian's CommonJS bridge inside the renderer", async () => {
    const spawn = vi.fn();
    const tmpdir = vi.fn(() => "/tmp");
    const env = { PATH: "/bin" };
    const requireModule = vi.fn((id: string) => {
      if (id === "child_process") return { spawn };
      if (id === "os") return { tmpdir };
      if (id === "process") return { env, platform: "linux" };
      if (id === "fs") return { promises: {} };
      if (id === "path") return { join: vi.fn() };
      throw new Error("Unexpected module " + id);
    });
    vi.stubGlobal("window", { require: requireModule });

    const modules = await loadNodeRuntimeModules();
    expect(modules.childProcess.spawn).toBe(spawn);
    expect(modules.os.tmpdir).toBe(tmpdir);
    expect(modules.process.env).toBe(env);
    expect(requireModule.mock.calls.map(([id]) => id)).toEqual(["child_process", "os", "process", "fs", "path"]);
  });

  it("reports an actionable error when an Obsidian renderer has no Node bridge", async () => {
    vi.stubGlobal("window", {});
    await expect(loadNodeRuntimeModules()).rejects.toThrow(/MCP Streamable HTTP 或 SSE/);
  });
});
