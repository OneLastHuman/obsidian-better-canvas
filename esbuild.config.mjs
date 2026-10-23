import esbuild from "esbuild";
import process from "node:process";
import { readFileSync } from "node:fs";

const production = process.argv[2] === "production";
const sketchFont = "data:font/woff2;base64," +
  readFileSync(new URL("./src/assets/sketch-hand.woff2", import.meta.url)).toString("base64");
const softNotesFont = "data:font/woff2;base64," +
  readFileSync(new URL("./src/assets/soft-notes-title.woff2", import.meta.url)).toString("base64");

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "node:child_process", "node:os", "node:process", "node:fs", "node:path"],
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  define: {
    __BC_SKETCH_FONT_DATA_URL__: JSON.stringify(sketchFont),
    __BC_SOFT_NOTES_FONT_DATA_URL__: JSON.stringify(softNotesFont)
  },
  logLevel: "info"
});
