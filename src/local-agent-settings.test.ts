import { describe, expect, it } from "vitest";
import {
  LOCAL_AGENTS,
  isAdditionalAgentBackend,
  isLocalAgentBackend,
  localAgentConfig,
  localAgentDefinition,
  localModelChoices,
  updateLocalAgentConfig
} from "./local-agent-settings";

describe("local agent configuration", () => {
  it("recognizes the nine supported backends without misclassifying API or unknown values", () => {
    expect(new Set(LOCAL_AGENTS.map(agent => agent.id)).size).toBe(9);
    for (const backend of ["codex-cli", "opencode-acp", "claude-code", "cursor-agent", "gemini-cli", "copilot-cli", "qwen-code", "aider", "bob"]) {
      expect(isLocalAgentBackend(backend)).toBe(true);
      expect(localAgentDefinition(backend)?.binary).toBeTruthy();
    }
    expect(isAdditionalAgentBackend("codex-cli")).toBe(false);
    expect(isAdditionalAgentBackend("opencode-acp")).toBe(false);
    expect(isAdditionalAgentBackend("claude-code")).toBe(true);
    for (const value of ["api", "unknown", null, undefined, {}, 1]) {
      expect(isLocalAgentBackend(value)).toBe(false);
      expect(isAdditionalAgentBackend(value)).toBe(false);
      expect(localAgentDefinition(value)).toBeUndefined();
    }
  });

  it("reads legacy Codex/OpenCode settings and treats missing or invalid model values as the CLI default", () => {
    const settings = {
      codexBinaryPath: " /tools/codex ",
      codexModel: " custom-codex ",
      opencodeBinaryPath: " /tools/opencode ",
      opencodeModel: null,
      localAgents: { "claude-code": { binaryPath: 7, model: " opus " } }
    };
    expect(localAgentConfig(settings, "codex-cli")).toEqual({ binaryPath: "/tools/codex", model: "custom-codex" });
    expect(localAgentConfig(settings, "opencode-acp")).toEqual({ binaryPath: "/tools/opencode", model: "" });
    expect(localAgentConfig(settings, "claude-code")).toEqual({ binaryPath: "", model: "opus" });
    expect(localAgentConfig(settings, "aider")).toEqual({ binaryPath: "", model: "" });
    expect(settings.codexBinaryPath).toBe(" /tools/codex ");
    expect(settings.localAgents["claude-code"].model).toBe(" opus ");
  });

  it("updates one field without overwriting the executable, other backend configurations, or API model", () => {
    const settings = {
      model: "api-model",
      codexBinaryPath: "/tools/codex",
      codexModel: "codex-original",
      opencodeBinaryPath: "/tools/opencode",
      opencodeModel: "provider/original",
      localAgents: {
        "claude-code": { binaryPath: "/tools/claude", model: "sonnet" },
        aider: { binaryPath: "/tools/aider", model: "aider-original" }
      }
    };
    updateLocalAgentConfig(settings, "codex-cli", { model: "codex-updated" });
    updateLocalAgentConfig(settings, "opencode-acp", { model: "" });
    updateLocalAgentConfig(settings, "claude-code", { model: "opus" });
    expect(settings.codexBinaryPath).toBe("/tools/codex");
    expect(settings.codexModel).toBe("codex-updated");
    expect(settings.opencodeBinaryPath).toBe("/tools/opencode");
    expect(settings.opencodeModel).toBe("");
    expect(settings.localAgents["claude-code"]).toEqual({ binaryPath: "/tools/claude", model: "opus" });
    expect(settings.localAgents.aider).toEqual({ binaryPath: "/tools/aider", model: "aider-original" });
    expect(settings.model).toBe("api-model");
  });

  it("creates only the selected additional agent configuration when upgrading older settings", () => {
    const settings: Record<string, unknown> = { codexModel: "retained" };
    updateLocalAgentConfig(settings, "gemini-cli", { model: "custom-gemini" });
    expect(settings).toEqual({
      codexModel: "retained",
      localAgents: { "gemini-cli": { binaryPath: "", model: "custom-gemini" } }
    });
  });
});

describe("local model dropdown choices", () => {
  it("deduplicates catalog entries and retains a selected model missing from the catalog", () => {
    const models = [
      { id: "first", name: "First" },
      { id: "first", name: "Updated First" },
      { id: "", name: "Invalid" },
      { id: "second", name: "Second" }
    ];
    expect(localModelChoices(models, "custom")).toEqual([
      { id: "first", name: "Updated First" },
      { id: "second", name: "Second" },
      { id: "custom", name: "custom" }
    ]);
    expect(models).toHaveLength(4);
  });

  it("does not replace a catalog label for the selected model or invent a nonempty default", () => {
    expect(localModelChoices([{ id: "selected", name: "Selected Name" }], "selected")).toEqual([
      { id: "selected", name: "Selected Name" }
    ]);
    expect(localModelChoices([], "")).toEqual([]);
  });
});
