import { t } from "./i18n";
import type * as ChildProcess from "node:child_process";
import type * as Os from "node:os";
import type * as Process from "node:process";
import type * as Fs from "node:fs";
import type * as Path from "node:path";

export interface NodeRuntimeModules {
  childProcess: typeof ChildProcess;
  os: typeof Os;
  process: typeof Process;
  fs: typeof Fs;
  path: typeof Path;
}

interface RendererModules {
  child_process: NodeRuntimeModules["childProcess"];
  os: NodeRuntimeModules["os"];
  process: NodeRuntimeModules["process"];
  fs: NodeRuntimeModules["fs"];
  path: NodeRuntimeModules["path"];
}

/**
 * Resolve Node modules from Obsidian's Electron renderer bridge. Native
 * dynamic imports of node: specifiers fail from app://obsidian.md; the
 * dynamic-import fallback is retained only for Node-based unit tests.
 */
export async function loadNodeRuntimeModules(): Promise<NodeRuntimeModules> {
  const rendererWindow = typeof window === "undefined" ? undefined : window;
  if (rendererWindow) {
    const bridge: unknown = "require" in rendererWindow ? rendererWindow.require : undefined;
    if (typeof bridge !== "function") {
      throw new Error(
        t("This Obsidian renderer cannot access local Node.js child process modules. Use MCP Streamable HTTP or SSE, or update to an Obsidian desktop version that provides the CommonJS bridge.", "当前 Obsidian 渲染环境无法访问本机 Node.js 子进程模块。请使用 MCP Streamable HTTP 或 SSE，或更新到提供 CommonJS 桥接的 Obsidian 桌面版本。")
      );
    }
    // Electron's CommonJS bridge resolves these five builtins with their Node types.
    const requireModule = <Name extends keyof RendererModules>(name: Name): RendererModules[Name] => {
      const loaded: unknown = Reflect.apply(bridge, rendererWindow, [name]);
      return loaded as RendererModules[Name];
    };
    try {
      return {
        childProcess: requireModule("child_process"),
        os: requireModule("os"),
        process: requireModule("process"),
        fs: requireModule("fs"),
        path: requireModule("path")
      };
    } catch (error) {
      throw new Error(
        t("Could not load local process modules from the Obsidian desktop runtime: ", "无法从 Obsidian 桌面运行时加载本机进程模块：") +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  // Vitest/Node runtime fallback; browser builds should always use window.require above.
  const [childProcess, os, processModule, fs, path] = await Promise.all([
    import("node:child_process"),
    import("node:os"),
    import("node:process"),
    import("node:fs"),
    import("node:path")
  ]);
  return { childProcess, os, process: processModule.default ?? processModule, fs, path };
}
