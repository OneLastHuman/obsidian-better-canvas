export interface NodeRuntimeModules {
  childProcess: any;
  os: any;
  process: any;
}

/**
 * Resolve Node modules from Obsidian's Electron renderer bridge. Native
 * dynamic imports of node: specifiers fail from app://obsidian.md; the
 * dynamic-import fallback is retained only for Node-based unit tests.
 */
export async function loadNodeRuntimeModules(): Promise<NodeRuntimeModules> {
  const host = globalThis as any;
  const rendererWindow = host.window;
  if (rendererWindow) {
    const requireModule = rendererWindow.require;
    if (typeof requireModule !== "function") {
      throw new Error(
        "当前 Obsidian 渲染环境无法访问本机 Node.js 子进程模块。请使用 MCP Streamable HTTP 或 SSE，或更新到提供 CommonJS 桥接的 Obsidian 桌面版本。"
      );
    }
    try {
      return {
        childProcess: requireModule.call(rendererWindow, "child_process"),
        os: requireModule.call(rendererWindow, "os"),
        process: requireModule.call(rendererWindow, "process")
      };
    } catch (error) {
      throw new Error(
        "无法从 Obsidian 桌面运行时加载本机进程模块：" +
        (error instanceof Error ? error.message : String(error))
      );
    }
  }

  // Vitest/Node runtime fallback; browser builds should always use window.require above.
  const [childProcess, os, processModule] = await Promise.all([
    import("node:child_process"),
    import("node:os"),
    import("node:process")
  ]);
  return { childProcess, os, process: processModule.default ?? processModule };
}
