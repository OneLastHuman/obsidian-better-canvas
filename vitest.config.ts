import { defineConfig } from "vitest/config";

/**
 * The Obsidian runtime is supplied by the host app and its npm package does
 * not expose a loadable runtime entrypoint in Node-based unit tests. Mark the
 * bare module as resolvable so individual tests can provide vi.mock factories.
 */
export default defineConfig({
  plugins: [
    {
      name: "obsidian-virtual-module",
      enforce: "pre",
      resolveId(id) {
        if (id === "obsidian") return id;
      }
    }
  ]
});
