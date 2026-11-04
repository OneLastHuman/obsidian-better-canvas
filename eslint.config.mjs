import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript resolves type names; the core JS rule cannot distinguish them.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "error",
      // URLs, Vault paths and identifiers are data placeholders, not UI prose.
      "obsidianmd/ui/sentence-case": ["warn", {
        enforceCamelCaseLower: true,
        ignoreRegex: ["^https?://\\S+$", "^Better Canvas/(?:Generated Images|Flashcards)$", "^(?:better-canvas|canvas-edges)$"],
      }],
    },
  },
  globalIgnores([
    "node_modules", "dist", "build", "pkg", "coverage", "test-vault",
    ".obsidian", "**/.obsidian/**", "main.js", "release/**",
    // Release metadata has its own validator; these files are not TypeScript.
    "manifest.json", "package.json", "package-lock.json", "tsconfig.json", "versions.json",
    "vitest.config.ts",
    "**/*.test.*", "**/*.tests.*", "**/*.spec.*", "**/*.specs.*",
    "**/test/**", "**/tests/**", "**/__tests__/**", "**/mocks/**", "**/__mocks__/**",
    "**/*.cjs", "**/*.mjs", "**/*.cts", "**/*.mts",
    "**/scripts/**", "**/docs/**", ".github/**", "INTEGRATION_STATUS.md",
  ]),
);
