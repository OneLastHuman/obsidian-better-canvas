import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

const securityRules = new Set([
  "no-eval",
  "no-implied-eval",
  "no-unsanitized/method",
  "no-unsanitized/property",
  "obsidianmd/regex-lookbehind",
]);

function withSeverity(ruleConfig, severity) {
  if (Array.isArray(ruleConfig)) {
    const [currentSeverity, ...options] = ruleConfig;
    if (currentSeverity === "off" || currentSeverity === 0) return ruleConfig;
    return [severity, ...options];
  }
  if (ruleConfig === "off" || ruleConfig === 0) return ruleConfig;
  return severity;
}

const recommendedRules = Object.assign(
  {},
  ...obsidianmd.configs.recommended.map((config) => config.rules ?? {}),
);

// Keep existing findings advisory while the codebase adopts the official rules.
// Security-sensitive rules below remain errors from the first rollout.
const migrationRules = Object.fromEntries(
  Object.entries(recommendedRules).map(([name, ruleConfig]) => [
    name,
    withSeverity(ruleConfig, securityRules.has(name) ? "error" : "warn"),
  ]),
);

for (const rule of securityRules) {
  migrationRules[rule] = "error";
}

Object.assign(migrationRules, {
  // These are covered by TypeScript or too noisy for the initial migration.
  "no-undef": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
  "@typescript-eslint/no-base-to-string": "off",
  "import/no-unresolved": "off",

  // These checks are handled separately or need project-specific review.
  "obsidianmd/validate-manifest": "off",
  "obsidianmd/validate-license": "off",
  "obsidianmd/commands/no-command-in-command-id": "off",
  "obsidianmd/commands/no-plugin-id-in-command-id": "off",
});

export default defineConfig(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: migrationRules,
  },
  globalIgnores([
    "node_modules",
    "dist",
    "build",
    "pkg",
    "coverage",
    "test-vault",
    ".obsidian",
    "**/.obsidian/**",
    "main.js",
    // Manifest JSON is checked by the dedicated metadata validator, not the TS parser.
    "manifest.json",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "versions.json",
    "esbuild.config.mjs",
    "vitest.config.ts",
    "**/*.test.*",
    "**/*.tests.*",
    "**/*.spec.*",
    "**/*.specs.*",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/mocks/**",
    "**/__mocks__/**",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.cts",
    "**/*.mts",
    "**/scripts/**",
    "**/docs/**",
    ".github/**",
    "INTEGRATION_STATUS.md",
  ]),
);
