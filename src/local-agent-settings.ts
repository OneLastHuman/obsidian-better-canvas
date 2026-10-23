export type AdditionalAgentBackend =
  | "claude-code" | "cursor-agent" | "gemini-cli" | "copilot-cli"
  | "qwen-code" | "aider" | "bob";

export type LocalAgentBackend = "codex-cli" | "opencode-acp" | AdditionalAgentBackend;
export type TextBackend = "api" | LocalAgentBackend;

export interface LocalAgentConfig {
  binaryPath: string;
  model: string;
}

export interface LocalModelOption {
  id: string;
  name: string;
}

interface LocalAgentDefinition {
  id: LocalAgentBackend;
  name: string;
  binary: string;
  models: LocalModelOption[];
  discovery?: boolean;
  supportsModel?: false;
}

function presets(...ids: string[]): LocalModelOption[] {
  return ids.map(id => ({ id, name: id }));
}

// Presets are editable model IDs, not an account entitlement or availability check.
export const LOCAL_AGENTS: readonly LocalAgentDefinition[] = [
  { id: "codex-cli", name: "Codex CLI", binary: "codex", models: [], discovery: true },
  { id: "opencode-acp", name: "OpenCode ACP", binary: "opencode", models: [], discovery: true },
  { id: "claude-code", name: "Claude Code", binary: "claude", models: presets("sonnet", "opus", "haiku") },
  { id: "cursor-agent", name: "Cursor Agent", binary: "cursor-agent", models: presets("auto", "sonnet-4", "sonnet-4-thinking", "gpt-5") },
  { id: "gemini-cli", name: "Gemini CLI", binary: "gemini", models: presets("gemini-2.5-pro", "gemini-2.5-flash") },
  { id: "copilot-cli", name: "GitHub Copilot CLI", binary: "copilot", models: presets("claude-sonnet-4.6", "gpt-5.2") },
  { id: "qwen-code", name: "Qwen Coder", binary: "qwen", models: presets("qwen3-coder-plus", "qwen3-coder-flash") },
  { id: "aider", name: "Aider", binary: "aider", models: presets("claude-sonnet-4-5", "gpt-5", "deepseek/deepseek-chat") },
  { id: "bob", name: "IBM Bob", binary: "bob", models: [], supportsModel: false }
];

export function localAgentDefinition(backend: unknown): LocalAgentDefinition | undefined {
  return LOCAL_AGENTS.find(agent => agent.id === backend);
}

export function isLocalAgentBackend(backend: unknown): backend is LocalAgentBackend {
  return localAgentDefinition(backend) !== undefined;
}

export function isAdditionalAgentBackend(backend: unknown): backend is AdditionalAgentBackend {
  return isLocalAgentBackend(backend) && backend !== "codex-cli" && backend !== "opencode-acp";
}

export function localAgentConfig(settings: Record<string, any>, backend: LocalAgentBackend): LocalAgentConfig {
  const config = backend === "codex-cli"
    ? { binaryPath: settings.codexBinaryPath, model: settings.codexModel }
    : backend === "opencode-acp"
      ? { binaryPath: settings.opencodeBinaryPath, model: settings.opencodeModel }
      : settings.localAgents?.[backend];
  return {
    binaryPath: typeof config?.binaryPath === "string" ? config.binaryPath.trim() : "",
    model: typeof config?.model === "string" ? config.model.trim() : ""
  };
}

export function updateLocalAgentConfig(
  settings: Record<string, any>, backend: LocalAgentBackend, update: Partial<LocalAgentConfig>
): void {
  const config = { ...localAgentConfig(settings, backend), ...update };
  if (backend === "codex-cli") {
    settings.codexBinaryPath = config.binaryPath;
    settings.codexModel = config.model;
  } else if (backend === "opencode-acp") {
    settings.opencodeBinaryPath = config.binaryPath;
    settings.opencodeModel = config.model;
  } else {
    settings.localAgents = { ...settings.localAgents, [backend]: config };
  }
}

export function localModelChoices(models: LocalModelOption[], selected: string): LocalModelOption[] {
  const choices = new Map<string, LocalModelOption>();
  for (const model of models) {
    if (model.id) choices.set(model.id, model);
  }
  if (selected && !choices.has(selected)) choices.set(selected, { id: selected, name: selected });
  return [...choices.values()];
}
