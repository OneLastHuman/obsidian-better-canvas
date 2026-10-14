import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "node:child_process", "node:os"],
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info"
});
