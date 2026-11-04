import type { FeatureSettings } from "./feature-integrator";

export function settingsFixture(overrides: Partial<FeatureSettings> = {}) {
  const settings: FeatureSettings & {
    aiUsageRecords: { id: string }[];
    defaultNodeWidth: number;
    customCss: string;
    templates: { name: string; text: string }[];
  } = {
    baseUrl: "https://api.example.com/v1", apiKey: "", model: "test-model", systemPrompt: "Test prompt",
    direction: "LR", gapX: 100, gapY: 44, gridSize: 20, defaultNodeTextAlign: "center",
    attachmentFolder: "Better Canvas/Generated Images",
    systemPromptProfiles: [], activeSystemPromptProfile: "",
    onboarding: { welcome: "unseen", emptyTip: "unseen", exampleCanvasPath: "", updatedAt: "" },
    mindMapShortcutChildTabEnabled: true, mindMapShortcutSiblingEnterEnabled: true,
    mindMapShortcutAltArrowNavigationEnabled: true, mindMapShortcutDirectionalCreationEnabled: true,
    providerProfiles: [], activeProviderId: "default", autoFileNodeEdgesEnabled: false,
    autoEdgesFrontmatterKey: "canvas-edges", canvasMetadataEnabled: false,
    mcpEndpoint: "", mcpApiKey: "", mcpTransport: "http", mcpStdioConfig: "{}",
    exportPixelRatio: 2, exportBackgroundColor: "", imageProtocol: "openai",
    imageBaseUrl: "https://api.example.com/v1", imageApiKey: "", imageModel: "test-image",
    imageSettingsMigrated: true, backend: "codex-cli", codexBinaryPath: "/tools/codex", codexModel: "",
    opencodeBinaryPath: "/tools/opencode", opencodeModel: "",
    localAgents: { "gemini-cli": { binaryPath: "/tools/gemini", model: "retained-gemini" } },
    flashcardOutputMode: "canvas", spacedRepetitionFolder: "Better Canvas/Flashcards", spacedRepetitionDeck: "better-canvas",
    modelCapabilityReports: {}, aiUsageRecords: [], defaultNodeWidth: 900, customCss: ".old-style {}",
    templates: [{ name: "Old template", text: "Keep for recovery" }],
    ...overrides
  };
  return settings;
}
