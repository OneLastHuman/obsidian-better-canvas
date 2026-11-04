import {
  App,
  ItemView,
  Modal,
  MarkdownPostProcessorContext,
  MarkdownRenderer,
  MarkdownRenderChild,
  Notice,
  Platform,
  Plugin,
  Menu,
  MenuItem,
  EventRef,
  SuggestModal,
  TFile,
  TFolder
} from "obsidian";
import { toPng, toSvg } from "html-to-image";
import { AIProtocol, AISettings, chatCompletion, chatCompletionStream, generateImage, ChatMessageContent } from "./ai";
import { modelCapabilityReportKey, probeModelCapabilities, type ModelCapabilityReport } from "./model-capabilities";
import { isLocalAgentBackend, localAgentDefinition, localAgentConfig, type TextBackend, type LocalAgentConfig } from "./local-agent-settings";
import { normalizeTemperatureForProtocol, parseProviderParamsJson } from "./provider-params";
import { canvasScaleFromLogZoom, isBelowZoomBreakpoint } from "./zoom-breakpoint";
import { createId, readCanvasData, makeTextNode, insertCanvasNode, removeCanvasNode, CanvasData, CanvasEdgeData, CanvasNodeData } from "./canvas";
import { connectedEdgeIds, selectedCanvasNodeIds } from "./edge-highlight";
import { CanvasReadonlyController, type CanvasReadonlyOptions } from "./canvas-readonly";
import { AdvancedCanvasEventBridge } from "./advanced-canvas-events";
import { mergeCanvasExportData, viewportExportAppearance } from "./canvas-export-data";
import { prepareViewportSvgExportClone, shouldIncludeViewportSvgNode } from "./canvas-viewport-export";
import { SKETCH_FONT_CSS } from "./sketch-font";
import { SOFT_NOTES_FONT_CSS } from "./soft-notes-font";
import {
  colorIncidentEdges,
  decorateCanvas,
  flipIncidentEdges,
  moveSelectionEdgesToTop,
  normalizeNodeShape,
  patchNode,
  reorderNode,
  resizeNodeToText,
  styleSelectedEdges,
  styleSelectedEdgeArrow,
  styleSelectedEdgePathfinding,
  selectAllCanvasEdges,
  toggleGroupCollapse
} from "./enhancements";
import { retrieveWebpage } from "./web";
import { readCanvasFrontmatter, replaceCanvasFrontmatter } from "./canvas-frontmatter";
import { parsePdfPageSelection } from "./pdf-range";
import { buildAutoFileNodeEdges } from "./canvas-auto-edges";
import { isMindMapShortcutEnabled } from "./mindmap-shortcuts";
import { cloneCanvasNodeInDirection, createNodeExpansionEdge, type CloneDirection } from "./canvas-clone";
import { flipCanvasNodePositions, swapCanvasNodePositions } from "./canvas-arrangement";
import { zoomCanvasToFit } from "./canvas-zoom";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape } from "./canvas-node-style";
import { applyDefaultNodePreferences, defaultNodeSize, DEFAULT_NODE_HEIGHT } from "./node-defaults";
import { isCanvasReadOnly } from "./canvas-command-guards";
import { mergeAutoResizeIntoCurrentHistory, resolveCanvasTheme } from "./canvas-theme";
import { decorateAutoResizeInsets } from "./node-rendered-layout";
import { isJsonObject, parseJsonObjectPrompt, promptValidator, resolvePromptSubmission } from "./prompt-input";
import { dedupeMaterializableCanvasLinks, materializableLinkKey } from "./canvas-link-materializer";
import { formatSpacedRepetitionDeck, normalizeSpacedRepetitionFolderPath, uniqueSpacedRepetitionPath } from "./spaced-repetition";
import {
  callRemoteTool, getRemotePrompt, listRemotePrompts, listRemoteResources, listRemoteTools, readRemoteResource, RemoteMcpResult
} from "./mcp";
import {
  callLocalMcpTool, closeAllLocalMcpSessions, getLocalMcpPrompt, listLocalMcpPrompts, listLocalMcpResources, listLocalMcpTools, readLocalMcpResource
} from "./mcp-stdio";
import {
  callSseMcpTool, getSseMcpPrompt, listSseMcpPrompts, listSseMcpResources, listSseMcpTools, readSseMcpResource
} from "./mcp-sse";
import {
  formatMcpPromptCatalog, formatMcpResourceCatalog, parseMcpPromptArguments, parseMcpToolConfirmation,
  type McpPrompt, type McpResource
} from "./mcp-catalog";
import { CanvasMetadataIndexer } from "./canvas-metadata";
import { PinnedPdfPageRenderer, pinnedPdfSubpath } from "./pdf-pages";
import { PdfAnnotationManager } from "./pdf-annotations";
import { extractPdfPages } from "./pdf-context";
import { CanvasPortalManager } from "./canvas-portals";
import { canEmbedExportMedia, estimateDataUrlByteLength, scaleSvgIntrinsicDimensions } from "./export-utils";
import { canvasDataForSelection, canvasDataToFullSvg } from "./full-canvas-export";
import { extractWikiLinks } from "./canvas-links";
import { discoverModels } from "./model-discovery";
import { HtmlPreviewManager, syncHtmlPreviews } from "./html-preview";
import { runLocalCodex } from "./codex-cli";
import BetterCanvasSettingsTab from "./settings";
import { normalizeCommandDisplayName } from "./command-names";
import { joinVaultPath } from "./vault-path";
import { AIPromptModal } from "./ai-prompt-modal";
import { resolveAIStatus } from "./onboarding-ai";
import { resetOnboardingState, type OnboardingState } from "./onboarding";
import { t } from "./i18n";
import { isCanvasViewRuntime, type CanvasRuntime, type CanvasNodeRuntime, type CanvasViewRuntime } from "./canvas-runtime";
import type { NamedPromptProfile } from "./prompt-profiles";
import { isCanvasData, isCanvasNodeData, type LayoutDirection } from "./canvas";

function parseUnknownJson(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const parsed = parseUnknownJson(raw);
  if (!isJsonObject(parsed)) throw new Error(t("Expected a JSON object.", "需要 JSON 对象。"));
  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

export interface FeaturePlugin extends Plugin {
  settings: FeatureSettings;
  settingsTab?: BetterCanvasSettingsTab;
  saveSettings(): Promise<void>;
  scheduleOnboardingCheck?(): void;
}

interface FeatureWorkspaceEvents {
  "canvas:node-menu": [Menu, CanvasNodeRuntime];
  "canvas:selection-menu": [Menu, CanvasRuntime];
  "advanced-canvas:node-created": [CanvasRuntime, CanvasNodeRuntime];
  "advanced-canvas:node-added": [CanvasRuntime, CanvasNodeRuntime];
  "advanced-canvas:node-resized": [CanvasRuntime, CanvasNodeRuntime];
  "advanced-canvas:data-loaded:before": [CanvasRuntime, CanvasData?];
  "advanced-canvas:node-changed": [CanvasRuntime];
  "advanced-canvas:data-loaded:after": [CanvasRuntime, CanvasData?];
  "advanced-canvas:node-text-content-changed": [CanvasRuntime];
  "advanced-canvas:node-rendered": [CanvasRuntime];
  "advanced-canvas:node-editing-state-changed": [CanvasRuntime, CanvasNodeRuntime, boolean];
  "advanced-canvas:readonly-changed": [CanvasRuntime, boolean];
  "advanced-canvas:dragging-state-changed": [CanvasRuntime, boolean];
  "advanced-canvas:canvas-view-unloaded:before": [CanvasViewRuntime];
  "better-canvas:theme-changed": [];
  "css-change": [];
}

declare module "obsidian" {
  interface Workspace {
    on<K extends keyof FeatureWorkspaceEvents>(name: K, callback: (...args: FeatureWorkspaceEvents[K]) => unknown, ctx?: unknown): EventRef;
  }
}

export interface ProviderProfile {
  id: string;
  protocol?: AIProtocol;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
  requestParamsJson?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface FeatureSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  direction: LayoutDirection;
  systemPromptProfiles: NamedPromptProfile[];
  activeSystemPromptProfile: string;
  onboarding: OnboardingState;
  gapX: number;
  gapY: number;
  defaultNodeTextAlign: "left" | "center" | "right";
  attachmentFolder: string;
  mindMapShortcutChildTabEnabled: boolean;
  mindMapShortcutSiblingEnterEnabled: boolean;
  mindMapShortcutAltArrowNavigationEnabled: boolean;
  mindMapShortcutDirectionalCreationEnabled: boolean;
  readOnlyDisableNodeMenusEnabled?: boolean;
  readOnlyLockPanZoomEnabled?: boolean;
  providerProfiles: ProviderProfile[];
  activeProviderId: string;
  autoFileNodeEdgesEnabled: boolean;
  autoEdgesFrontmatterKey: string;
  gridSize: number;
  mcpEndpoint: string;
  mcpApiKey: string;
  mcpTransport: "http" | "sse" | "stdio";
  mcpStdioConfig: string;
  canvasMetadataEnabled: boolean;
  exportPixelRatio: number;
  exportBackgroundColor: string;
  imageProtocol: "openai" | "gemini";
  imageBaseUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageSettingsMigrated: boolean;
  codexBinaryPath: string;
  codexModel: string;
  backend: TextBackend;
  opencodeBinaryPath: string;
  opencodeModel: string;
  localAgents: Record<string, LocalAgentConfig>;
  flashcardOutputMode: "canvas" | "spaced-repetition";
  spacedRepetitionFolder: string;
  spacedRepetitionDeck: string;
  modelCapabilityReports: Record<string, ModelCapabilityReport>;
}

const DEFAULT_PROFILES: ProviderProfile[] = [{
  id: "default",
  protocol: "openai",
  name: "Default / OpenAI compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  imageModel: "gpt-image-1",
  requestParamsJson: "{}",
  temperature: 0.4,
  maxOutputTokens: 0
}];

export const DEFAULT_FEATURE_SETTINGS: Omit<FeatureSettings, "baseUrl" | "apiKey" | "model" | "systemPrompt" | "direction" | "systemPromptProfiles" | "activeSystemPromptProfile" | "onboarding" | "gapX" | "gapY" | "defaultNodeTextAlign" | "attachmentFolder" | "mindMapShortcutChildTabEnabled" | "mindMapShortcutSiblingEnterEnabled" | "mindMapShortcutAltArrowNavigationEnabled" | "mindMapShortcutDirectionalCreationEnabled"> = {
  providerProfiles: [],
  activeProviderId: "default",
  autoFileNodeEdgesEnabled: true,
  autoEdgesFrontmatterKey: "canvas-edges",
  gridSize: 20,
  mcpEndpoint: "",
  mcpApiKey: "",
  mcpTransport: "http",
  mcpStdioConfig: '{"command":"","args":[],"env":{},"cwd":""}',
  canvasMetadataEnabled: true,
  exportPixelRatio: 2,
  exportBackgroundColor: "",
  imageProtocol: "openai",
  imageBaseUrl: "https://api.openai.com/v1",
  imageApiKey: "",
  imageModel: "gpt-image-1",
  imageSettingsMigrated: false,
  codexBinaryPath: "",
  codexModel: "",
  backend: "api",
  opencodeBinaryPath: "opencode",
  opencodeModel: "",
  localAgents: {},
  flashcardOutputMode: "canvas",
  spacedRepetitionFolder: "Better Canvas/Flashcards",
  spacedRepetitionDeck: "better-canvas",
  modelCapabilityReports: {}
};

class FeaturePromptModal extends Modal {
  constructor(
    app: App,
    private titleText: string,
    private placeholderText: string,
    private onSubmitValue: (value: string) => unknown,
    private initialValue = "",
    private allowEmptySubmission = false,
    private validateValue?: (value: string) => string | null
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.titleText });
    const input = this.contentEl.createEl("textarea", {
      cls: "bc-modal-prompt-textarea",
      attr: { rows: "5", placeholder: this.placeholderText }
    });
    input.value = this.initialValue;
    const error = this.contentEl.createDiv({ cls: "bc-prompt-error" });
    error.hide();
    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: t("Submit", "提交"), cls: "mod-cta" });
    submit.onclick = () => {
      const submission = resolvePromptSubmission(input.value.trim(), {
        allowEmpty: this.allowEmptySubmission,
        validate: this.validateValue
      });
      if (submission.kind === "cancelled") {
        this.close();
        return;
      }
      if (submission.kind === "invalid") {
        // Keep the modal and the typed text so the value can be corrected in place.
        error.setText(submission.message);
        error.show();
        input.focus();
        return;
      }
      this.close();
      void this.onSubmitValue(submission.value);
    };
    input.addEventListener("input", () => {
      error.setText("");
      error.hide();
    });
    input.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submit.click();
      }
    });
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class AIModelPickerModal extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly models: string[],
    private readonly currentModel: string,
    private readonly onChoose: (model: string) => void
  ) {
    super(app);
    this.setPlaceholder(t("Search available models; type a model name if the provider lists none", "搜索可用模型；若供应商未列出模型，可手动输入模型名"));
  }

  getSuggestions(query: string): string[] {
    const needle = query.trim().toLocaleLowerCase();
    const values = [...new Set([this.currentModel, ...this.models].filter(Boolean))];
    return values.filter(model => !needle || model.toLocaleLowerCase().includes(needle)).slice(0, 250);
  }

  renderSuggestion(model: string, element: HTMLElement): void {
    element.createDiv({ text: model });
    if (model === this.currentModel) element.createEl("small", { text: t("Current model", "当前模型") });
  }

  onChooseSuggestion(model: string): void {
    this.onChoose(model);
  }
}

interface CanvasLinkExplorerEntry {
  title: string;
  detail: string;
  target: string;
  sourcePath: string;
  external?: boolean;
  sourceNodeId?: string;
}

class CanvasLinkExplorerModal extends Modal {
  constructor(
    app: App,
    private readonly sourcePath: string,
    private readonly outgoing: CanvasLinkExplorerEntry[],
    private readonly incoming: CanvasLinkExplorerEntry[]
  ) {
    super(app);
    this.modalEl.addClass("bc-link-explorer-modal");
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: t("Canvas links and backlinks", "Canvas 链接与反向链接") });
    this.contentEl.createEl("p", {
      text: t("Resolves internal links, file nodes and web nodes from the current Canvas nodes, and scans Markdown / Canvas files for references to this Canvas.", "从当前画布节点解析内部链接、文件节点和网页节点，并扫描 Markdown / Canvas 文件中指向当前画布的引用。")
    });
    this.renderSection(t("Outgoing links and file links", "当前画布的外链与文件链接"), this.outgoing, t("No recognizable links in this Canvas.", "当前画布中没有可识别的链接。"));
    this.renderSection(t("Backlinks", "反向链接"), this.incoming, t("No links to this Canvas were found in the vault.", "Vault 中未发现指向此 Canvas 的链接。"));
    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    footer.createEl("button", { text: t("Close", "关闭") }).addEventListener("click", () => this.close());
  }

  private renderSection(title: string, entries: CanvasLinkExplorerEntry[], emptyMessage: string): void {
    const section = this.contentEl.createDiv({ cls: "bc-link-explorer-section" });
    section.createEl("h3", { text: title });
    if (entries.length === 0) {
      section.createEl("p", { text: emptyMessage });
      return;
    }
    const list = section.createDiv({ cls: "bc-link-explorer-list" });
    for (const entry of entries) {
      const button = list.createEl("button", { cls: "bc-link-explorer-entry" });
      button.createSpan({ text: entry.title });
      button.createEl("small", { text: entry.detail });
      button.addEventListener("click", () => {
        this.close();
        if (entry.external) {
          window.open(entry.target, "_blank", "noopener,noreferrer");
        } else {
          void this.app.workspace.openLinkText(entry.target, entry.sourcePath, false);
        }
      });
    }
  }
}

export interface AISelectionTarget {
  canvas: CanvasRuntime;
  nodeIds: readonly string[];
}

interface AutoResizeObservation {
  view: CanvasViewRuntime;
  canvas: CanvasRuntime;
  container: HTMLElement;
  observer: MutationObserver;
  timer: number | null;
  revision: number;
  htmlSignature?: string;
  snapshots: Map<string, { signature: string; preview: Element | null }>;
}

export default class BetterCanvasFeatures {
  private focusedCanvases = new Map<CanvasRuntime, string>();
  private boundContainers = new WeakSet<HTMLElement>();
  private boundRouteContainers = new WeakSet<HTMLElement>();
  private resizeObservers = new Map<HTMLElement, AutoResizeObservation>();
  private expectedAutoResizes = new Map<CanvasRuntime, Map<string, { width: number; height: number }>>();
  private expectedImportedResizes = new Map<CanvasRuntime, Map<string, { width: number; height: number }>>();
  private activeAutoResizes = new Map<CanvasRuntime, Set<string>>();
  private draggingCanvases = new Set<CanvasRuntime>();
  private fontDocuments = new Set<Document>();
  private stopped = false;
  private activeGenerations = new Map<CanvasRuntime, { controller: AbortController; nodeId: string }>();
  private metadataIndexer: CanvasMetadataIndexer | null = null;
  private pdfPageRenderer: PinnedPdfPageRenderer | null = null;
  private pdfAnnotations: PdfAnnotationManager | null = null;
  private portalManager: CanvasPortalManager | null = null;
  private advancedCanvasEventBridge: AdvancedCanvasEventBridge | null = null;
  private readonlyController = new CanvasReadonlyController();
  // Resolved CSS --variable-breakpoint per node element. getComputedStyle
  // forces a style flush, so a wheel frame must not repeat it for every node.
  private cssBreakpointCache = new WeakMap<HTMLElement, number>();
  /** Nodes whose inline border colour this plugin wrote, so clearing only undoes its own write. */
  private coloredNodeHosts = new WeakSet<HTMLElement>();
  private p: FeaturePlugin;

  constructor(plugin: FeaturePlugin) {
    this.p = plugin;
    this.p.register(() => this.readonlyController.stop());
  }

  init(): void {
    this.migrateSettings();
    new HtmlPreviewManager(this.p).start();
    this.metadataIndexer = new CanvasMetadataIndexer(this.p.app, this.p, () => Boolean(this.settings().canvasMetadataEnabled));
    this.metadataIndexer.start();
    this.pdfPageRenderer = new PinnedPdfPageRenderer(this.p);
    this.pdfPageRenderer.start();
    this.pdfAnnotations = new PdfAnnotationManager(this.p);
    this.pdfAnnotations.start();
    this.portalManager = new CanvasPortalManager(this.p);
    this.portalManager.start();
    this.p.register(() => {
      this.cleanup();
      closeAllLocalMcpSessions();
    });
    this.p.registerEvent(this.p.app.workspace.on("advanced-canvas:node-created", (canvas: CanvasRuntime, node: CanvasNodeRuntime) => {
      this.applyDefaultTextAlignmentToNewNode(canvas, node);
    }));
    this.p.registerEvent(this.p.app.workspace.on("advanced-canvas:node-resized", (canvas: CanvasRuntime, node: CanvasNodeRuntime) => {
      this.handleNodeResized(canvas, node);
    }));
    this.registerAutoResizeEvents();
    this.advancedCanvasEventBridge = new AdvancedCanvasEventBridge(this.p.app, this.p);
    this.advancedCanvasEventBridge.start();
    this.registerCommands();
    this.registerCanvasMenus();
    this.registerMarkdownNodeEmbeds();
    this.p.settingsTab = new BetterCanvasSettingsTab(this.p.app, this.p, this);
    this.p.addSettingTab(this.p.settingsTab);
    this.p.registerEvent(this.p.app.workspace.on("layout-change", () => this.refresh()));
    this.p.registerEvent(this.p.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.p.registerEvent(this.p.app.metadataCache.on("changed", () => this.refreshAutoEdges()));
    this.p.app.workspace.onLayoutReady(() => this.refresh());
  }

  /**
   * Public bridges used by the base plugin commands and node context menus.
   * All AI entry points route through this integration layer so provider
   * profiles, streaming, cancellation, multimodal context and node metadata
   * behave consistently.
   */
  askSelectedNode(target?: string | AISelectionTarget): void {
    const selection = this.aiSelection(target);
    if (!selection) return;
    this.openAIPrompt(selection);
  }

  private openAIPrompt(selection: AISelectionTarget & { node: CanvasNodeData }, modelOverride?: string, draft = ""): void {
    const { node, canvas, nodeIds } = selection;
    const backend = this.settings().backend;
    const modelLabel = isLocalAgentBackend(backend)
      ? localAgentDefinition(backend)!.name + " · " + (localAgentConfig(this.settings(), backend).model || t("Local config", "本地配置"))
      : modelOverride || this.apiNodeModel(node);
    const sourceLabel = nodeIds.length > 1 ? t(`Selected ${nodeIds.length} nodes`, `已选 ${nodeIds.length} 个节点`) :
      String(node.text || node.file || node.url || t("Untitled card", "未命名卡片"))
        .trim().split(/\r?\n/).find(line => line.trim())?.replace(/^#{1,6}\s+/, "").slice(0, 160) || t("Untitled card", "未命名卡片");
    const modal = new AIPromptModal(this.p.app, {
      sourceLabel,
      modelLabel,
      aiStatus: resolveAIStatus(this.aiSettings(node, modelOverride)),
      onOpenSettings: () => this.openAISettingsAndResume(modal, selection, modelOverride),
      onSubmit: value => this.runAI(nodeIds, value, modelOverride, undefined, undefined, canvas)
    });
    modal.setDraft(draft);
    modal.open();
  }

  private openAISettingsAndResume(
    modal: AIPromptModal,
    selection: AISelectionTarget & { node: CanvasNodeData },
    modelOverride?: string
  ): void {
    const draft = modal.prepareForSettings();
    const settingsTab = this.p.settingsTab;
    if (!settingsTab?.openAISection) {
      new Notice(t("Could not open Better Canvas settings.", "无法打开 Better Canvas 设置。"));
      return;
    }
    settingsTab.openAISection({
      onReturn: () => this.openAIPrompt(selection, modelOverride, draft)
    });
  }

  generateFlashcardsFromSelection(target?: string | AISelectionTarget): void {
    void this.generateFlashcardNodes(target);
  }

  generateImageFromSelection(target?: string | AISelectionTarget): void {
    void this.generateImageForNode(target);
  }

  chooseModelForNode(nodeId: string): void {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。"));
      return;
    }
    if (!canvas.nodes?.get?.(nodeId)) {
      new Notice(t("The selected node no longer exists.", "所选节点已不存在。"));
      return;
    }
    this.selectNode(canvas, nodeId);
    this.setNodeModel();
  }

  regenerateNode(nodeId: string): void {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。"));
      return;
    }
    if (!canvas.nodes?.get?.(nodeId)) {
      new Notice(t("The selected node no longer exists.", "所选节点已不存在。"));
      return;
    }
    this.selectNode(canvas, nodeId);
    void this.regenerate();
  }

  settings(): FeatureSettings {
    return this.p.settings;
  }

  private applyDefaultTextAlignmentToNewNode(canvas: CanvasRuntime, node: CanvasNodeRuntime): void {
    if (!canvas || isCanvasReadOnly(canvas)) return;
    const nodeId = typeof node?.id === "string" ? node.id : node?.getData?.()?.id;
    if (typeof nodeId !== "string") return;
    const currentNode = readCanvasData(canvas).nodes.find(item => item.id === nodeId);
    if (!currentNode) return;

    const updated = applyDefaultNodePreferences(currentNode, this.settings().defaultNodeTextAlign);
    if (updated === currentNode) return;
    if (patchNode(canvas, nodeId, {
      ...(typeof updated.bcTextAlign === "string" ? { bcTextAlign: updated.bcTextAlign } : {}),
      ...(updated.styleAttributes !== undefined ? { styleAttributes: updated.styleAttributes } : {}),
      ...(typeof updated.bcAutoResize === "boolean" ? { bcAutoResize: updated.bcAutoResize } : {})
    })) {
      this.decorate(canvas);
    }
  }

  private handleNodeResized(canvas: CanvasRuntime, node: CanvasNodeRuntime): void {
    if (!canvas || this.isResizeReadOnly(canvas)) return;
    const nodeId = typeof node?.id === "string" ? node.id : node?.getData?.()?.id;
    if (typeof nodeId !== "string") return;
    if (this.activeAutoResizes.get(canvas)?.has(nodeId)) return;
    const currentNode = readCanvasData(canvas).nodes.find(item => item.id === nodeId);
    const expected = this.expectedAutoResizes.get(canvas)?.get(nodeId);
    const imported = this.expectedImportedResizes.get(canvas)?.get(nodeId);
    this.expectedAutoResizes.get(canvas)?.delete(nodeId);
    this.expectedImportedResizes.get(canvas)?.delete(nodeId);
    if (currentNode && [expected, imported].some(size => size && size.width === currentNode.width && size.height === currentNode.height)) return;
    if (!currentNode || (currentNode).bcAutoResize !== true) return;
    patchNode(canvas, nodeId, { bcAutoResize: false });
    if (typeof HTMLElement !== "undefined") this.decorate(canvas);
  }

  private isResizeReadOnly(canvas: CanvasRuntime): boolean {
    return Boolean(canvas?.readonly || canvas?.readOnly || isCanvasReadOnly(canvas));
  }

  private resizeTextNode(canvas: CanvasRuntime, nodeId: string, saveHistory = true): boolean {
    if (this.isResizeReadOnly(canvas)) return false;
    const before = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
    if (!before) return false;
    const width = before.width;
    const height = before.height;
    const active = this.activeAutoResizes.get(canvas) ?? new Set<string>();
    this.activeAutoResizes.set(canvas, active);
    active.add(nodeId);
    try {
      const resized = resizeNodeToText(canvas, nodeId, undefined, saveHistory);
      const after = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
      // A successful no-op also refreshes the preview; it must not mask a later
      // user resize. The bridge delivers actual geometry changes on a frame.
      if (resized && after && (after.width !== width || after.height !== height)) {
        const expected = this.expectedAutoResizes.get(canvas) ?? new Map<string, { width: number; height: number }>();
        expected.set(nodeId, { width: after.width, height: after.height });
        this.expectedAutoResizes.set(canvas, expected);
      }
      if (resized && !saveHistory) mergeAutoResizeIntoCurrentHistory(canvas, nodeId);
      return resized;
    } finally {
      active.delete(nodeId);
      if (!active.size) this.activeAutoResizes.delete(canvas);
    }
  }

  async probeProviderCapabilities(profileId: string): Promise<ModelCapabilityReport> {
    const s = this.settings();
    const selected = (Array.isArray(s.providerProfiles) ? s.providerProfiles : [])
      .find((profile: ProviderProfile) => profile.id === profileId);
    if (!selected) throw new Error(t("Could not find the AI provider profile to probe.", "找不到要探测的 AI 服务商配置。"));

    const profile = selected.id === "default"
      ? {
          ...selected,
          baseUrl: s.baseUrl || selected.baseUrl,
          apiKey: s.apiKey || selected.apiKey,
          model: s.model || selected.model,
          imageModel: s.imageModel || selected.imageModel
        }
      : selected;
    const aiSettings: AISettings = {
      baseUrl: String(profile.baseUrl || ""),
      apiKey: String(profile.apiKey || ""),
      model: String(profile.model || ""),
      imageModel: String(profile.imageModel || ""),
      systemPrompt: "You are running a user-requested capability smoke test.",
      protocol: profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai",
      backend: "api",
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens ? profile.maxOutputTokens : undefined,
      providerParams: parseProviderParamsJson(String(profile.requestParamsJson || "{}"))
    };
    const report = await probeModelCapabilities(
      { id: profile.id, name: String(profile.name || profile.id) },
      aiSettings,
      chatCompletion
    );
    const reports = s.modelCapabilityReports && typeof s.modelCapabilityReports === "object" && !Array.isArray(s.modelCapabilityReports)
      ? s.modelCapabilityReports
      : {};
    reports[modelCapabilityReportKey(report.profileId, report.protocol, report.model)] = report;
    const keys = Object.keys(reports);
    while (keys.length > 50) {
      delete reports[keys.shift()!];
    }
    s.modelCapabilityReports = reports;
    await this.save();
    return report;
  }

  async save(): Promise<void> {
    await this.p.saveSettings();
  }

  applySettings(): void {
    this.refresh();
    if (this.settings().canvasMetadataEnabled) this.refreshMetadataCache();
    this.p.scheduleOnboardingCheck?.();
  }

  resetOnboardingSettings(): OnboardingState {
    return resetOnboardingState();
  }

  refreshMetadataCache(): void {
    this.metadataIndexer?.refreshAll();
  }

  private cleanup(): void {
    this.stopped = true;
    for (const state of this.resizeObservers.values()) this.stopAutoResize(state);
    this.expectedAutoResizes.clear();
    this.expectedImportedResizes.clear();
    this.activeAutoResizes.clear();
    this.draggingCanvases.clear();
    this.advancedCanvasEventBridge?.stop();
    this.advancedCanvasEventBridge = null;
    for (const active of this.activeGenerations.values()) active.controller.abort();
    this.activeGenerations.clear();
  }

  private migrateSettings(): void {
    const s = this.settings();
    if (!Array.isArray(s.providerProfiles) || !s.providerProfiles.length) {
      s.providerProfiles = [{
        id: "default",
        protocol: "openai",
        name: "Default / OpenAI compatible",
        baseUrl: s.baseUrl || "https://api.openai.com/v1",
        apiKey: s.apiKey || "",
        model: s.model || "gpt-4o-mini",
        imageModel: s.imageModel || "gpt-image-1",
        requestParamsJson: "{}",
        temperature: 0.4,
        maxOutputTokens: 0
      }];
    }
    s.providerProfiles = s.providerProfiles.filter((p: ProviderProfile) => p && typeof p.id === "string" && typeof p.baseUrl === "string");
    if (!s.providerProfiles.length) s.providerProfiles = DEFAULT_PROFILES.map(profile => ({ ...profile }));
    for (const profile of s.providerProfiles) {
      if (typeof profile.requestParamsJson !== "string") profile.requestParamsJson = "{}";
      profile.temperature = normalizeTemperatureForProtocol(profile.temperature, profile.protocol ?? "openai");
      if (typeof profile.maxOutputTokens !== "number" || !Number.isInteger(profile.maxOutputTokens) || profile.maxOutputTokens < 0 || profile.maxOutputTokens > 200_000) profile.maxOutputTokens = 0;
    }
    if (!s.providerProfiles.some((p: ProviderProfile) => p.id === s.activeProviderId)) {
      s.activeProviderId = s.providerProfiles[0].id;
    }
    if (typeof s.autoFileNodeEdgesEnabled !== "boolean") s.autoFileNodeEdgesEnabled = true;
    if (typeof s.autoEdgesFrontmatterKey !== "string") s.autoEdgesFrontmatterKey = "canvas-edges";
    if (!Number.isFinite(s.gridSize) || s.gridSize < 1 || s.gridSize > 500) s.gridSize = 20;
    if (typeof s.mcpEndpoint !== "string") s.mcpEndpoint = "";
    if (typeof s.mcpApiKey !== "string") s.mcpApiKey = "";
    if (s.mcpTransport !== "stdio" && s.mcpTransport !== "sse" && s.mcpTransport !== "http") s.mcpTransport = "http";
    if (typeof s.mcpStdioConfig !== "string") s.mcpStdioConfig = '{"command":"","args":[],"env":{},"cwd":""}';
    if (typeof s.canvasMetadataEnabled !== "boolean") s.canvasMetadataEnabled = true;
    if (!Number.isFinite(s.exportPixelRatio) || s.exportPixelRatio < 1 || s.exportPixelRatio > 4) s.exportPixelRatio = 2;
    if (typeof s.exportBackgroundColor !== "string") s.exportBackgroundColor = "";
    if (typeof s.codexBinaryPath !== "string") s.codexBinaryPath = "";
    if (typeof s.codexModel !== "string") s.codexModel = "";
    if (!s.imageSettingsMigrated) {
      const legacyProvider = s.providerProfiles.find((profile: ProviderProfile) => profile.id === s.activeProviderId)
        ?? s.providerProfiles[0];
      const legacyProtocol = legacyProvider?.protocol ?? "openai";
      s.imageProtocol = legacyProtocol === "gemini" ? "gemini" : "openai";
      const defaults = {
        openai: "https://api.openai.com/v1",
        gemini: "https://generativelanguage.googleapis.com/v1beta"
      };
      s.imageBaseUrl = legacyProtocol === "anthropic"
        ? defaults.openai
        : String(legacyProvider?.baseUrl || s.baseUrl || defaults[legacyProtocol === "gemini" ? "gemini" : "openai"]);
      s.imageApiKey = String(legacyProvider?.apiKey || s.apiKey || "");
      s.imageModel = String(legacyProvider?.imageModel || s.imageModel || "gpt-image-1");
      s.imageSettingsMigrated = true;
    }
    if (s.imageProtocol !== "gemini" && s.imageProtocol !== "openai") s.imageProtocol = "openai";
    if (typeof s.imageBaseUrl !== "string" || !s.imageBaseUrl.trim()) {
      s.imageBaseUrl = s.imageProtocol === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.openai.com/v1";
    }
    if (typeof s.imageApiKey !== "string") s.imageApiKey = "";
    if (typeof s.imageModel !== "string" || !s.imageModel.trim()) s.imageModel = "gpt-image-1";
    if (typeof s.imageSettingsMigrated !== "boolean") s.imageSettingsMigrated = true;
    if (!isLocalAgentBackend(s.backend) && s.backend !== "api") s.backend = "api";
    if (!s.localAgents || typeof s.localAgents !== "object" || Array.isArray(s.localAgents)) s.localAgents = {};
    if (typeof s.opencodeBinaryPath !== "string") s.opencodeBinaryPath = "opencode";
    if (typeof s.opencodeModel !== "string") s.opencodeModel = "";
    if (!s.modelCapabilityReports || typeof s.modelCapabilityReports !== "object" || Array.isArray(s.modelCapabilityReports)) s.modelCapabilityReports = {};
    void this.save();
  }

  private currentProvider(node?: CanvasNodeData): ProviderProfile {
    const s = this.settings();
    const preferredId = typeof (node)?.bcAIProvider === "string"
      ? String((node).bcAIProvider)
      : s.activeProviderId;
    const profile = s.providerProfiles.find((item: ProviderProfile) => item.id === preferredId)
      ?? s.providerProfiles.find((item: ProviderProfile) => item.id === s.activeProviderId)
      ?? s.providerProfiles[0]
      ?? DEFAULT_PROFILES[0];

    // The original settings panel remains backward-compatible with the default profile.
    if (profile.id === "default") {
      return {
        ...profile,
        baseUrl: s.baseUrl || profile.baseUrl,
        apiKey: s.apiKey || profile.apiKey,
        model: s.model || profile.model,
        imageModel: s.imageModel || profile.imageModel,
        protocol: profile.protocol || "openai"
      };
    }
    return profile;
  }

  private aiSettings(node?: CanvasNodeData, modelOverride?: string): AISettings {
    const s = this.settings();
    const profile = this.currentProvider(node);
    return {
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: isLocalAgentBackend(s.backend)
        ? localAgentConfig(s, s.backend).model
        : modelOverride || this.apiNodeModel(node),
      imageModel: profile.imageModel,
      protocol: profile.protocol || "openai",
      systemPrompt: s.systemPrompt || "Answer accurately and preserve uncertainty.",
      backend: isLocalAgentBackend(s.backend) ? s.backend : "api",
      localAgents: s.localAgents,
      opencodeBinaryPath: String(s.opencodeBinaryPath || "opencode"),
      opencodeModel: String(s.opencodeModel || ""),
      codexBinaryPath: String(s.codexBinaryPath || ""),
      codexModel: String(s.codexModel || ""),
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens ? profile.maxOutputTokens : undefined,
      providerParams: parseProviderParamsJson(String(profile.requestParamsJson || "{}"))
    };
  }

  private apiNodeModel(node?: CanvasNodeData): string {
    const override = !isLocalAgentBackend(node?.bcAIProvider) && typeof node?.bcAIModel === "string"
      ? node.bcAIModel.trim() : "";
    return override || this.currentProvider(node).model;
  }

  private activeCanvasView(): CanvasViewRuntime | null {
    const view = this.p.app.workspace.getActiveViewOfType(ItemView);
    return isCanvasViewRuntime(view) ? view : null;
  }

  private canvas(): CanvasRuntime | null {
    return this.activeCanvasView()?.canvas ?? null;
  }

  private aiSelection(target?: string | AISelectionTarget): (AISelectionTarget & {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
  }) | null {
    const canvas = typeof target === "object" ? target.canvas : this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。"));
      return null;
    }
    if (isCanvasReadOnly(canvas)) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode first.", "当前 Canvas 处于只读模式。请先解除只读模式。"));
      return null;
    }
    const data = readCanvasData(canvas);
    const nodeIds = [...new Set(typeof target === "string" ? [target] :
      target?.nodeIds ?? selectedCanvasNodeIds(canvas, data.nodes.map(node => node.id)))];
    if (!nodeIds.length) {
      new Notice(t("Select one or more nodes on the Canvas.", "请在画布中选择一个或多个节点。"));
      return null;
    }
    const records = new Map(data.nodes.map(node => [node.id, node]));
    if (nodeIds.some(id => !records.has(id))) {
      new Notice(t("Some selected nodes no longer exist. Select again.", "部分所选节点已不存在，请重新选择。"));
      return null;
    }
    const nodes = nodeIds.map(id => records.get(id)!);
    return { canvas, nodeIds, nodes, node: nodes[0] };
  }

  private aiOutputPosition(nodes: readonly CanvasNodeData[]): { x: number; y: number } {
    return {
      x: Math.max(...nodes.map(node => node.x + node.width)) + 100,
      y: Math.min(...nodes.map(node => node.y))
    };
  }

  private selected(canvas = this.canvas()): { canvas: CanvasRuntime; node: CanvasNodeData } | null {
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。"));
      return null;
    }
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Run “Toggle Canvas read-only mode” to unlock it.", "当前 Canvas 处于只读模式。请先运行“切换 Canvas 只读模式”解除锁定。"));
      return null;
    }
    const selection = canvas.selection;
    if (!selection || selection.size !== 1) {
      new Notice(t("Select exactly one node on the Canvas.", "请在画布中只选择一个节点。"));
      return null;
    }
    const internal = selection.values().next().value;
    if (!internal?.id || !canvas.nodes?.has?.(internal.id)) {
      new Notice(t("The current selection is not a node.", "当前选中对象不是节点。"));
      return null;
    }
    const node = readCanvasData(canvas).nodes.find((item: CanvasNodeData) => item.id === internal.id);
    if (!node) {
      new Notice(t("Could not read the selected node data.", "无法读取所选节点数据。"));
      return null;
    }
    return { canvas, node };
  }

  private selectNode(canvas: CanvasRuntime | null, id: string): void {
    if (!canvas) return;
    const node = canvas?.nodes?.get?.(id);
    if (!node) return;
    canvas.selectOnly?.(node);
    canvas.zoomToSelection?.();
    this.applySelectionEdgeHighlight(canvas);
  }

  private input(
    title: string,
    placeholder: string,
    cb: (value: string) => unknown,
    initial = "",
    allowEmptySubmission = false,
    validate?: (value: string) => string | null
  ): void {
    new FeaturePromptModal(this.p.app, title, placeholder, cb, initial, allowEmptySubmission, validate).open();
  }

  private registerCommands(): void {
    const add = (id: string, name: string, callback: () => void) =>
      this.p.addCommand({ id, name: normalizeCommandDisplayName(name), callback });

    add("bc-set-node-color", t("Set node color", "设置节点颜色"), () => this.setNodeColor());
    add("bc-set-node-shape", t("Set node shape", "设置节点形状"), () => this.setNodeShape());
    add("bc-set-node-border", t("Set node border style", "设置节点边框样式"), () => this.setNodeBorder());
    add("bc-set-node-text-align", t("Set text alignment of selected nodes", "设置所选节点文字对齐"), () => this.setNodeTextAlign());
    add("bc-set-node-class", t("Set custom style class for node", "设置节点自定义样式类"), () => this.setNodeCustomClass());
    add("bc-edit-style-attributes", t("Edit styleAttributes JSON of selected node or connection", "编辑所选节点或连线的 styleAttributes JSON"), () => this.editStyleAttributes());
    add("bc-set-edge-arrow", t("Set arrow style of selected connections", "设置所选连线箭头样式"), () => this.edgeArrowStyle());
    add("bc-resize-node", t("Auto-resize node to fit text", "根据文字自动调整节点尺寸"), () => this.resizeNode());
    add("bc-toggle-auto-resize", t("Toggle auto-resize for selected node", "切换所选节点自动调整尺寸"), () => this.toggleAutoResize());
    add("bc-set-zoom-breakpoint", t("Set zoom breakpoint for selected node", "设置所选节点缩放断点"), () => this.setZoomBreakpoint());
    add("bc-flip-edges", t("Flip connections attached to node", "翻转节点关联的连线"), () => this.flipEdges());
    add("bc-color-edges", t("Set color of connections attached to node", "设置节点关联连线颜色"), () => this.colorEdges());
    add("bc-select-edges", t("Select connections attached to node", "选择节点关联的连线"), () => this.selectEdges("all"));
    add("bc-select-all-canvas-edges", t("Select all connections in Canvas", "选择画布中的全部连线"), () => this.selectAllCanvasEdges());
    add("bc-zoom-to-fit-canvas", t("Zoom to fit entire Canvas", "缩放以适应整个 Canvas"), () => this.zoomToFitCanvas());
    add("bc-select-incoming-edges", t("Select incoming connections", "选择指向节点的连线"), () => this.selectEdges("incoming"));
    add("bc-select-outgoing-edges", t("Select outgoing connections", "选择从节点发出的连线"), () => this.selectEdges("outgoing"));
    add("bc-style-selected-edges", t("Set style of selected connections", "设置当前选中连线样式"), () => this.edgeStyle());
    add("bc-set-edge-pathfinding", t("Set pathfinding algorithm of selected connections", "设置选中连线路径算法"), () => this.edgePathfinding());
    add("bc-edit-canvas-frontmatter", t("Edit current Canvas frontmatter properties", "编辑当前 Canvas frontmatter 属性"), () => this.editCanvasFrontmatter());
    add("bc-edit-canvas-frontmatter-json", t("Bulk edit current Canvas frontmatter (JSON)", "批量编辑当前 Canvas frontmatter（JSON）"), () => this.editCanvasFrontmatterJson());
    add("bc-front-node", t("Bring node to front", "将节点置于最前"), () => this.reorder(true));
    add("bc-align-selection-grid", t("Align selected nodes to grid", "将所选节点对齐到网格"), () => this.alignSelectionToGrid());
    add("bc-flip-selection-horizontal", t("Flip selected nodes horizontally", "水平翻转所选节点布局"), () => this.flipSelectionPositions("horizontal"));
    add("bc-flip-selection-vertical", t("Flip selected nodes vertically", "垂直翻转所选节点布局"), () => this.flipSelectionPositions("vertical"));
    add("bc-swap-selected-node-positions", t("Swap positions of two selected nodes", "交换两个所选节点的位置"), () => this.swapSelectedNodePositions());
    add("bc-toggle-readonly", t("Toggle Canvas read-only mode", "切换 Canvas 只读模式"), () => this.toggleReadonly());
    add("bc-back-node", t("Send node to back", "将节点置于最后"), () => this.reorder(false));
    add("bc-focus", t("Toggle focus mode", "切换专注模式"), () => this.focus());
    add("bc-collapse-group", t("Collapse/expand selected group", "折叠/展开所选分组"), () => this.collapseGroup());
    add("bc-create-standalone-group", t("Create standalone group", "创建独立分组"), () => this.createStandaloneGroup());
    add("bc-encapsulate", t("Move selection to a new Canvas", "将选区移动到新 Canvas"), () => void this.encapsulate());
    add("bc-clone-node-direction", t("Clone selected node and extend in a direction", "克隆所选节点并向指定方向扩展"), () => this.cloneNodeInDirection());
    add("bc-copy-node-link", t("Copy node Wikilink", "复制节点 Wikilink"), () => void this.copyNodeLink());
    add("bc-open-link-explorer", t("View current Canvas links and backlinks", "查看当前 Canvas 链接与反向链接"), () => void this.openCanvasLinkExplorer());
    add("bc-materialize-canvas-links", t("Add current Canvas links and backlinks as nodes", "将当前 Canvas 链接与反向链接添加为节点"), () => void this.openCanvasLinkExplorer(true));
    add("bc-export-json", t("Export Canvas JSON", "导出 Canvas JSON"), () => void this.export("canvas"));
    add("bc-export-png", t("Export Canvas PNG", "导出 Canvas PNG"), () => void this.export("png"));
    add("bc-export-svg", t("Export Canvas SVG", "导出 Canvas SVG"), () => void this.export("svg"));
    add("bc-export-full-png", t("Export full-content Canvas PNG (all node bounds)", "导出 Canvas 全内容 PNG（按所有节点边界）"), () => void this.exportFullContent("png"));
    add("bc-export-full-svg", t("Export full-content Canvas SVG (all node bounds)", "导出 Canvas 全内容 SVG（按所有节点边界）"), () => void this.exportFullContent("svg"));
    add("bc-export-selection-png", t("Export selection PNG only", "仅导出选区 PNG"), () => void this.exportFullContent("png", true));
    add("bc-export-selection-svg", t("Export selection SVG only", "仅导出选区 SVG"), () => void this.exportFullContent("svg", true));
    add("bc-ingest-web", t("Import web page text", "导入网页正文"), () => this.input(t("Import web page text", "导入网页正文"), t("Full URL", "完整 URL"), value => void this.ingestWebpage(value)));
    add("bc-gemini-youtube-video", t("Analyze a YouTube video with Gemini", "用 Gemini 直接分析 YouTube 视频"), () => this.askGeminiAboutYoutube());
    add("bc-set-node-provider", t("Set AI provider for node", "为节点指定 AI 供应商"), () => this.setNodeProvider());
    add("bc-set-node-model", t("Set AI model for node (auto-discover)", "为节点指定 AI 模型（自动发现）"), () => this.setNodeModel());
    add("bc-run-prompt-folder", t("Run AI prompt on a folder", "对文件夹批量运行 AI Prompt"), () => this.runPromptFolder());
    add("bc-ask-custom-model", t("Ask AI with a specific model", "指定模型并向 AI 提问"), () => this.askWithModel());
    add("bc-ask-local-codex", t("Analyze selected nodes with local Codex CLI", "使用本地 Codex CLI 分析所选节点"), () => this.askLocalCodex());
    add("bc-test-provider", t("Test current AI provider connection", "测试当前 AI 供应商连接"), () => void this.testProvider());
    add("bc-related-questions", t("Generate follow-up research questions", "生成后续研究问题节点"), () => void this.generateRelatedQuestions());
    add("bc-generate-title", t("Generate node title or group name", "生成节点标题或分组名称"), () => void this.generateTitleOrGroupName());
    add("bc-expand-idea-mindmap", t("Expand an idea into a mind map with AI", "用 AI 将想法扩展为思维导图"), () => this.expandIdeaIntoMindMap());
    add("bc-generate-flashcard-nodes", t("Generate standalone flashcard nodes", "生成独立复习闪卡节点"), () => {
      void this.generateFlashcardNodes().catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      });
    });
    add("bc-regenerate", t("Regenerate selected AI node", "重新生成所选 AI 节点"), () => void this.regenerate());
    add("bc-stop-ai", t("Stop current AI generation", "停止当前 AI 生成"), () => this.stopAI());
    add("bc-mcp-tool", t("Call a remote MCP tool", "调用远程 MCP 工具"), () => void this.runMcpTool());
    add("bc-mcp-list-resources", t("List MCP resources and add to Canvas", "列出 MCP 资源并添加到画布"), () => void this.listMcpResources());
    add("bc-mcp-read-resource", t("Read an MCP resource and add to Canvas", "读取 MCP 资源并添加到画布"), () => void this.readMcpResource());
    add("bc-mcp-list-prompts", t("List MCP prompts and add to Canvas", "列出 MCP 提示模板并添加到画布"), () => void this.listMcpPrompts());
    add("bc-mcp-get-prompt", t("Run an MCP prompt and add to Canvas", "运行 MCP 提示模板并添加到画布"), () => void this.getMcpPrompt());
    add("bc-ai-mcp-tool", t("Ask AI to suggest an MCP tool call (confirm first)", "让 AI 建议 MCP 工具调用（执行前确认）"), () => void this.runAIMcpTool());
    add("bc-pdf-pages", t("Split PDF node into page cards", "将 PDF 节点拆分为分页卡片"), () => this.splitPdfPages());
    add("bc-pdf-ocr", t("Run AI OCR on selected PDF page", "对所选 PDF 页面执行 AI OCR"), () => this.ocrSelectedPdfPage());
    add("bc-pdf-ocr-range", t("Batch OCR a PDF page range (up to 20 pages)", "批量 OCR PDF 页码范围（最多 20 页）"), () => this.ocrPdfPageRange());
    add("bc-pdf-review-board", t("Create PDF page annotation board", "为 PDF 创建分页批注工作区"), () => this.createPdfReviewBoard());
    add("bc-create-canvas-portal", t("Create editable Canvas Portal", "创建可编辑 Canvas Portal"), () => this.createCanvasPortal());
    add("bc-portal-add-node", t("Create a text node in the selected Canvas Portal", "在选中 Canvas Portal 中创建文本节点"), () => this.addTextNodeToPortal());
  }

  private registerCanvasMenus(): void {
    const workspace = this.p.app.workspace;
    const nodeMenu = workspace.on("canvas:node-menu", (menu: Menu, node: CanvasNodeRuntime) => {
      if (!menu?.addItem || !node?.id) return;
      // Style now opens from the Canvas control stack, and colour, shape and
      // alignment live there. Their commands remain available for users who
      // prefer them; the menu keeps the actions without a panel equivalent.
      const actions: Array<[string, string, () => void]> = [
        [t("Copy link", "复制链接"), "link", () => void this.copyNodeLink()],
        [t("Flip connections", "翻转连线"), "git-compare", () => this.flipEdges()],
        [t("Bring to front", "置顶"), "layers", () => this.reorder(true)],
        [t("Send to back", "置底"), "layers-2", () => this.reorder(false)]
      ];
      for (const action of actions) {
        menu.addItem((item: MenuItem) => item.setTitle(action[0]).setIcon(action[1]).onClick(() => {
          this.selectNode(this.canvas(), String(node.id));
          action[2]();
        }));
      }
      const nodeData = node.getData?.() ?? node.data ?? (isCanvasNodeData(node) ? node : undefined);
      if (nodeData?.type === "file" && typeof nodeData.file === "string" && nodeData.file.toLowerCase().endsWith(".canvas")) {
        menu.addItem((item: MenuItem) => item
          .setTitle(nodeData.portal ? t("Close Portal", "关闭 Portal") : t("Open Portal", "打开 Portal"))
          .setIcon(nodeData.portal ? "door-closed" : "door-open")
          .onClick(() => this.portalManager?.togglePortalForNode(String(node.id))));
      }
    });
    this.p.registerEvent(nodeMenu);

    const selectionMenu = workspace.on("canvas:selection-menu", (menu: Menu, canvas: CanvasRuntime) => {
      if (!menu?.addItem || !canvas) return;
      menu.addItem((item: MenuItem) => item.setTitle(t("Select connections", "选连线")).setIcon("git-branch").onClick(() => this.selectEdges("all", canvas)));
      menu.addItem((item: MenuItem) => item.setTitle(t("Wrap", "封装")).setIcon("file-plus").onClick(() => void this.encapsulate(canvas)));
      menu.addItem((item: MenuItem) => item.setTitle(t("Connection style", "连线样式")).setIcon("palette").onClick(() => this.edgeStyle(canvas)));
    });
    this.p.registerEvent(selectionMenu);
  }

  private refresh(): void {
    if (this.stopped) return;
    const liveContainers = new Set<HTMLElement>();
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = isCanvasViewRuntime(leaf.view) ? leaf.view : null
      if (!view?.canvas) continue;
      liveContainers.add(view.containerEl);
      this.observeAutoResize(view, view.canvas);
      this.bindMindMapShortcuts(view, view.canvas);
      this.bindCanvasRouteRefresh(view);
      this.decorate(view.canvas);
      this.applyZoomBreakpoints(view.canvas);
      this.applyFocus(view.canvas);
      this.applySelectionEdgeHighlight(view.canvas);
      if (view.file) this.syncAutoEdges(view.canvas, view.file);
    }
    for (const state of this.resizeObservers.values()) {
      if (!liveContainers.has(state.container)) this.stopAutoResize(state);
    }
    this.scheduleAutoResize();
    this.refreshReadonly();
  }

  private decorate(canvas: CanvasRuntime, saveHistory = true): void {
    if (this.stopped) return;
    // Themes and style edits can change --variable-breakpoint, and decorate
    // runs after both; zoom frames reuse the resolved values in between.
    this.cssBreakpointCache = new WeakMap<HTMLElement, number>();
    decorateCanvas(canvas, saveHistory);
    const data = readCanvasData(canvas);
    syncHtmlPreviews(canvas, data, this.p.app.vault);
    for (const item of data.nodes) {
      const node = canvas.nodes?.get?.(item.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (!(element instanceof HTMLElement)) continue;
      const host = element.closest<HTMLElement>(".canvas-node") ?? element;
      // Guard every write: an unchanged value would still invalidate style and
      // fire the container MutationObserver, which is the expensive part on
      // large boards where decorate runs after every edit.
      const nodeColor = typeof (item).bcNodeColor === "string" ? String((item).bcNodeColor) : "";
      if (nodeColor) {
        if (host.style.borderColor !== nodeColor) host.style.borderColor = nodeColor;
        this.coloredNodeHosts.add(host);
      } else if (this.coloredNodeHosts.delete(host)) {
        host.style.removeProperty("border-color");
      }
      const shape = resolveCanvasNodeShape(item);
      if (host.dataset.bcShape !== shape) host.dataset.bcShape = shape;
      const border = resolveCanvasNodeBorder(item);
      if (host.dataset.bcBorder !== border) host.dataset.bcBorder = border;
      const previousClass = host.dataset.bcCustomClass;
      if (previousClass) host.classList.remove("bc-user-" + previousClass);
      const nextClass = typeof (item).bcCustomClass === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(String((item).bcCustomClass))
        ? String((item).bcCustomClass) : "";
      if (nextClass) host.classList.add("bc-user-" + nextClass);
      host.dataset.bcCustomClass = nextClass;

      // AI actions live in the Canvas node context menu. Remove any toolbar
      // left over from a previous plugin version so it cannot cover node text.
      if (host.classList.contains("bc-has-card-toolbar")) {
        host.querySelector(":scope > .bc-card-toolbar")?.remove();
        host.classList.remove("bc-has-card-toolbar");
      }
    }
    this.applyFocus(canvas);
  }

  private setNodeColor(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(t("Set node color", "设置节点颜色"), t("e.g. #5c6bc0", "例如 #5c6bc0"), value => {
      const span = this.p.app.workspace.containerEl.ownerDocument.win.createSpan();
      span.style.color = value;
      if (!span.style.color) {
        new Notice(t("Unrecognized color.", "无法识别颜色。"));
        return;
      }
      patchNode(selection.canvas, selection.node.id, { color: span.style.color, bcNodeColor: span.style.color });
      this.decorate(selection.canvas);
    });
  }

  private setNodeShape(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(
      t("Set node shape", "设置节点形状"),
      "default / rectangle / process / terminal / pill / decision / diamond / input-output / parallelogram / reference / circle / ellipse / predefined-process / document / database / hexagon / pentagon / octagon / triangle / trapezoid / chevron / cloud",
      value => {
        const shape = value.trim().toLowerCase();
        const normalizedShape = normalizeNodeShape(shape);
        if (!normalizedShape) {
          new Notice(t("Invalid shape. Choose a supported flowchart shape.", "形状无效。请选择受支持的流程图形状。"));
          return;
        }
        const priorAttributes = { ...((selection.node).styleAttributes ?? {}) };
        // Advanced Canvas uses a null/default value rather than a literal
        // "rectangle" style. Keep our visual alias separately and omit the
        // non-standard value so other renderers fall back to the default box.
        if (normalizedShape === "rectangle") delete priorAttributes.shape;
        else priorAttributes.shape = normalizedShape;
        patchNode(selection.canvas, selection.node.id, {
          bcShape: shape,
          styleAttributes: priorAttributes
        });
        this.decorate(selection.canvas);
      },
      String((selection.node).bcShape ?? "default")
    );
  }

  private setNodeBorder(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(t("Set node border", "设置节点边框"), "solid / dashed / dotted / double / invisible", value => {
      const style = value.trim().toLowerCase();
      if (!["solid", "dashed", "dotted", "double", "invisible"].includes(style)) {
        new Notice(t("Invalid border style.", "边框样式无效。"));
        return;
      }
      const priorAttributes = (selection.node).styleAttributes ?? {};
      patchNode(selection.canvas, selection.node.id, {
        bcBorderStyle: style,
        styleAttributes: { ...priorAttributes, border: style === "double" ? "solid" : style }
      });
      this.decorate(selection.canvas);
    });
  }

  private editStyleAttributes(): void {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开 Canvas。"));
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。"));
      return;
    }
    const selection = canvas.selection;
    if (!selection || selection.size !== 1) {
      new Notice(t("Select exactly one node or one connection.", "请只选择一个节点或一条连线。"));
      return;
    }

    const internal = selection.values().next().value;
    const id = internal?.id ?? internal?.getData?.()?.id;
    if (typeof id !== "string") {
      new Notice(t("Could not read the selected item ID.", "无法读取当前选择项 ID。"));
      return;
    }
    const data = readCanvasData(canvas);
    const node = data.nodes.find((item: CanvasNodeData) => item.id === id);
    const edge = data.edges.find((item: CanvasEdgeData) => item.id === id);
    const target = node ?? edge;
    if (!target) {
      new Notice(t("The current selection is not an editable Canvas node or connection.", "当前选择项不是可编辑的 Canvas 节点或连线。"));
      return;
    }

    const initial = JSON.stringify((target).styleAttributes ?? {}, null, 2);
    const parseAttributes = (raw: string): Record<string, unknown> => {
      const parsed = parseJsonObjectPrompt(raw, "styleAttributes");
      const snapshot = {
        nodes: node ? [{ ...node, styleAttributes: parsed }] : [],
        edges: edge ? [{ ...edge, styleAttributes: parsed }] : []
      };
      if (!isCanvasData(snapshot)) {
        throw new Error(t("Known style attributes must be strings or null.", "已知样式属性必须是字符串或 null。"));
      }
      return parsed;
    };
    this.input(
      t("Edit styleAttributes JSON", "编辑 styleAttributes JSON"),
      t("Enter a valid JSON object, e.g. { \"shape\": \"diamond\" }", "输入有效的 JSON 对象，例如 { \"shape\": \"diamond\" }"),
      raw => {
        const parsed = parseAttributes(raw);
        if (node) {
          patchNode(canvas, node.id, { styleAttributes: parsed });
        } else if (edge) {
          const nextEdges = data.edges.map((item: CanvasEdgeData) =>
            item.id === edge.id ? { ...item, styleAttributes: parsed } : item
          );
          canvas.importData({ ...data, nodes: data.nodes, edges: nextEdges });
          canvas.requestSave?.();
          canvas.requestFrame?.();
        }
        this.decorate(canvas);
        new Notice(t("Saved styleAttributes. Rendering depends on the properties supported by Obsidian and the current Canvas renderer.", "已保存 styleAttributes。实际渲染效果取决于 Obsidian 与当前 Canvas 渲染器支持的属性。"));
      },
      initial,
      false,
      promptValidator(parseAttributes)
    );
  }

  private makeDefaultTextNode(text: string, x: number, y: number, height?: number): CanvasNodeData {
    const size = defaultNodeSize();
    return makeTextNode(text, x, y, { width: size.width, height: height ?? size.height });
  }
  private setZoomBreakpoint(): void {
    const selected = this.selected();
    if (!selected) return;
    this.input(t("Set zoom breakpoint", "设置缩放断点"), t("Enter a zoom scale (e.g. 0.6); enter off to clear", "输入缩放比例（例如 0.6）；输入 off 清除"), value => {
      if (value.trim().toLowerCase() === "off") {
        patchNode(selected.canvas, selected.node.id, { bcZoomBreakpoint: null });
        this.applyZoomBreakpoints(selected.canvas);
        new Notice(t("Cleared the node zoom breakpoint.", "已清除节点缩放断点。"));
        return;
      }
      const breakpoint = Number(value);
      if (!Number.isFinite(breakpoint) || breakpoint < 0.05 || breakpoint > 5) {
        new Notice(t("Enter a zoom scale between 0.05 and 5, or enter off.", "请输入 0.05 到 5 之间的缩放比例，或输入 off。"));
        return;
      }
      patchNode(selected.canvas, selected.node.id, { bcZoomBreakpoint: breakpoint });
      this.applyZoomBreakpoints(selected.canvas);
      new Notice(t("Zoom breakpoint set: ", "已设置缩放断点：") + breakpoint);
    }, typeof (selected.node).bcZoomBreakpoint === "number" ? String((selected.node).bcZoomBreakpoint) : "off");
  }

  private applyZoomBreakpoints(canvas: CanvasRuntime): void {
    // Obsidian Canvas exposes zoom in log2 units; plugin/CSS breakpoints use
    // the human-facing linear scale (1 = 100%, 0.6 = 60%).
    const scale = canvasScaleFromLogZoom(canvas?.zoom);
    if (scale === undefined) return;
    for (const nodeData of readCanvasData(canvas).nodes) {
      const node = canvas?.nodes?.get?.(nodeData.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (!(element instanceof HTMLElement)) continue;
      const stored = (nodeData).bcZoomBreakpoint;
      const breakpoint = typeof stored === "number" && Number.isFinite(stored)
        ? stored : this.cssBreakpointOf(element);
      if (!Number.isFinite(breakpoint)) {
        if (element.dataset.bcBreakpointHidden !== undefined) delete element.dataset.bcBreakpointHidden;
        continue;
      }
      const hidden = String(isBelowZoomBreakpoint(scale, breakpoint));
      if (element.dataset.bcBreakpointHidden !== hidden) element.dataset.bcBreakpointHidden = hidden;
    }
  }

  private cssBreakpointOf(element: HTMLElement): number {
    const cached = this.cssBreakpointCache.get(element);
    if (cached !== undefined) return cached;
    const value = window.getComputedStyle(element).getPropertyValue("--variable-breakpoint").trim();
    const breakpoint = value ? Number.parseFloat(value) : NaN;
    this.cssBreakpointCache.set(element, breakpoint);
    return breakpoint;
  }
  private setNodeCustomClass(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(t("Set custom style class for node", "设置节点自定义样式类"), t("Enter a class name (letters, digits, underscores, hyphens); leave empty to clear", "输入 class 名（字母、数字、下划线和连字符）；留空可清除"), value => {
      const token = value.trim();
      if (token && !/^[a-zA-Z0-9_-]{1,50}$/.test(token)) {
        new Notice(t("Class names may only contain letters, digits, underscores, and hyphens (max 50 characters).", "class 名只能包含字母、数字、下划线和连字符（最多 50 个字符）。"));
        return;
      }
      patchNode(selection.canvas, selection.node.id, { bcCustomClass: token || undefined });
      this.decorate(selection.canvas);
      new Notice(token ? t("Applied style class bc-user-", "已应用样式类 bc-user-") + token : t("Cleared the node custom style class.", "已清除节点自定义样式类。"));
    }, typeof selection.node.bcCustomClass === "string" ? selection.node.bcCustomClass : "", true);
  }
  private setNodeTextAlign(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(t("Set node text alignment", "设置节点文字对齐"), "left / center / right / justify", value => {
      const align = value.trim().toLowerCase();
      if (!["left", "center", "right", "justify"].includes(align)) {
        new Notice(t("Invalid alignment.", "对齐方式无效。"));
        return;
      }
      const priorAttributes = (selection.node).styleAttributes ?? {};
      patchNode(selection.canvas, selection.node.id, {
        bcTextAlign: align,
        styleAttributes: { ...priorAttributes, textAlign: ["left", "center", "right"].includes(align) ? align : "left" }
      });
      this.decorate(selection.canvas);
    }, String((selection.node).bcTextAlign ?? "left"));
  }

  private edgePathfinding(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (isCanvasReadOnly(canvas)) { new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。")); return; }
    this.input(t("Set connection pathfinding algorithm", "设置连线路径算法"), "bezier / direct / square / a-star", value => {
      const allowed = ["bezier", "direct", "square", "a-star"] as const;
      const method = allowed.find(method => method === value.trim().toLowerCase());
      if (!method) {
        new Notice(t("Invalid pathfinding algorithm. Choose bezier, direct, square, or a-star.", "路径算法无效。请选择 bezier、direct、square 或 a-star。"));
        return;
      }
      const count = styleSelectedEdgePathfinding(canvas, method);
      this.decorate(canvas);
      new Notice(count ? t("Updated the pathfinding algorithm for " + count + " connections.", "已更新 " + count + " 条连线的路径算法。") : t("Select one or more connections first.", "请先选择一条或多条连线。"));
    }, "square");
  }

  private edgeArrowStyle(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (isCanvasReadOnly(canvas)) { new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。")); return; }
    this.input(t("Set connection arrow style", "设置连线箭头样式"), "default / triangle-outline / half-triangle / thin-triangle / diamond / diamond-outline / circle / circle-outline / blunt / none", value => {
      const allowed = ["default", "triangle-outline", "half-triangle", "thin-triangle", "diamond", "diamond-outline", "circle", "circle-outline", "blunt", "none"] as const;
      const style = allowed.find(style => style === value.trim().toLowerCase());
      if (!style) { new Notice(t("Invalid arrow style.", "箭头样式无效。")); return; }
      const count = styleSelectedEdgeArrow(canvas, style);
      this.decorate(canvas);
      new Notice(count ? t("Set the arrow style for " + count + " connections.", "已设置 " + count + " 条连线的箭头样式。") : t("Select one or more connections first.", "请先选择一条或多条连线。"));
    }, "default");
  }
  private resizeNode(): void {
    const selection = this.selected();
    if (!selection) return;
    const resized = this.resizeTextNode(selection.canvas, selection.node.id);
    if (resized) this.decorate(selection.canvas);
    new Notice(resized ? t("Resized the node.", "已调整节点尺寸。") : t("Only non-empty text nodes are supported.", "仅支持非空文本节点。"));
  }

  private toggleAutoResize(): void {
    const selection = this.selected();
    if (!selection || this.isResizeReadOnly(selection.canvas)) return;
    const enabled = (selection.node).bcAutoResize !== true;
    patchNode(selection.canvas, selection.node.id, { bcAutoResize: enabled });
    if (enabled) {
      this.decorate(selection.canvas);
      this.resizeTextNode(selection.canvas, selection.node.id);
    }
    this.decorate(selection.canvas);
    new Notice(enabled ? t("Auto-size enabled for this node.", "此节点已启用自动尺寸。") : t("Auto-size disabled for this node.", "此节点已关闭自动尺寸。"));
  }

  private bindCanvasRouteRefresh(view: CanvasViewRuntime): void {
    const container = view.containerEl;
    if (!(container.instanceOf(HTMLElement)) || this.boundRouteContainers.has(container)) return;
    this.boundRouteContainers.add(container);

    // Zooming only moves the viewport transform: node/edge geometry, text and
    // selection are unchanged, so a wheel frame must not pay for a full
    // decorate pass (O(nodes + edges) DOM writes, several ms on large boards).
    // Only the zoom breakpoint visibility depends on the current scale.
    let zoomQueued = false;
    const scheduleZoom = () => {
      if (this.stopped || zoomQueued) return;
      zoomQueued = true;
      window.requestAnimationFrame(() => {
        zoomQueued = false;
        if (this.stopped) return;
        const canvas = view?.canvas;
        if (canvas) this.applyZoomBreakpoints(canvas);
      });
    };

    let queued = false;
    const schedule = () => {
      if (this.stopped || queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        if (this.stopped) return;
        const canvas = view?.canvas;
        if (!canvas) return;
        this.decorate(canvas);
        this.applyZoomBreakpoints(canvas);
        this.applySelectionEdgeHighlight(canvas);
      });
    };
    container.addEventListener("pointerup", schedule, true);
    container.addEventListener("pointercancel", schedule, true);
    container.addEventListener("keyup", schedule, true);
    container.addEventListener("wheel", scheduleZoom, { capture: true, passive: true });
    this.p.register(() => {
      container.removeEventListener("pointerup", schedule, true);
      container.removeEventListener("pointercancel", schedule, true);
      container.removeEventListener("keyup", schedule, true);
      container.removeEventListener("wheel", scheduleZoom, true);
      this.boundRouteContainers.delete(container);
    });
  }

  private bindMindMapShortcuts(view: CanvasViewRuntime, canvas: CanvasRuntime): void {
    const container = view?.containerEl;
    if (!(container.instanceOf(HTMLElement)) || this.boundContainers.has(container)) return;
    this.boundContainers.add(container);

    this.p.registerDomEvent(container, "keydown", (event: KeyboardEvent) => {
      const target = event.target as Node | null;
      if (target?.instanceOf?.(HTMLElement) && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true'], .cm-editor"))) return;
      const selectedInternal = canvas?.selection?.values?.().next?.().value;
      if (!selectedInternal || selectedInternal.isEditing) return;
      const direction = event.key === "ArrowLeft" ? "left"
        : event.key === "ArrowRight" ? "right"
        : event.key === "ArrowUp" ? "up"
        : event.key === "ArrowDown" ? "down" : "";
      if (!direction || !(event.ctrlKey || event.metaKey) ||
          !isMindMapShortcutEnabled(this.settings(), "directionalCtrlArrow")) return;
      const selected = this.selected(canvas);
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      const node = selected.node;
      const gap = 100;
      const x = direction === "left" ? node.x - node.width - gap
        : direction === "right" ? node.x + node.width + gap : node.x;
      const y = direction === "up" ? node.y - node.height - gap
        : direction === "down" ? node.y + node.height + gap : node.y;
      const created = makeTextNode("", x, y, defaultNodeSize());
      insertCanvasNode(canvas, created, event.shiftKey ? node.id : undefined);
      window.setTimeout(() => {
        const internal = canvas.nodes?.get?.(created.id);
        if (!internal) return;
        canvas.selectOnly?.(internal);
        internal.startEditing?.();
        canvas.zoomToSelection?.();
      }, 0);
    });
  }

  private registerAutoResizeEvents(): void {
    const workspace = this.p.app.workspace;
    for (const name of ["better-canvas:theme-changed", "css-change"] as const) {
      this.p.registerEvent(workspace.on(name, () => this.scheduleAutoResize(undefined, true)));
    }
    for (const name of ["advanced-canvas:data-loaded:before", "advanced-canvas:data-loaded:after"] as const) {
      this.p.registerEvent(workspace.on(name, (canvas: CanvasRuntime, incoming?: CanvasData) => {
        // Undo/redo and preset imports also emit node-resized. Their restored
        // geometry is not a user dragging a corner and must preserve opt-in.
        const data = name.endsWith(":after") ? readCanvasData(canvas) : incoming;
        if (data && Array.isArray(data.nodes)) {
          this.expectedImportedResizes.set(canvas, new Map(data.nodes
            .filter(node => Number.isFinite(node.width) && Number.isFinite(node.height))
            .map(node => [node.id, { width: node.width, height: node.height }])));
        }
        if (name.endsWith(":after")) {
          // Restoring an opted-out node must also clear its old automatic
          // padding, even though that node will be skipped by the reflow.
          for (const node of data?.nodes ?? []) {
            const internal = canvas.nodes?.get?.(node.id);
            const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
            if (element?.dataset && element?.style) {
              decorateAutoResizeInsets(element, node, resolveCanvasTheme(data ?? {}));
            }
          }
          this.scheduleAutoResize(canvas);
        }
      }));
    }
    for (const name of ["advanced-canvas:node-changed",
      "advanced-canvas:node-text-content-changed", "advanced-canvas:node-rendered"] as const) {
      this.p.registerEvent(workspace.on(name, (canvas: CanvasRuntime) => this.scheduleAutoResize(canvas)));
    }
    this.p.registerEvent(workspace.on("advanced-canvas:node-editing-state-changed", (canvas: CanvasRuntime, _node: CanvasNodeRuntime, editing: boolean) => {
      if (!editing) this.scheduleAutoResize(canvas, true);
    }));
    this.p.registerEvent(workspace.on("advanced-canvas:readonly-changed", (canvas: CanvasRuntime, readonly: boolean) => {
      if (!readonly) this.scheduleAutoResize(canvas, true);
    }));
    this.p.registerEvent(workspace.on("advanced-canvas:dragging-state-changed", (canvas: CanvasRuntime, dragging: boolean) => {
      if (dragging) this.draggingCanvases.add(canvas);
      else {
        this.draggingCanvases.delete(canvas);
        this.scheduleAutoResize(canvas);
      }
    }));
    this.p.registerEvent(workspace.on("advanced-canvas:canvas-view-unloaded:before", (view: CanvasViewRuntime) => {
      const state = this.resizeObservers.get(view?.containerEl);
      if (state) this.stopAutoResize(state);
    }));
  }

  private watchAutoResizeFonts(doc: Document | undefined): void {
    if (!doc?.fonts || this.fontDocuments.has(doc)) return;
    this.fontDocuments.add(doc);
    const refresh = (): void => this.scheduleAutoResize(undefined, true);
    doc.fonts.addEventListener("loadingdone", refresh);
    void doc.fonts.ready?.then(refresh);
    this.p.register(() => {
      doc.fonts.removeEventListener("loadingdone", refresh);
      this.fontDocuments.delete(doc);
    });
  }

  private scheduleAutoResize(canvas?: CanvasRuntime, invalidate = false): void {
    if (this.stopped) return;
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = isCanvasViewRuntime(leaf.view) ? leaf.view : null
      if (!view?.canvas || (canvas && canvas !== view.canvas)) continue;
      const state = this.observeAutoResize(view, view.canvas);
      if (!state) continue;
      if (invalidate) state.revision++;
      this.queueAutoResize(state);
    }
  }

  private queueAutoResize(state: AutoResizeObservation): void {
    if (this.stopped || this.resizeObservers.get(state.container) !== state || state.timer !== null) return;
    state.timer = window.setTimeout(() => {
      state.timer = null;
      this.reflowAutoResize(state);
    }, 220);
  }

  private autoResizeSnapshot(state: AutoResizeObservation, node: CanvasNodeData, theme: unknown) {
    const internal = state.canvas.nodes?.get?.(node.id);
    const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
    return {
      // Ignore temporary measuring styles and our preview-sizer writes. Native
      // content mutations and CSS/font events explicitly invalidate this key.
      signature: JSON.stringify([state.revision, theme, node.text, node.width, node.height,
        node.bcAutoResize, node.bcShape, node.bcBorderStyle, node.bcTextAlign, node.bcCustomClass,
        node.bcScrapbookPreset, node.bcSketchPreset, node.bcSoftNotesPreset,
        node.bcResearchPreset, node.bcResearchIntensity, node.styleAttributes]),
      preview: element?.querySelector?.(".markdown-preview-view") ?? null
    };
  }

  private reflowAutoResize(state: AutoResizeObservation): void {
    const canvas = state.canvas;
    if (this.stopped || this.resizeObservers.get(state.container) !== state) return;
    if (state.view.canvas !== canvas) { this.stopAutoResize(state); return; }
    if (this.isResizeReadOnly(canvas) || this.draggingCanvases.has(canvas)) return;
    const data = readCanvasData(canvas);
    const measured = new Set<string>();
    let changed = false;
    for (const node of data.nodes) {
      if (node.type !== "text" || node.bcAutoResize !== true || !node.text?.trim()) continue;
      const internal = canvas.nodes?.get?.(node.id);
      const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
      if (!element || internal?.isEditing || internal?.isResizing ||
          ["is-dragging", "is-resizing", "is-editing"].some(name => element.classList?.contains(name))) continue;
      const snapshot = this.autoResizeSnapshot(state, node, data.bcTheme);
      if (!snapshot.preview) continue;
      const previous = state.snapshots.get(node.id);
      if (previous?.signature === snapshot.signature && previous?.preview === snapshot.preview) continue;
      const before = JSON.stringify([node.width, node.height, node.bcTextAlign, node.styleAttributes]);
      if (!this.resizeTextNode(canvas, node.id, false)) continue;
      measured.add(node.id);
      const after = readCanvasData(canvas).nodes.find(item => item.id === node.id);
      if (after && before !== JSON.stringify([after.width, after.height, after.bcTextAlign, after.styleAttributes])) changed = true;
    }
    if (changed) this.decorate(canvas, false);
    const current = readCanvasData(canvas);
    for (const node of current.nodes) {
      if (measured.has(node.id)) state.snapshots.set(node.id, this.autoResizeSnapshot(state, node, current.bcTheme));
    }
    const liveIds = new Set(current.nodes.map(node => node.id));
    for (const id of state.snapshots.keys()) if (!liveIds.has(id)) state.snapshots.delete(id);
    for (const id of this.expectedAutoResizes.get(canvas)?.keys() ?? []) {
      if (!liveIds.has(id)) this.expectedAutoResizes.get(canvas)?.delete(id);
    }
    for (const id of this.expectedImportedResizes.get(canvas)?.keys() ?? []) {
      if (!liveIds.has(id)) this.expectedImportedResizes.get(canvas)?.delete(id);
    }
    this.applyZoomBreakpoints(canvas);
    const htmlSignature = JSON.stringify(current.nodes.map(node => [node.id, node.type, node.text, node.file]));
    if (!changed && (measured.size > 0 || state.htmlSignature !== htmlSignature)) {
      syncHtmlPreviews(canvas, current, this.p.app.vault);
    }
    state.htmlSignature = htmlSignature;
  }

  private stopAutoResize(state: AutoResizeObservation): void {
    state.observer.disconnect();
    if (state.timer !== null) window.clearTimeout(state.timer);
    this.resizeObservers.delete(state.container);
    this.expectedAutoResizes.delete(state.canvas);
    this.expectedImportedResizes.delete(state.canvas);
    this.activeAutoResizes.delete(state.canvas);
    this.draggingCanvases.delete(state.canvas);
  }

  private observeAutoResize(view: CanvasViewRuntime, canvas: CanvasRuntime): AutoResizeObservation | undefined {
    const container = view?.containerEl;
    if (typeof HTMLElement === "undefined" || !(container.instanceOf(HTMLElement))) return;
    const existing = this.resizeObservers.get(container);
    if (existing?.canvas === canvas) return existing;
    if (existing) this.stopAutoResize(existing);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "characterData") {
          const target = mutation.target.instanceOf(Element) ? mutation.target : mutation.target.parentElement;
          if (target?.closest?.(".markdown-preview-view")) { state.revision++; break; }
        }
      }
      this.queueAutoResize(state);
    });
    const state: AutoResizeObservation = { view, canvas, container, observer, timer: null, revision: 0, snapshots: new Map() };
    this.resizeObservers.set(container, state);
    observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["style", "transform", "class", "data-bc-theme"] });
    this.watchAutoResizeFonts(container.ownerDocument);
    return state;
  }

  private flipEdges(): void {
    const selection = this.selected();
    if (!selection) return;
    const count = flipIncidentEdges(selection.canvas, selection.node.id);
    new Notice(count ? t("Flipped " + count + " connections.", "已翻转 " + count + " 条连线。") : t("This node has no connections.", "此节点没有关联连线。"));
  }

  private colorEdges(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input(t("Set connection color", "设置连线颜色"), t("e.g. #5c6bc0", "例如 #5c6bc0"), value => {
      const span = this.p.app.workspace.containerEl.ownerDocument.win.createSpan();
      span.style.color = value;
      if (!span.style.color) {
        new Notice(t("Unrecognized color.", "无法识别颜色。"));
        return;
      }
      const count = colorIncidentEdges(selection.canvas, selection.node.id, span.style.color);
      this.decorate(selection.canvas);
      new Notice(t("Set the color of " + count + " connections.", "已设置 " + count + " 条连线颜色。"));
    });
  }

  private edgeStyle(canvas = this.canvas()): void {
    if (!canvas) return;
    if (isCanvasReadOnly(canvas)) { new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。")); return; }
    this.input(t("Set style of selected connections", "设置选中连线样式"), t("color,solid|dashed|dotted, e.g. #5c6bc0,dashed", "颜色,solid|dashed|dotted，例如 #5c6bc0,dashed"), value => {
      const parts = value.split(",");
      const color = (parts[0] ?? "").trim();
      const style = (parts[1] ?? "solid").trim().toLowerCase();
      const span = this.p.app.workspace.containerEl.ownerDocument.win.createSpan();
      span.style.color = color;
      if (!span.style.color || (style !== "solid" && style !== "dashed" && style !== "dotted")) {
        new Notice(t("Invalid format.", "格式无效。"));
        return;
      }
      const count = styleSelectedEdges(canvas, span.style.color, style);
      this.decorate(canvas);
      new Notice(count ? t("Updated " + count + " connections.", "已更新 " + count + " 条连线。") : t("Select connections first.", "请先选择连线。"));
    });
  }

  private zoomToFitCanvas(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    try {
      const count = zoomCanvasToFit(canvas);
      if (!count) {
        new Notice(t("This Canvas has no nodes to zoom to, or the current Obsidian version does not support this action.", "当前 Canvas 没有可缩放的节点，或当前 Obsidian 版本不支持此操作。"));
        return;
      }
      new Notice(t("Zoomed to fit the entire Canvas; the previous node/connection selection was restored.", "已缩放以适应整个 Canvas；原来的节点/连线选择已恢复。"));
    } catch (error) {
      new Notice(t("Failed to zoom the Canvas: ", "缩放 Canvas 失败：") + (error instanceof Error ? error.message : String(error)), 6000);
    }
  }

  private selectAllCanvasEdges(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    const count = selectAllCanvasEdges(canvas);
    new Notice(count ? t("Selected all " + count + " connections in the Canvas.", "已选择画布中的全部 " + count + " 条连线。") : t("This Canvas has no selectable connections.", "当前画布没有可选择的连线。"));
  }

  private selectEdges(direction: "all" | "incoming" | "outgoing", canvas = this.canvas()): void {
    if (!canvas) return;
    const count = moveSelectionEdgesToTop(canvas, direction);
    new Notice(count ? t("Selected " + count + " connections.", "已选择 " + count + " 条连线。") : t("No matching connections.", "没有匹配连线。"));
  }

  private readonlyOptions(): CanvasReadonlyOptions {
    const settings = this.settings();
    return {
      disableContextMenus: settings.readOnlyDisableNodeMenusEnabled !== false,
      lockPanZoom: settings.readOnlyLockPanZoomEnabled === true
    };
  }

  /** Refresh read-only event guards after commands or setting changes. */
  refreshReadonly(): void {
    const containers: HTMLElement[] = [];
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = isCanvasViewRuntime(leaf.view) ? leaf.view : null
      if (!view?.canvas) continue;
      this.readonlyController.bind(view, view.canvas, this.readonlyOptions());
      containers.push(view.containerEl ?? view.contentEl ?? view.canvas.wrapperEl);
    }
    this.readonlyController.retainOnly(containers);
  }

  private toggleReadonly(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    const wrapper = canvas.wrapperEl;
    if (!(wrapper instanceof HTMLElement)) { new Notice(t("Could not access the Canvas container.", "无法获取 Canvas 容器。")); return; }
    const enabled = !wrapper.classList.contains("bc-readonly");
    wrapper.classList.toggle("bc-readonly", enabled);
    this.refreshReadonly();
    new Notice(enabled ? t("Read-only mode enabled; nodes cannot be dragged or edited with the mouse. Run the command again to turn it off.", "已启用只读模式；节点不能被鼠标拖动或编辑。再次运行命令可解除。") : t("Read-only mode turned off.", "已退出只读模式。"));
  }
  private alignSelectionToGrid(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    const selection = canvas.selection;
    const ids = new Set<string>();
    for (const item of selection?.values?.() ?? []) {
      const id = item?.id ?? item?.getData?.()?.id;
      if (typeof id === "string" && canvas.nodes?.has?.(id)) ids.add(id);
    }
    if (!ids.size) { new Notice(t("Select one or more nodes first.", "请先选择一个或多个节点。")); return; }
    const data = readCanvasData(canvas);
    const step = Math.max(1, Math.min(500, Number(this.settings().gridSize) || 20));
    const nodes = data.nodes.map((node: CanvasNodeData) => ids.has(node.id) ? {
      ...node,
      x: Math.round(node.x / step) * step,
      y: Math.round(node.y / step) * step
    } : node);
    canvas.importData({ ...data, nodes, edges: data.edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    new Notice(t("Aligned " + ids.size + " nodes to a " + step + " px grid.", "已将 " + ids.size + " 个节点对齐到 " + step + " px 网格。"));
  }
  private selectedCanvasNodeIds(canvas: CanvasRuntime): Set<string> {
    const ids = new Set<string>();
    for (const item of canvas?.selection?.values?.() ?? []) {
      const id = item?.id ?? item?.getData?.()?.id;
      if (typeof id === "string" && canvas.nodes?.has?.(id)) ids.add(id);
    }
    return ids;
  }

  private flipSelectionPositions(axis: "horizontal" | "vertical"): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node positions cannot be flipped.", "当前 Canvas 处于只读模式，不能翻转节点位置。"));
      return;
    }
    const ids = this.selectedCanvasNodeIds(canvas);
    if (ids.size < 2) {
      new Notice(t("Select at least two nodes before flipping the layout.", "请至少选择两个节点后再翻转布局。"));
      return;
    }
    const data = readCanvasData(canvas);
    const nodes = flipCanvasNodePositions(data.nodes, ids, axis);
    canvas.importData({ ...data, nodes, edges: data.edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    new Notice(axis === "horizontal" ? t("Flipped the selected nodes horizontally.", "已水平翻转所选节点布局。") : t("Flipped the selected nodes vertically.", "已垂直翻转所选节点布局。"));
  }

  private swapSelectedNodePositions(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node positions cannot be swapped.", "当前 Canvas 处于只读模式，不能交换节点位置。"));
      return;
    }
    const ids = this.selectedCanvasNodeIds(canvas);
    if (ids.size !== 2) {
      new Notice(t("Select exactly two nodes before swapping positions.", "请恰好选择两个节点后再交换位置。"));
      return;
    }
    const data = readCanvasData(canvas);
    const nodes = swapCanvasNodePositions(data.nodes, ids);
    canvas.importData({ ...data, nodes, edges: data.edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    new Notice(t("Swapped the center positions of the two nodes.", "已交换两个节点的中心位置。"));
  }

  private reorder(front: boolean): void {
    const selection = this.selected();
    if (!selection) return;
    reorderNode(selection.canvas, selection.node.id, front);
    this.decorate(selection.canvas);
  }

  private focus(): void {
    const selection = this.selected();
    if (!selection) return;
    const canvas = selection.canvas;
    if (this.focusedCanvases.has(canvas)) {
      this.focusedCanvases.delete(canvas);
      new Notice(t("Exited focus mode.", "已退出专注模式。"));
    } else {
      this.focusedCanvases.set(canvas, selection.node.id);
      new Notice(t("Focused the selected node and its directly connected nodes.", "已聚焦所选节点及其直接关联节点。"));
    }
    this.applyFocus(canvas);
  }

  private applyFocus(canvas: CanvasRuntime): void {
    const root = this.focusedCanvases.get(canvas);
    canvas?.wrapperEl?.classList.toggle("bc-focus-mode", Boolean(root));
    const data = readCanvasData(canvas);
    const visible = new Set<string>();
    if (root) {
      visible.add(root);
      for (const edge of data.edges) {
        if (edge.fromNode === root) visible.add(edge.toNode);
        if (edge.toNode === root) visible.add(edge.fromNode);
      }
    }
    for (const nodeData of data.nodes) {
      const node = canvas.nodes?.get?.(nodeData.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (element instanceof HTMLElement) element.classList.toggle("bc-focus-dimmed", Boolean(root) && !visible.has(nodeData.id));
    }
    for (const edgeData of data.edges) {
      const edge = canvas.edges?.get?.(edgeData.id);
      const path = edge?.path instanceof SVGElement ? edge.path : edge?.path?.display ?? edge?.path?.el;
      const related = Boolean(root) && (edgeData.fromNode === root || edgeData.toNode === root);
      if (path instanceof SVGElement) path.classList.toggle("bc-focus-dimmed", Boolean(root) && !related);
    }
  }

  /**
   * Highlight every edge incident to the current node selection.
   * This is visual-only: Canvas JSON and the current selection remain untouched.
   */
  private applySelectionEdgeHighlight(canvas: CanvasRuntime): void {
    if (!canvas) return;
    const data = readCanvasData(canvas);
    const nodeIds = new Set(data.nodes.map(node => node.id));
    const selected = selectedCanvasNodeIds(canvas, nodeIds);
    const highlighted = connectedEdgeIds(data.edges, selected);
    for (const edgeData of data.edges) {
      const edge = canvas.edges?.get?.(edgeData.id);
      const path = edge?.path instanceof SVGElement ? edge.path : edge?.path?.display ?? edge?.path?.el;
      if (path instanceof SVGElement) {
        path.classList.toggle("bc-selection-related", highlighted.has(edgeData.id));
      }
    }
  }

  private createStandaloneGroup(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) { new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。")); return; }
    const selected = this.selected(canvas);
    const data = readCanvasData(canvas);
    let x = 0;
    let y = 0;
    if (selected) {
      x = selected.node.x + selected.node.width + 100;
      y = selected.node.y;
    } else if (data.nodes.length) {
      const rightmost = Math.max(...data.nodes.map((node: CanvasNodeData) => node.x + node.width));
      const topmost = Math.min(...data.nodes.map((node: CanvasNodeData) => node.y));
      x = rightmost + 100;
      y = topmost;
    }
    const group: CanvasNodeData = {
      id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
      type: "group",
      x,
      y,
      width: 640,
      height: 420,
      label: t("New group", "新建分组"),
      color: "2"
    };
    canvas.importData({ ...data, nodes: [...data.nodes, group], edges: data.edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    window.setTimeout(() => {
      const internal = canvas.nodes?.get?.(group.id);
      if (internal) {
        canvas.selectOnly?.(internal);
        canvas.zoomToSelection?.();
      }
    }, 0);
    new Notice(t("Created a standalone group. Drag or resize it to include related nodes.", "已创建独立分组。拖动或调整大小即可将相关节点归入其中。"));
  }

  private collapseGroup(): void {
    const selection = this.selected();
    if (!selection) return;
    const state = toggleGroupCollapse(selection.canvas, selection.node.id);
    if (state === "not-group") new Notice(t("Select a group node.", "请选择分组节点。"));
    else if (state === "empty") new Notice(t("The group has no collapsible nodes.", "分组内没有可折叠节点。"));
    else if (state === "missing") new Notice(t("Node not found.", "找不到节点。"));
    else new Notice(state === "expanded" ? t("Expanded the group.", "已展开分组。") : t("Collapsed the group.", "已折叠分组。"));
    this.decorate(selection.canvas);
  }

  private async encapsulate(canvas = this.canvas()): Promise<void> {
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开 Canvas。"));
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode before wrapping the selection.", "当前 Canvas 处于只读模式。请先解除只读模式再封装选区。"));
      return;
    }
    const data = readCanvasData(canvas);
    const ids = new Set<string>();
    for (const item of canvas.selection?.values?.() ?? []) {
      if (item?.id && data.nodes.some((node: CanvasNodeData) => node.id === item.id)) ids.add(item.id);
    }
    const nodes = data.nodes.filter((node: CanvasNodeData) => ids.has(node.id));
    if (!nodes.length) {
      new Notice(t("Select the nodes to wrap first.", "请先选择要封装的节点。"));
      return;
    }
    const childEdges = data.edges.filter((edge: CanvasEdgeData) => ids.has(edge.fromNode) && ids.has(edge.toNode));
    this.input(t("Wrap selection", "封装选区"), t("New Canvas file name (no extension)", "新 Canvas 文件名（不需要扩展名）"), async name => {
      const base = name.replace(/[\\/:*?"<>|]/g, "-").trim();
      if (!base) return;
      try {
        const view = this.activeCanvasView();
        const folder = String(view?.file?.parent?.path ?? "").replace(/^\/+|\/+$/g, "");
        const pathBase = joinVaultPath(folder, base);
        const filePath = await this.uniquePath(pathBase, "canvas");

        // Rebase the moved subgraph so that it opens around the Canvas origin.
        const minX = Math.min(...nodes.map((node: CanvasNodeData) => node.x));
        const minY = Math.min(...nodes.map((node: CanvasNodeData) => node.y));
        const maxX = Math.max(...nodes.map((node: CanvasNodeData) => node.x + node.width));
        const maxY = Math.max(...nodes.map((node: CanvasNodeData) => node.y + node.height));
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const movedNodes = nodes.map((node: CanvasNodeData) => ({
          ...node,
          x: node.x - centerX,
          y: node.y - centerY
        }));
        await this.p.app.vault.create(filePath, JSON.stringify({ nodes: movedNodes, edges: childEdges }, null, 2));

        const fileNode: CanvasNodeData = {
          id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
          type: "file",
          file: filePath,
          x: centerX - 150,
          y: centerY - 100,
          width: 300,
          height: 200
        };

        const outerEdges = data.edges.flatMap((edge: CanvasEdgeData) => {
          const fromSelected = ids.has(edge.fromNode);
          const toSelected = ids.has(edge.toNode);
          if (fromSelected && toSelected) return [];
          if (!fromSelected && !toSelected) return [edge];

          const outsideId = fromSelected ? edge.toNode : edge.fromNode;
          const outsideNode = data.nodes.find((node: CanvasNodeData) => node.id === outsideId);
          if (!outsideNode) return [];

          const fromNode = fromSelected ? fileNode : outsideNode;
          const toNode = toSelected ? fileNode : outsideNode;
          const fromCenterX = fromNode.x + fromNode.width / 2;
          const fromCenterY = fromNode.y + fromNode.height / 2;
          const toCenterX = toNode.x + toNode.width / 2;
          const toCenterY = toNode.y + toNode.height / 2;
          const dx = toCenterX - fromCenterX;
          const dy = toCenterY - fromCenterY;
          let fromSide: string;
          let toSide: string;
          if (Math.abs(dx) >= Math.abs(dy)) {
            fromSide = dx >= 0 ? "right" : "left";
            toSide = dx >= 0 ? "left" : "right";
          } else {
            fromSide = dy >= 0 ? "bottom" : "top";
            toSide = dy >= 0 ? "top" : "bottom";
          }

          return [{
            ...edge,
            fromNode: fromSelected ? fileNode.id : edge.fromNode,
            toNode: toSelected ? fileNode.id : edge.toNode,
            fromSide,
            toSide
          }];
        });

        canvas.importData({
          ...data,
          nodes: [...data.nodes.filter((node: CanvasNodeData) => !ids.has(node.id)), fileNode],
          edges: outerEdges
        });
        canvas.requestSave?.();
        canvas.requestFrame?.();
        new Notice(t("Moved the selection to " + filePath + "; connections crossing the selection boundary are connected to the new Canvas node.", "选区已移动到 " + filePath + "；跨越选区边界的连线已连接到新 Canvas 节点。"));
      } catch (error) {
        new Notice(t("Failed to wrap the selection: ", "封装选区失败：") + (error instanceof Error ? error.message : String(error)), 8000);
      }
    });
  }

  private async materializeCanvasLinks(
    view: CanvasViewRuntime,
    sourcePath: string,
    outgoing: CanvasLinkExplorerEntry[],
    incoming: CanvasLinkExplorerEntry[]
  ): Promise<void> {
    const canvas = view?.canvas;
    if (!canvas || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is not editable; no link nodes were added.", "当前 Canvas 不可编辑，未添加链接节点。"));
      return;
    }

    const latest = readCanvasData(canvas);
    const resolvePath = (rawPath: string, linkSourcePath: string): string => {
      const resolved = this.p.app.metadataCache.getFirstLinkpathDest(rawPath, linkSourcePath);
      if (resolved?.path) return resolved.path;
      const direct = this.p.app.vault.getAbstractFileByPath(rawPath);
      return direct instanceof TFile ? direct.path : rawPath;
    };
    const normalizeEntry = (entry: CanvasLinkExplorerEntry): CanvasLinkExplorerEntry => {
      if (entry.external) return { ...entry, target: new URL(entry.target).toString() };
      const hashIndex = entry.target.indexOf("#");
      const rawPath = (hashIndex >= 0 ? entry.target.slice(0, hashIndex) : entry.target).trim();
      const subpath = hashIndex >= 0 ? entry.target.slice(hashIndex + 1).trim() : "";
      const resolvedPath = resolvePath(rawPath, entry.sourcePath);
      return { ...entry, target: resolvedPath + (subpath ? "#" + subpath : "") };
    };

    const existingKeys: string[] = [];
    for (const node of latest.nodes) {
      if (node.type === "link" && typeof node.url === "string") {
        const key = materializableLinkKey(node.url, true);
        if (key) existingKeys.push(key);
      } else if (node.type === "file" && typeof node.file === "string") {
        const path = resolvePath(node.file, sourcePath);
        const subpath = typeof (node).subpath === "string"
          ? String((node).subpath).replace(/^#/, "")
          : "";
        const key = materializableLinkKey(path + (subpath ? "#" + subpath : ""));
        if (key) existingKeys.push(key);
      }
    }

    const normalizedEntries: CanvasLinkExplorerEntry[] = [];
    for (const entry of [...outgoing, ...incoming]) {
      try {
        normalizedEntries.push(normalizeEntry(entry));
      } catch {
        // Ignore invalid external links instead of creating unsafe URL nodes.
      }
    }
    const unique = dedupeMaterializableCanvasLinks(normalizedEntries, existingKeys);
    if (!unique.length) {
      new Notice(t("No new links to add: the targets may already exist on the Canvas, or the links are invalid.", "没有新的链接可添加：目标可能已存在于画布中，或链接无效。"));
      return;
    }

    const limit = 100;
    const selectedId = canvas.selection?.size === 1
      ? canvas.selection.values().next().value?.id
      : undefined;
    const validNodeIds = new Set(latest.nodes.map((node: CanvasNodeData) => node.id));
    const minY = latest.nodes.length ? Math.min(...latest.nodes.map((node: CanvasNodeData) => node.y)) : 0;
    const maxX = latest.nodes.length
      ? Math.max(...latest.nodes.map((node: CanvasNodeData) => node.x + node.width))
      : 0;
    const startX = maxX + 100;
    const newNodes: CanvasNodeData[] = [];
    const newEdges: CanvasEdgeData[] = [];
    const planned = unique.slice(0, limit);

    for (let index = 0; index < planned.length; index++) {
      const entry = planned[index];
      const x = startX;
      const y = minY + index * 180;
      let node: CanvasNodeData;
      if (entry.external) {
        const url = new URL(entry.target);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        node = {
          id: createId(),
          type: "link",
          url: url.toString(),
          x, y,
          width: 300,
          height: 100
        };
      } else {
        const hashIndex = entry.target.indexOf("#");
        const rawPath = hashIndex >= 0 ? entry.target.slice(0, hashIndex) : entry.target;
        const subpath = hashIndex >= 0 ? entry.target.slice(hashIndex + 1).trim() : "";
        const resolvedPath = resolvePath(rawPath, sourcePath);
        const destination = this.p.app.vault.getAbstractFileByPath(resolvedPath);
        if (destination instanceof TFile) {
          node = {
            id: createId(),
            type: "file",
            file: destination.path,
            ...(subpath ? { subpath } : {}),
            x, y,
            width: 300,
            height: 160
          };
        } else {
          const body = entry.title + "\n\n[[" + entry.target + "]]" +
            (entry.detail ? "\n\n" + t("Source: ", "来源：") + entry.detail : "");
          node = makeTextNode(body, x, y, {
            width: 320,
            height: Math.max(140, Math.min(320, Math.ceil(body.length / 36) * 24))
          });
        }
      }
      newNodes.push(node);

      const sourceNodeId = entry.sourceNodeId ??
        (!entry.external && selectedId && !validNodeIds.has(node.id) ? selectedId : undefined);
      if (sourceNodeId && validNodeIds.has(sourceNodeId)) {
        newEdges.push({
          id: createId(),
          fromNode: sourceNodeId,
          fromSide: "right",
          toNode: node.id,
          toSide: "left"
        });
      }
    }

    if (!newNodes.length) {
      new Notice(t("No link nodes could be created.", "没有可创建的链接节点。"));
      return;
    }
    canvas.importData({
      ...latest,
      nodes: [...latest.nodes, ...newNodes],
      edges: [...latest.edges, ...newEdges]
    });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    new Notice(
      t("Added " + newNodes.length + " link nodes", "已添加 " + newNodes.length + " 个链接节点") +
      (unique.length > newNodes.length
        ? t("; " + (unique.length - newNodes.length) + " more links were skipped as invalid or over the per-run limit.", "；另外 " + (unique.length - newNodes.length) + " 个链接因无效或单次上限未添加。")
        : t(".", "。"))
    );
  }

  private async openCanvasLinkExplorer(materializeLinks = false): Promise<void> {
    const view = this.activeCanvasView();
    const canvas = view?.canvas;
    const file = view?.file;
    if (!canvas || !(file instanceof TFile)) {
      new Notice(t("Open a saved Canvas file first.", "请先打开一个已保存的 Canvas 文件。"));
      return;
    }

    if (materializeLinks && canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; link nodes cannot be added.", "当前 Canvas 处于只读模式，不能添加链接节点。"));
      return;
    }

    const sourcePath = file.path;
    const data = readCanvasData(canvas);
    const outgoing: CanvasLinkExplorerEntry[] = [];
    const outgoingKeys = new Set<string>();
    const addOutgoing = (entry: CanvasLinkExplorerEntry) => {
      const key = [entry.external ? "url" : "internal", entry.target, entry.title].join("|");
      if (outgoingKeys.has(key)) return;
      outgoingKeys.add(key);
      outgoing.push(entry);
    };

    for (const node of data.nodes) {
      if (typeof node.text === "string") {
        const label = node.text.split("\n")[0].trim().slice(0, 70) || (t("Node ", "节点 ") + node.id);
        for (const reference of extractWikiLinks(node.text)) {
          addOutgoing({
            title: t("Text node: ", "文本节点：") + label,
            detail: reference.original,
            target: reference.targetPath + (reference.subpath ? "#" + reference.subpath : ""),
            sourcePath,
            sourceNodeId: node.id
          });
        }
      }
      if (node.type === "file" && typeof node.file === "string" && node.file.trim()) {
        const subpath = typeof (node).subpath === "string" ? String((node).subpath) : "";
        addOutgoing({
          title: t("File node: ", "文件节点：") + (node.file.split("/").pop() || node.file),
          detail: node.file + (subpath ? "#" + subpath : ""),
          target: node.file + (subpath ? "#" + subpath : ""),
          sourcePath,
          sourceNodeId: node.id
        });
      }
      if (node.type === "link" && typeof node.url === "string") {
        try {
          const url = new URL(node.url);
          if (url.protocol !== "http:" && url.protocol !== "https:") continue;
          addOutgoing({
            title: t("Web node", "网页节点"),
            detail: node.url,
            target: url.toString(),
            sourcePath,
            external: true,
            sourceNodeId: node.id
          });
        } catch {
          // Ignore malformed URL nodes in the navigation list.
        }
      }
    }

    const loading = new Notice(t("Scanning the vault for backlinks…", "正在扫描当前 Vault 的反向链接…"), 0);
    const incoming: CanvasLinkExplorerEntry[] = [];
    const incomingKeys = new Set<string>();
    const addIncoming = (entry: CanvasLinkExplorerEntry, key: string) => {
      if (incomingKeys.has(key)) return;
      incomingKeys.add(key);
      incoming.push(entry);
    };
    const resolvesToCurrentCanvas = (rawTarget: string, linkSourcePath: string): boolean => {
      try {
        const resolved = this.p.app.metadataCache.getFirstLinkpathDest(rawTarget, linkSourcePath);
        return resolved?.path === sourcePath;
      } catch {
        return false;
      }
    };

    try {
      const files = this.p.app.vault.getFiles().filter((candidate: TFile) =>
        candidate.path !== sourcePath &&
        (candidate.extension.toLowerCase() === "md" || candidate.extension.toLowerCase() === "canvas")
      );

      for (const candidate of files) {
        try {
          if (candidate.extension.toLowerCase() === "md") {
            const cache = this.p.app.metadataCache.getFileCache(candidate);
            const markdownLinks = cache
              ? [...(cache.links ?? []), ...(cache.embeds ?? [])]
                  .map((link) => String(link?.link ?? ""))
                  .filter(Boolean)
              : extractWikiLinks(await this.p.app.vault.cachedRead(candidate)).map(reference =>
                  reference.targetPath + (reference.subpath ? "#" + reference.subpath : "")
                );

            for (const cachedLink of markdownLinks) {
              for (const reference of extractWikiLinks("[[" + cachedLink + "]]")) {
                if (!resolvesToCurrentCanvas(reference.targetPath, candidate.path)) continue;
                addIncoming({
                  title: candidate.basename,
                  detail: reference.original + (reference.alias ? " · " + reference.alias : ""),
                  target: candidate.path,
                  sourcePath
                }, candidate.path + "|md|" + reference.original);
              }
            }
          } else {
            const raw = await this.p.app.vault.cachedRead(candidate);
            const json = parseUnknownJson(raw);
            const nodes = isJsonObject(json) && Array.isArray(json.nodes) ? json.nodes.filter(isCanvasNodeData) : [];
            for (const node of nodes) {
              if (typeof node.text === "string") {
                for (const reference of extractWikiLinks(node.text)) {
                  if (!resolvesToCurrentCanvas(reference.targetPath, candidate.path)) continue;
                  addIncoming({
                    title: candidate.basename + " · " + t("Canvas node", "Canvas 节点"),
                    detail: (node.text.split("\n")[0].trim().slice(0, 70) || node.id) + " · " + reference.original,
                    target: candidate.path + "#" + node.id,
                    sourcePath
                  }, candidate.path + "|" + node.id + "|" + reference.original);
                }
              }
              if (node.type === "file" && typeof node.file === "string") {
                const destination = this.p.app.vault.getAbstractFileByPath(node.file)
                  ?? this.p.app.metadataCache.getFirstLinkpathDest(node.file, candidate.path);
                if (destination?.path === sourcePath) {
                  addIncoming({
                    title: candidate.basename + " · " + t("File node", "文件节点"),
                    detail: node.file,
                    target: candidate.path + "#" + node.id,
                    sourcePath
                  }, candidate.path + "|" + node.id + "|file|" + node.file);
                }
              }
            }
          }
        } catch (error) {
          console.warn("Better Canvas link explorer skipped a file:", candidate.path, error);
        }
      }
    } catch (error) {
      loading.hide();
      new Notice(t("Failed to scan backlinks: ", "扫描反向链接失败：") + (error instanceof Error ? error.message : String(error)), 8000);
      return;
    }

    loading.hide();
    if (materializeLinks) {
      await this.materializeCanvasLinks(view, sourcePath, outgoing, incoming.slice(0, 250));
      return;
    }
    new CanvasLinkExplorerModal(
      this.p.app,
      sourcePath,
      outgoing,
      incoming.slice(0, 250)
    ).open();
  }

  private cloneNodeInDirection(): void {
    const selection = this.selected();
    if (!selection) return;
    const { canvas, node } = selection;
    this.input(
      t("Clone node and extend in a direction", "克隆节点并向指定方向扩展"),
      t("Enter a direction: left / right / up / down", "输入方向：left / right / up / down"),
      value => {
        const normalized = value.trim().toLowerCase();
        const aliases: Record<string, CloneDirection> = {
          left: "left", right: "right", up: "up", down: "down",
          左: "left", 右: "right", 上: "up", 下: "down"
        };
        const direction = aliases[normalized];
        if (!direction) {
          new Notice(t("Invalid direction. Enter left, right, up, or down.", "方向无效。请输入 left、right、up、down 或对应中文方向。"));
          return;
        }
        if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
          new Notice(t("This Canvas is in read-only mode; nodes cannot be cloned.", "当前 Canvas 处于只读模式，不能克隆节点。"));
          return;
        }
        const latest = readCanvasData(canvas);
        const source = latest.nodes.find((item: CanvasNodeData) => item.id === node.id);
        if (!source) {
          new Notice(t("The original node no longer exists. Select again and retry.", "原节点已不存在，请重新选择后重试。"));
          return;
        }

        const horizontal = direction === "left" || direction === "right";
        const gap = Math.max(0, Number(horizontal ? this.settings().gapX : this.settings().gapY) || 0);
        const cloned = cloneCanvasNodeInDirection(source, direction, gap, createId());
        const edge = createNodeExpansionEdge(source.id, cloned.id, createId(), direction);
        canvas.importData({
          ...latest,
          nodes: [...latest.nodes, cloned],
          edges: [...latest.edges, edge]
        });
        canvas.requestSave?.();
        canvas.requestFrame?.();
        this.selectNode(canvas, cloned.id);
        new Notice(t("Cloned the node to the " + ({ left: "left", right: "right", up: "up", down: "down" }[direction]) + " and linked it with a connection.", "已向" + ({ left: "左", right: "右", up: "上", down: "下" }[direction]) + "克隆节点并创建关联边。"));
      },
      "right"
    );
  }

  private async copyNodeLink(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    const file = this.activeCanvasView()?.file;
    if (!(file instanceof TFile)) return;
    const link = "[[" + file.path + "#" + selection.node.id + "]]";
    try {
      await navigator.clipboard.writeText(link);
      new Notice(t("Copied the node Wikilink.", "已复制节点 Wikilink。"));
    } catch {
      this.input(t("Node Wikilink", "节点 Wikilink"), t("Copy it manually", "请手动复制"), () => {}, link);
    }
  }

  private async export(format: "canvas" | "png" | "svg"): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    const view = this.activeCanvasView();
    const baseName = String(view?.file?.basename ?? "canvas").replace(/[ :*?"<>|]/g, "-").replaceAll("/", "-").replaceAll(String.fromCharCode(92), "-");
    const folder = String(this.settings().attachmentFolder || "Better Canvas Exports").replace(/^\/+|\/+$/g, "");
    await this.ensureFolder(folder);
    if (format === "canvas") {
      const filePath = await this.uniquePath(joinVaultPath(folder, baseName + "-export"), "canvas");
      const liveData = readCanvasData(canvas);
      let exportData = liveData;
      const sourceFile = view?.file;
      if (sourceFile instanceof TFile && sourceFile.extension === "canvas") {
        try {
          const source = parseUnknownJson(await this.p.app.vault.read(sourceFile));
          if (!isCanvasData(source)) {
            throw new Error(t("The original Canvas file is missing nodes or edges.", "原 Canvas 文件缺少 nodes 或 edges。"));
          }
          exportData = mergeCanvasExportData(liveData, source);
        } catch (error) {
          new Notice(t("Could not read all fields from the original Canvas; the export will contain only the current Canvas data.", "无法读取原 Canvas 的完整字段；导出将仅包含当前画布数据。"), 8000);
          console.warn("Better Canvas could not preserve all source JSON fields during export:", error);
        }
      }
      await this.p.app.vault.create(filePath, JSON.stringify(exportData, null, 2));
      new Notice(t("Exported " + filePath, "已导出 " + filePath));
      return;
    }
    const container = canvas.wrapperEl;
    if (!(container instanceof HTMLElement)) { new Notice(t("Could not access the Canvas DOM.", "无法获取 Canvas DOM。")); return; }
    const notice = new Notice(t("Exporting " + format.toUpperCase() + "…", "正在导出 " + format.toUpperCase() + "…"), 0);
    let softExportClone: HTMLElement | undefined;
    let exportHost: HTMLElement | undefined;
    try {
      const settings = this.settings();
      const pixelRatio = Math.max(1, Math.min(4, Number(settings.exportPixelRatio) || 2));
      const requestedBackground = String(settings.exportBackgroundColor ?? "").trim();
      let backgroundColor: string | undefined;
      if (requestedBackground) {
        const probe = this.p.app.workspace.containerEl.ownerDocument.win.createSpan();
        probe.style.backgroundColor = requestedBackground;
        if (!probe.style.backgroundColor) {
          throw new Error(t("Invalid export background color; leave it empty for a transparent background, or enter a valid CSS color.", "导出背景色无效；请留空使用透明背景，或输入有效 CSS 颜色。"));
        }
        backgroundColor = probe.style.backgroundColor;
      }
      const exportOptions: Parameters<typeof toPng>[1] = {
        cacheBust: true,
        pixelRatio,
        ...viewportExportAppearance(backgroundColor)
      };
      const isSoft = container.dataset.bcTheme === "soft-notes";
      if (isSoft) {
        softExportClone = prepareViewportSvgExportClone(container);
        const rect = container.getBoundingClientRect();
        // Keep the offscreen offset on an ancestor so computed logical insets
        // cannot carry it into html-to-image's serialized root.
        exportHost = container.ownerDocument.win.createDiv();
        exportHost.classList.add("bc-export-host");
        exportHost.setAttribute("aria-hidden", "true");
        softExportClone.classList.add("bc-soft-export-clone");
        softExportClone.setCssStyles({ width: rect.width + "px", height: rect.height + "px" });
        exportHost.appendChild(softExportClone);
        container.ownerDocument.body.appendChild(exportHost);
        exportOptions.fontEmbedCSS = SKETCH_FONT_CSS + SOFT_NOTES_FONT_CSS;
        exportOptions.width = rect.width;
        exportOptions.height = rect.height;
      }
      const svgContainer = softExportClone ?? (format === "svg" ? prepareViewportSvgExportClone(container) : container);
      const dataUrl = format === "png"
        ? await toPng(softExportClone ?? container, exportOptions)
        : await toSvg(svgContainer, { ...exportOptions, filter: shouldIncludeViewportSvgNode });
      const filePath = await this.uniquePath(joinVaultPath(folder, baseName + "-export"), format);
      const comma = dataUrl.indexOf(",");
      if (comma < 0) throw new Error(t("The exported image data URL is malformed.", "导出图像的数据 URL 格式无效。"));
      const metadata = dataUrl.slice(0, comma);
      const payload = dataUrl.slice(comma + 1);
      if (format === "svg") {
        let svgText: string;
        if (metadata.includes(";base64")) {
          const binary = atob(payload);
          const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          svgText = new TextDecoder().decode(bytes);
        } else {
          svgText = decodeURIComponent(payload);
        }
        svgText = scaleSvgIntrinsicDimensions(svgText, pixelRatio);
        await this.p.app.vault.create(filePath, svgText);
      } else {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        await this.p.app.vault.createBinary(filePath, bytes.buffer);
      }
      notice.hide();
      new Notice(t("Exported " + filePath, "已导出 " + filePath));
    } catch (error) {
      notice.hide();
      new Notice(t("Export failed: ", "导出失败：") + (error instanceof Error ? error.message : String(error)), 8000);
    } finally {
      exportHost?.remove();
    }
  }

  private async exportFullContent(format: "png" | "svg", selectionOnly = false): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开 Canvas。"));
      return;
    }
    const view = this.activeCanvasView();
    const baseName = String(view?.file?.basename ?? "canvas").replace(/[ :*?"<>|]/g, "-").replaceAll("/", "-").replaceAll(String.fromCharCode(92), "-");
    const folder = String(this.settings().attachmentFolder || "Better Canvas Exports").split("/").filter(Boolean).join("/");
    const notice = new Notice(selectionOnly ? t("Rendering by the bounds of the selected nodes…", "正在按选区节点边界渲染…") : t("Rendering the entire Canvas by all node bounds…", "正在按所有节点边界渲染整张 Canvas…"), 0);
    let objectUrl = "";
    try {
      await this.ensureFolder(folder);
      const settings = this.settings();
      const ratio = Math.max(1, Math.min(4, Number(settings.exportPixelRatio) || 2));
      let backgroundColor: string | undefined;
      const requestedBackground = String(settings.exportBackgroundColor ?? "").trim();
      if (requestedBackground) {
        const probe = this.p.app.workspace.containerEl.ownerDocument.win.createSpan();
        probe.style.backgroundColor = requestedBackground;
        if (!probe.style.backgroundColor) {
          throw new Error(t("Invalid export background color; leave it empty for a transparent background, or enter a valid CSS color.", "导出背景色无效；请留空使用透明背景，或输入有效 CSS 颜色。"));
        }
        backgroundColor = probe.style.backgroundColor;
      }

      const sourceData = readCanvasData(canvas);
      const selectedIds = selectionOnly
        ? Array.from(canvas.selection ?? []).map((item) => String(item?.id ?? "")).filter(Boolean)
        : null;
      if (selectionOnly && (!selectedIds || selectedIds.length === 0)) {
        throw new Error(t("Select one or more nodes before exporting the selection.", "请先选择一个或多个节点，再执行选区导出。"));
      }
      const exportSource = selectionOnly
        ? canvasDataForSelection(sourceData, selectedIds ?? [])
        : sourceData;
      if (selectionOnly && exportSource.nodes.length === 0) {
        throw new Error(t("No selected nodes were found to export.", "未找到可导出的选中节点。"));
      }
      const exportData = {
        ...exportSource,
        nodes: exportSource.nodes.map((node: CanvasNodeData) => ({ ...node })),
        edges: exportSource.edges.map((edge: CanvasEdgeData) => ({ ...edge }))
      };
      const mimeByExtension: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif"
      };
      const perImageLimit = 3 * 1024 * 1024;
      const totalImageLimit = 8 * 1024 * 1024;
      const mediaBudget = { perItemLimit: perImageLimit, totalLimit: totalImageLimit, maxItems: 20 };
      let embeddedImageBytes = 0;
      let embeddedImageCount = 0;
      let embeddedPdfPreviewCount = 0;
      let skippedImageCount = 0;

      for (const node of exportData.nodes) {
        if (node.type !== "file" || typeof node.file !== "string") continue;
        const extension = node.file.split(".").pop()?.toLowerCase() ?? "";
        const isPdf = extension === "pdf";
        const mime = mimeByExtension[extension];
        if (!mime && !isPdf) continue;

        const file = this.p.app.vault.getAbstractFileByPath(node.file);
        if (!(file instanceof TFile)) {
          skippedImageCount++;
          continue;
        }

        if (isPdf) {
          if (embeddedImageCount >= mediaBudget.maxItems || embeddedImageBytes >= totalImageLimit) {
            skippedImageCount++;
            continue;
          }
          try {
            // Pinned PDF nodes use their saved page subpath; an ordinary PDF
            // file node gets a first-page preview. The source PDF is never modified.
            const pages = await extractPdfPages(
              this.p.app,
              file,
              typeof (node).subpath === "string" ? String((node).subpath) : undefined,
              1,
              true
            );
            const preview = pages.find(page => typeof page.imageDataUrl === "string")?.imageDataUrl;
            if (!preview) {
              skippedImageCount++;
              continue;
            }
            const previewBytes = estimateDataUrlByteLength(preview);
            if (!canEmbedExportMedia(previewBytes, embeddedImageBytes, embeddedImageCount, mediaBudget)) {
              skippedImageCount++;
              continue;
            }
            (node).bcExportImageDataUrl = preview;
            embeddedImageBytes += previewBytes;
            embeddedImageCount++;
            embeddedPdfPreviewCount++;
          } catch {
            skippedImageCount++;
          }
          continue;
        }

        if (!canEmbedExportMedia(file.stat.size, embeddedImageBytes, embeddedImageCount, mediaBudget)) {
          skippedImageCount++;
          continue;
        }
        try {
          const buffer = await this.p.app.vault.readBinary(file);
          if (!canEmbedExportMedia(buffer.byteLength, embeddedImageBytes, embeddedImageCount, mediaBudget)) {
            skippedImageCount++;
            continue;
          }
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
          }
          (node).bcExportImageDataUrl = "data:" + mime + ";base64," + btoa(binary);
          embeddedImageBytes += buffer.byteLength;
          embeddedImageCount++;
        } catch {
          skippedImageCount++;
        }
      }

      const full = canvasDataToFullSvg(exportData, { backgroundColor, margin: 48 });
      const filePath = await this.uniquePath(joinVaultPath(folder, baseName + (selectionOnly ? "-selection" : "-full-content")), format);
      if (format === "svg") {
        await this.p.app.vault.create(filePath, full.svg);
      } else {
        const pixelWidth = Math.ceil(full.width * ratio);
        const pixelHeight = Math.ceil(full.height * ratio);
        if (pixelWidth > 20_000 || pixelHeight > 20_000 || pixelWidth * pixelHeight > 40_000_000) {
          throw new Error(t("The exported bitmap resolution is too large. Lower the PNG/SVG export scale in settings, or split the Canvas.", "导出的位图分辨率过大。请降低设置中的 PNG/SVG 导出倍率，或拆分 Canvas。"));
        }

        const blob = new Blob([full.svg], { type: "image/svg+xml;charset=utf-8" });
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(t("Could not render the full Canvas SVG as PNG.", "无法将整张 Canvas SVG 渲染为 PNG。")));
          image.src = objectUrl;
        });
        const output = this.p.app.workspace.containerEl.ownerDocument.win.createEl("canvas");
        output.width = pixelWidth;
        output.height = pixelHeight;
        const context = output.getContext("2d", { alpha: !backgroundColor });
        if (!context) throw new Error(t("The browser could not create a PNG rendering context.", "浏览器无法创建 PNG 渲染上下文。"));
        if (backgroundColor) {
          context.fillStyle = backgroundColor;
          context.fillRect(0, 0, output.width, output.height);
        }
        context.drawImage(image, 0, 0, output.width, output.height);
        const png = await new Promise<Blob>((resolve, reject) => {
          output.toBlob(blobResult => {
            if (blobResult) resolve(blobResult);
            else reject(new Error(t("PNG encoding failed.", "PNG 编码失败。")));
          }, "image/png");
        });
        const bytes = await png.arrayBuffer();
        await this.p.app.vault.createBinary(filePath, bytes);
        output.width = 0;
        output.height = 0;
      }
      notice.hide();
      const mediaSummary = embeddedImageCount
        ? t("; embedded media previews: " + embeddedImageCount, "；已嵌入 " + embeddedImageCount + " 项媒体预览") +
          (embeddedPdfPreviewCount ? t(" (PDF pages: " + embeddedPdfPreviewCount + ")", "（其中 PDF 页面 " + embeddedPdfPreviewCount + " 个）") : "")
        : "";
      const skippedSummary = skippedImageCount
        ? t("; " + skippedImageCount + " image or PDF page previews were replaced by labels due to size, format, or read errors", "；有 " + skippedImageCount + " 项图片或 PDF 页面预览因大小、格式或读取问题以标签代替")
        : "";
      new Notice((selectionOnly ? t("Exported Canvas selection: ", "已导出 Canvas 选区：") : t("Exported full Canvas: ", "已导出整张 Canvas：")) + filePath + mediaSummary + skippedSummary);
    } catch (error) {
      notice.hide();
      new Notice((selectionOnly ? t("Selection export failed: ", "选区导出失败：") : t("Full-content export failed: ", "全内容导出失败：")) + (error instanceof Error ? error.message : String(error)), 8000);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  private async uniquePath(base: string, extension: string): Promise<string> {
    let path = base + "." + extension;
    let suffix = 2;
    while (this.p.app.vault.getAbstractFileByPath(path)) path = base + " " + suffix++ + "." + extension;
    return path;
  }

  private async ensureFolder(path: string): Promise<void> {
    const clean = path.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) throw new Error(t("The output folder cannot be empty.", "输出目录不能为空。"));
    let current = "";
    for (const part of clean.split("/")) {
      current = current ? current + "/" + part : part;
      if (!this.p.app.vault.getAbstractFileByPath(current)) await this.p.app.vault.createFolder(current);
    }
  }

  private async saveMcpResult(
    toolName: string,
    result: RemoteMcpResult,
    canvas: CanvasRuntime,
    source?: CanvasNodeData
  ): Promise<void> {
    if (!canvas) throw new Error(t("The MCP tool returned a result, but no Canvas is open.", "MCP 工具已返回结果，但当前没有打开的 Canvas。"));
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      throw new Error(t("This Canvas is in read-only mode; the MCP result was not written. Turn off read-only mode and retry.", "当前 Canvas 处于只读模式，MCP 结果尚未写入。请解除只读后重试。"));
    }
    const latest = readCanvasData(canvas);
    // If the source node was removed while the remote request was running,
    // create a standalone result rather than writing an edge to a missing ID.
    const parent = source
      ? latest.nodes.find((node: CanvasNodeData) => node.id === source.id)
      : undefined;
    const images = Array.isArray(result.images) ? result.images : [];
    const text = String(result.text ?? "").trim();
    const body = "# MCP: " + toolName + "\n\n" +
      (text || (images.length ? t("The tool returned " + images.length + " images.", "工具返回了 " + images.length + " 张图片。") : t("The tool ran but returned no text content.", "工具已执行，但没有返回文本内容。")));
    const output = makeTextNode(
      body.slice(0, 12000),
      parent ? parent.x + parent.width + 100 : 0,
      parent ? parent.y : 0,
      { width: 440, height: Math.max(200, Math.min(440, Math.ceil(body.length / 42) * 24)) }
    );
    insertCanvasNode(canvas, output, parent?.id);

    if (!images.length) return;
    const attachmentFolder = String(this.settings().attachmentFolder || "Better Canvas MCP Results");
    await this.ensureFolder(attachmentFolder);
    const imageYStart = output.y + output.height + 36;
    let savedImages = 0;
    const skipped: string[] = [];

    for (const [index, image] of images.entries()) {
      let mime = String(image.mimeType || "").toLowerCase().split(";")[0].trim();
      let encoded = String(image.data || "").trim();
      const dataUrl = encoded.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      if (dataUrl) {
        mime = dataUrl[1].toLowerCase();
        encoded = dataUrl[2];
      }
      const extByMime: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif"
      };
      const extension = extByMime[mime];
      if (!extension) {
        skipped.push(t("Unsupported MIME type for image " + (index + 1) + ": " + (mime || "unknown"), "第 " + (index + 1) + " 张图片的 MIME 类型不受支持：" + (mime || "unknown")));
        continue;
      }
      if (!encoded || encoded.length > 28_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
        skipped.push(t("Image " + (index + 1) + " is empty, malformed, or too large.", "第 " + (index + 1) + " 张图片数据为空、格式无效或过大。"));
        continue;
      }

      try {
        const binary = atob(encoded.replace(/\s/g, ""));
        const buffer = new ArrayBuffer(binary.length);
        const bytes = new Uint8Array(buffer);
        for (let offset = 0; offset < binary.length; offset++) bytes[offset] = binary.charCodeAt(offset);
        const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32) || "tool";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = await this.uniquePath(
          attachmentFolder + "/mcp-" + safeToolName + "-" + stamp + "-" + (index + 1),
          extension
        );
        await this.p.app.vault.createBinary(path, buffer);
        const imageNode: CanvasNodeData = {
          id: createId(),
          type: "file",
          file: path,
          x: output.x + output.width + 54,
          y: imageYStart + savedImages * 260,
          width: 300,
          height: 230
        };
        insertCanvasNode(canvas, imageNode, output.id);
        savedImages += 1;
      } catch (error) {
        skipped.push(t("Failed to save image " + (index + 1) + ": " + (error instanceof Error ? error.message : String(error)), "第 " + (index + 1) + " 张图片保存失败：" + (error instanceof Error ? error.message : String(error))));
      }
    }

    if (savedImages) new Notice(t("Saved MCP image results as " + savedImages + " linked Canvas nodes.", "MCP 图片结果已保存为 " + savedImages + " 个关联画布节点。"));
    if (skipped.length) new Notice(skipped.join("\n"), 8000);
  }

  private askGeminiAboutYoutube(): void {
    const selected = this.selected();
    if (!selected) return;
    const provider = this.currentProvider(selected.node);
    if (provider.protocol !== "gemini") {
      new Notice(t("This feature requires switching the current AI provider to a Gemini profile with protocol=gemini.", "该功能需要将当前 AI 供应商切换为 protocol=gemini 的 Gemini profile。"));
      return;
    }

    this.input(t("Gemini native video context", "Gemini 原生视频上下文"), t("YouTube URL of a public video", "公开视频的 YouTube URL"), rawUrl => {
      let url: URL;
      try {
        url = new URL(rawUrl.trim());
      } catch {
        new Notice(t("Invalid URL format.", "URL 格式无效。"));
        return;
      }
      const hostname = url.hostname.toLowerCase();
      const allowedHost = hostname === "youtu.be" || hostname === "youtube.com" ||
        hostname.endsWith(".youtube.com");
      if ((url.protocol !== "https:" && url.protocol !== "http:") || !allowedHost) {
        new Notice(t("Only public video links from youtube.com or youtu.be are accepted here.", "这里只接受 youtube.com 或 youtu.be 的公开视频链接。"));
        return;
      }
      if (url.hostname === "youtu.be" && !url.pathname.replace(/^\/+/, "")) {
        new Notice(t("No video ID found in the URL.", "URL 中未发现视频 ID。"));
        return;
      }
      this.input(t("Analyze YouTube video", "分析 YouTube 视频"), t("e.g. summarize the main points and list key timestamps and claims to verify", "例如：总结主要论点，列出关键时间戳和待验证结论"), question => {
        const task = question +
          t("\n\nAnalyze the attached public video directly. Prioritize timestamps for key events; if the video cannot be read, say so explicitly instead of pretending to have watched it.", "\n\n请直接分析附带的公开视频内容。优先给出关键事件的时间戳；如果无法读取视频，请明确说明，不要假装已经看过。");
        void this.runAI(selected.node.id, task, undefined, undefined, url.toString());
      }, t("Summarize the video content, key points, and timestamps", "总结视频内容、关键观点与时间戳"));
    });
  }

  private editCanvasFrontmatter(): void {
    const view = this.activeCanvasView();
    const file = view?.file;
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") {
      new Notice(t("Open a saved .canvas file first.", "请先打开一个已保存的 .canvas 文件。"));
      return;
    }

    this.input(t("Edit Canvas frontmatter", "编辑 Canvas frontmatter"), t("Property name, e.g. project / status / tags", "属性名，例如 project / status / tags"), keyInput => {
      const key = keyInput.trim();
      if (!key || ["__proto__", "prototype", "constructor"].includes(key)) {
        new Notice(t("Invalid property name.", "属性名无效。"));
        return;
      }
      void (async () => {
        try {
          const raw = await this.p.app.vault.cachedRead(file);
          const parsed = parseJsonRecord(raw);
          const existingMetadata = isJsonObject(parsed.metadata) ? parsed.metadata : {};
          const currentFrontmatter = isJsonObject(existingMetadata.frontmatter) ? existingMetadata.frontmatter : {};
          const currentValue = Object.prototype.hasOwnProperty.call(currentFrontmatter, key)
            ? JSON.stringify(currentFrontmatter[key], null, 2) : "";
          this.input(
            t("Set property value: ", "设置属性值：") + key,
            t("Enter a JSON value; enter __DELETE__ to remove this property", "输入 JSON 值；输入 __DELETE__ 可删除此属性"),
            valueInput => {
              void (async () => {
                try {
                  const latestRaw = await this.p.app.vault.cachedRead(file);
                  const latest = parseJsonRecord(latestRaw);
                  const latestMetadata = isJsonObject(latest.metadata) ? latest.metadata : {};
                  const frontmatter: Record<string, unknown> = { ...(isJsonObject(latestMetadata.frontmatter) ? latestMetadata.frontmatter : {}) };
                  if (valueInput.trim() === "__DELETE__") {
                    delete frontmatter[key];
                  } else {
                    try {
                      frontmatter[key] = parseUnknownJson(valueInput);
                    } catch {
                      frontmatter[key] = valueInput;
                    }
                  }
                  const metadata = {
                    ...latestMetadata,
                    version: latestMetadata.version ?? "1.0-1.0",
                    frontmatter
                  };
                  latest.metadata = metadata;
                  await this.p.app.vault.modify(file, JSON.stringify(latest, null, 2));
                  if (view?.canvas) view.canvas.metadata = metadata;
                  this.metadataIndexer?.refreshAll();
                  new Notice(valueInput.trim() === "__DELETE__"
                    ? t("Deleted Canvas property: ", "已删除 Canvas 属性：") + key
                    : t("Updated Canvas property: ", "已更新 Canvas 属性：") + key);
                } catch (error) {
                  new Notice(t("Failed to save Canvas property: ", "保存 Canvas 属性失败：") + (error instanceof Error ? error.message : String(error)), 8000);
                }
              })();
            },
            currentValue
          );
        } catch (error) {
          new Notice(t("Failed to read Canvas metadata: ", "读取 Canvas 元数据失败：") + (error instanceof Error ? error.message : String(error)), 8000);
        }
      })();
    });
  }

  private editCanvasFrontmatterJson(): void {
    const view = this.activeCanvasView();
    const file = view?.file;
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") {
      new Notice(t("Open a saved .canvas file first.", "请先打开一个已保存的 .canvas 文件。"));
      return;
    }

    void (async () => {
      try {
        const raw = await this.p.app.vault.cachedRead(file);
        const snapshot = readCanvasFrontmatter(raw);
        this.input(
          t("Bulk edit Canvas frontmatter (JSON)", "批量编辑 Canvas frontmatter（JSON）"),
          t("Edit the full JSON object; enter {} to clear properties, Ctrl/Cmd+Enter to save.", "编辑完整 JSON 对象；输入 {} 可清空属性，Ctrl/Cmd+Enter 保存。"),
          valueInput => {
            void (async () => {
              try {
                // Re-read at save time so edits made while the modal was open are retained.
                const latestRaw = await this.p.app.vault.cachedRead(file);
                const result = replaceCanvasFrontmatter(latestRaw, valueInput);
                await this.p.app.vault.modify(file, result.serialized);
                if (view?.canvas) view.canvas.metadata = result.metadata;
                this.metadataIndexer?.refreshAll();
                new Notice(t("Saved Canvas frontmatter (" + Object.keys(result.frontmatter).length + " properties).", "已保存 Canvas frontmatter（" + Object.keys(result.frontmatter).length + " 个属性）。"));
              } catch (error) {
                new Notice(t("Failed to save Canvas frontmatter: ", "保存 Canvas frontmatter 失败：") + (error instanceof Error ? error.message : String(error)), 8000);
              }
            })();
          },
          JSON.stringify(snapshot.frontmatter, null, 2),
          false,
          promptValidator(value => replaceCanvasFrontmatter(raw, value))
        );
      } catch (error) {
        new Notice(t("Failed to read Canvas frontmatter: ", "读取 Canvas frontmatter 失败：") + (error instanceof Error ? error.message : String(error)), 8000);
      }
    })();
  }

  private async ingestWebpage(raw: string): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开 Canvas。"));
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode before importing content.", "当前 Canvas 处于只读模式。请先解除只读模式再导入内容。"));
      return;
    }
    const selection = this.selected(canvas);
    const notice = new Notice(t("Reading the source content…", "正在读取来源内容…"), 0);
    try {
      const page = await retrieveWebpage(raw);
      const body = "# " + page.title + "\n\nSource: " + page.url + "\n\n" + page.text;
      const node = makeTextNode(body,
        selection ? selection.node.x + selection.node.width + 100 : 0,
        selection ? selection.node.y : 0,
        { width: 420, height: Math.max(220, Math.min(720, Math.ceil(body.length / 55) * 22)) });
      insertCanvasNode(canvas, node, selection?.node.id);
      notice.hide();
      new Notice(t("Imported the web page text.", "网页正文已导入。"));
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private setNodeProvider(): void {
    const selection = this.selected();
    if (!selection) return;
    const s = this.settings();
    const choices = s.providerProfiles.map(profile => profile.id + " — " + profile.name).join("\n");
    this.input(t("Set node AI provider", "设置节点 AI 供应商"), choices + t("\n\nEnter a profile id", "\n\n输入 profile id"), value => {
      const profile = s.providerProfiles.find(item => item.id === value.trim());
      if (!profile) return new Notice(t("No matching profile id.", "没有匹配的 profile id。"));
      patchNode(selection.canvas, selection.node.id, {
        bcAIProvider: profile.id,
        ...(isLocalAgentBackend(selection.node.bcAIProvider) ? { bcAIModel: undefined } : {})
      });
      new Notice(t("Node provider set to " + profile.name, "节点供应商已设置为 " + profile.name));
    }, typeof selection.node.bcAIProvider === "string" ? selection.node.bcAIProvider : s.activeProviderId);
  }

  private chooseModel(node: CanvasNodeData, onChoose: (model: string) => void): void {
    const current = this.apiNodeModel(node);
    const notice = new Notice(t("Reading the model list from the AI provider…", "正在从 AI 供应商读取模型列表…"), 0);
    void discoverModels(this.aiSettings(node)).then(models => {
      notice.hide();
      const available = models.includes(current) ? models : [current, ...models];
      new AIModelPickerModal(this.p.app, available, current, onChoose).open();
    }).catch(error => {
      notice.hide();
      new Notice(t("Could not read the provider's model list; you can type a model name in the next step.", "无法读取供应商模型列表；可在下一步手动输入模型名。"), 5000);
      this.input(t("Set node AI model", "设置节点 AI 模型"), t("Enter a model name; leave empty to restore the provider default", "输入模型名；留空恢复供应商默认模型"), onChoose, current);
      console.warn("Better Canvas model discovery failed", error);
    });
  }

  private setNodeModel(): void {
    const selection = this.selected();
    if (!selection) return;
    this.chooseModel(selection.node, model => {
      const value = model.trim();
      patchNode(selection.canvas, selection.node.id, {
        bcAIModel: value || undefined,
        ...(isLocalAgentBackend(selection.node.bcAIProvider) ? { bcAIProvider: this.currentProvider(selection.node).id } : {})
      });
      new Notice(value ? t("Node model set to " + value, "节点模型已设置为 " + value) : t("Restored the provider default model.", "已恢复供应商默认模型。"));
    });
  }

  private askWithModel(): void {
    const selection = this.aiSelection();
    if (!selection) return;
    this.chooseModel(selection.node, model => {
      this.openAIPrompt(selection, model);
    });
  }

  private askLocalCodex(): void {
    if (!Platform.isDesktopApp) {
      new Notice(t("The local Codex CLI is only supported in the Obsidian desktop app.", "本地 Codex CLI 仅支持 Obsidian 桌面版。"));
      return;
    }
    const selection = this.selected();
    if (!selection) return;
    this.input(
      t("Use local Codex CLI", "使用本地 Codex CLI"),
      t("Enter a question or analysis task. The prompt and selected node context are passed to your Codex CLI configuration.", "输入问题或分析任务。提示词与所选节点上下文会交给你的 Codex CLI 配置。"),
      instruction => void this.runLocalCodexForNode(selection.canvas, selection.node, instruction)
    );
  }

  private async runLocalCodexForNode(canvas: CanvasRuntime, originalNode: CanvasNodeData, instruction: string): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice(t("The local Codex CLI is only supported in the Obsidian desktop app.", "本地 Codex CLI 仅支持 Obsidian 桌面版。"));
      return;
    }

    const latest = readCanvasData(canvas).nodes.find(node => node.id === originalNode.id);
    if (!latest) {
      new Notice(t("Could not find the selected node.", "找不到所选节点。"));
      return;
    }
    const previous = this.activeGenerations.get(canvas);
    if (previous) previous.controller.abort();

    const controller = new AbortController();
    this.activeGenerations.set(canvas, { controller, nodeId: latest.id });
    const notice = new Notice(t("Preparing local Codex CLI context…", "正在准备本地 Codex CLI 上下文…"), 0);

    try {
      const context = await this.getNodeContext(canvas, latest.id);
      if (controller.signal.aborted) {
        const stopped = new Error("Local Codex generation was cancelled.");
        stopped.name = "AbortError";
        throw stopped;
      }
      const prompt = [
        t("Analyze the following Obsidian Canvas node context and complete the user's task.", "请分析以下 Obsidian Canvas 节点上下文，并完成用户的任务。"),
        t("You are running in the Codex CLI read-only sandbox. Do not modify, create, or delete files, and do not claim to have changed the vault.", "你运行在 Codex CLI 的 read-only sandbox 中。不要尝试修改、创建或删除文件，也不要声称已经修改 Vault。"),
        t("Use only the context provided below. Clearly separate facts, inferences, and uncertainties.", "只使用以下提供的上下文。明确区分事实、推论和不确定点。"),
        "",
        t("User task:", "用户任务："),
        instruction,
        "",
        t("Canvas context:", "Canvas 上下文："),
        context
      ].join("\n");

      const codexConfig = localAgentConfig(this.settings(), "codex-cli");
      const answer = await runLocalCodex(prompt, {
        binaryPath: codexConfig.binaryPath,
        model: codexConfig.model,
        signal: controller.signal,
        timeoutMs: 300_000,
        onProgress: message => notice.setMessage(message)
      });

      if (controller.signal.aborted) {
        const stopped = new Error("Local Codex generation was cancelled.");
        stopped.name = "AbortError";
        throw stopped;
      }

      const source = readCanvasData(canvas).nodes.find(node => node.id === latest.id) ?? latest;
      const responseNode = makeTextNode(
        answer,
        source.x + source.width + 100,
        source.y,
        {
          width: Math.max(300, source.width),
          height: Math.max(180, Math.min(500, Math.ceil(answer.length / 42) * 24))
        }
      );
      (responseNode).bcGenerated = true;
      (responseNode).bcSourceNode = source.id;
      (responseNode).bcPrompt = instruction;
      (responseNode).bcAIProvider = "codex-cli";
      (responseNode).bcAIModel = codexConfig.model || "configured-local-codex";
      (responseNode).bcLocalCLI = true;
      insertCanvasNode(canvas, responseNode, source.id);

      notice.hide();
      new Notice(t("Codex reply added as a connected node.", "Codex 回复已添加为关联节点。"));
    } catch (error) {
      notice.hide();
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        new Notice(t("Codex task stopped.", "Codex 任务已停止。"));
      } else {
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      }
    } finally {
      if (this.activeGenerations.get(canvas)?.controller === controller) {
        this.activeGenerations.delete(canvas);
      }
    }
  }

  private runPromptFolder(): void {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first to store the batch results.", "请先打开一个 Canvas，用于保存批量生成的结果。"));
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode first.", "当前 Canvas 处于只读模式，请先解除只读模式。"));
      return;
    }
    const folders = this.p.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder);
    if (!folders.length) {
      new Notice(t("No folders are available in this vault.", "当前 Vault 中没有可选文件夹。"));
      return;
    }

    const chooseFolder = (folder: TFolder): void => {
      const provider = this.currentProvider();
      this.input(
        t("Batch run folder prompt", "批量运行文件夹 Prompt"),
        t("Task instructions. Up to 20 Markdown files are processed; file contents are sent to the current provider “" + provider.name + "”.", "任务说明。最多处理 20 篇 Markdown；文件正文将发送给当前供应商“" + provider.name + "”。"),
        prompt => void this.processPromptFolder(folder, prompt)
      );
    };
    class FolderPicker extends SuggestModal<TFolder> {
      getSuggestions(query: string): TFolder[] {
        const needle = query.trim().toLocaleLowerCase();
        return folders.filter(folder => !needle ||
          folder.path.toLocaleLowerCase().includes(needle) ||
          folder.name.toLocaleLowerCase().includes(needle)).slice(0, 200);
      }
      renderSuggestion(folder: TFolder, element: HTMLElement): void {
        element.createDiv({ text: folder.name || "/" });
        element.createEl("small", { text: folder.path || "/" });
      }
      onChooseSuggestion(folder: TFolder): void {
        chooseFolder(folder);
      }
    }
    new FolderPicker(this.p.app).open();
  }

  private collectMarkdownFiles(folder: TFolder, output: TFile[], limit = 20): void {
    for (const child of folder.children) {
      if (output.length >= limit) return;
      if (child instanceof TFile && child.extension.toLowerCase() === "md") {
        output.push(child);
      } else if (child instanceof TFolder) {
        this.collectMarkdownFiles(child, output, limit);
      }
    }
  }

  private async processPromptFolder(folder: TFolder, instruction: string): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("No Canvas is available to write results into.", "当前没有可写入结果的 Canvas。"));
      return;
    }
    const files: TFile[] = [];
    this.collectMarkdownFiles(folder, files, 20);
    if (!files.length) {
      new Notice(t("The selected folder contains no Markdown files.", "所选文件夹中没有 Markdown 文件。"));
      return;
    }

    const before = readCanvasData(canvas);
    const selected = this.selected(canvas);
    const x = selected
      ? selected.node.x + selected.node.width + 100
      : Math.max(0, ...before.nodes.map((node: CanvasNodeData) => node.x + node.width)) + 100;
    const y = selected?.node.y ?? 0;
    const root = makeTextNode(
      t("Folder batch task\n", "文件夹批量任务\n") + folder.path + t("\n\nPrompt: ", "\n\nPrompt： ") + instruction,
      x, y, { width: 360, height: 180 }
    );
    (root).bcBatchFolder = folder.path;
    (root).bcBatchPrompt = instruction;
    insertCanvasNode(canvas, root, selected?.node.id);

    const profile = this.currentProvider();
    const settings = this.aiSettings();
    const notice = new Notice(t("Processing folder: " + folder.path + " (0 / " + files.length + ")", "正在处理文件夹：" + folder.path + "（0 / " + files.length + "）"), 0);
    let succeeded = 0;
    let failed = 0;

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const rowY = y + index * 260;
        const source: CanvasNodeData = {
          id: createId(),
          type: "file",
          file: file.path,
          x: x + 360 + 100,
          y: rowY,
          width: 300,
          height: 180
        };
        insertCanvasNode(canvas, source, root.id);

        let answer = "";
        let generationSucceeded = false;
        try {
          const note = (await this.p.app.vault.cachedRead(file)).slice(0, 12000);
          answer = await chatCompletion(settings, [
            {
              role: "system",
              content: String(this.settings().systemPrompt || "You are a precise assistant. Preserve uncertainty.")
            },
            {
              role: "user",
              content: t("Complete the user's task using the vault notes below. Use only the provided content; do not claim to have read other files or web pages.\n\nTask:\n", "根据下面的 Vault 笔记执行用户指定的任务。只使用所提供的内容，不要声称读取了其他文件或网页。\n\n任务：\n") +
                instruction + t("\n\nSource file: ", "\n\n源文件：") + file.path + t("\n\nNote body:\n", "\n\n笔记正文：\n") + note
            }
          ]);
          succeeded++;
          generationSucceeded = true;
        } catch (error) {
          failed++;
          answer = t("Processing failed: ", "处理失败： ") + (error instanceof Error ? error.message : String(error));
        }

        const result = makeTextNode(answer, source.x + source.width + 80, rowY, {
          width: 340,
          height: Math.max(160, Math.min(420, Math.ceil(answer.length / 44) * 24))
        });
        (result).bcGenerated = generationSucceeded;
        (result).bcPrompt = instruction;
        (result).bcSourceNode = source.id;
        (result).bcSourcePath = file.path;
        (result).bcAIProvider = isLocalAgentBackend(settings.backend) ? settings.backend : profile.id;
        (result).bcAIModel = settings.model;
        insertCanvasNode(canvas, result, source.id);

        notice.setMessage(t("Processing folder: " + folder.path + " (" + (index + 1) + " / " + files.length + ")", "正在处理文件夹：" + folder.path + "（" + (index + 1) + " / " + files.length + "）"));
      }
    } finally {
      notice.hide();
    }

    new Notice(t("Folder task complete: " + succeeded + " succeeded, " + failed + " failed. Up to 20 Markdown files were processed; content was sent to provider “" + profile.name + "”.", "文件夹任务完成：成功 " + succeeded + "，失败 " + failed +
      "。最多处理 20 篇 Markdown，内容已发送给供应商“" + profile.name + "”。"));
  }

  private aiContextNodes(canvas: CanvasRuntime, rootIds: string | readonly string[]): CanvasNodeData[] {
    const data = readCanvasData(canvas);
    const roots = new Set(typeof rootIds === "string" ? [rootIds] : rootIds);
    const records = new Map(data.nodes.map(node => [node.id, node]));
    if (!roots.size || [...roots].some(id => !records.has(id))) throw new Error(t("Could not find the selected node.", "找不到所选节点。"));
    const connected = new Set(roots);
    for (const edge of data.edges) {
      if (roots.has(edge.fromNode)) connected.add(edge.toNode);
      if (roots.has(edge.toNode)) connected.add(edge.fromNode);
    }
    return [...connected].flatMap(id => records.has(id) ? [records.get(id)!] : []);
  }

  private async getNodeContext(canvas: CanvasRuntime, rootIds: string | readonly string[]): Promise<string> {
    const roots = new Set(typeof rootIds === "string" ? [rootIds] : rootIds);
    const sections: string[] = [];
    for (const node of this.aiContextNodes(canvas, rootIds)) {
      let body = String(node.text ?? node.file ?? node.url ?? "[" + node.type + " node]");
      if (node.type === "file" && node.file) {
        const file = this.p.app.vault.getAbstractFileByPath(node.file);
        if (file instanceof TFile && file.extension.toLowerCase() === "md") {
          try { body = await this.p.app.vault.cachedRead(file); } catch { /* retain file path */ }
        } else if (file instanceof TFile && file.extension.toLowerCase() === "pdf") {
          try {
            const pages = await extractPdfPages(this.p.app, file, typeof node.subpath === "string" ? node.subpath : undefined, 3, false);
            body = "[PDF: " + file.path + "]\n" + pages.map(page =>
              "Page " + page.pageNumber + ":\n" + (page.text || t("(No extractable text on this page; try a vision-capable model to view the page image.)", "(此页没有可提取的文本；可尝试让支持视觉的模型查看页面图像。)"))
            ).join("\n\n");
          } catch (error) {
            body = "[PDF: " + file.path + "; page text extraction failed: " +
              (error instanceof Error ? error.message : String(error)) + "]";
          }
        }
      }
      sections.push("[Node " + node.id + (roots.has(node.id) ? " — selected" : "") + "]\n" + body.slice(0, 3000));
    }
    return sections.join("\n\n--- Connected node ---\n\n").slice(0, 14000);
  }

  private async getConnectedImages(canvas: CanvasRuntime, rootIds: string | readonly string[]): Promise<Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }>> {
    const images: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];
    for (const node of this.aiContextNodes(canvas, rootIds)) {
      if (node.type !== "file" || !node.file) continue;
      const file = this.p.app.vault.getAbstractFileByPath(node.file);
      if (!(file instanceof TFile)) continue;
      const ext = file.extension.toLowerCase();
      if (ext === "pdf") {
        try {
          const pages = await extractPdfPages(this.p.app, file, typeof node.subpath === "string" ? node.subpath : undefined, 1, true);
          for (const page of pages) {
            if (page.imageDataUrl) images.push({ type: "image_url", image_url: { url: page.imageDataUrl, detail: "auto" } });
            if (images.length >= 4) break;
          }
        } catch (error) {
          console.warn("Better Canvas could not prepare PDF page vision context:", file.path, error);
        }
        if (images.length >= 4) break;
        continue;
      }
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif"
        : ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "";
      if (!mime || file.stat.size > 4 * 1024 * 1024) continue;
      try {
        const buffer = await this.p.app.vault.readBinary(file);
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
        }
        images.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + btoa(binary), detail: "auto" } });
      } catch {
        // Skip unreadable images; textual context remains available.
      }
      if (images.length >= 4) break;
    }
    return images;
  }

  private parseJsonPayload(raw: string): Record<string, unknown> {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(t("AI did not return valid JSON.", "AI 没有返回有效 JSON。"));
    const parsed: unknown = parseUnknownJson(cleaned.slice(start, end + 1));
    if (!isJsonObject(parsed)) throw new Error(t("AI did not return a JSON object.", "AI 没有返回 JSON 对象。"));
    return parsed;
  }

  private async testProvider(): Promise<void> {
    const profile = this.currentProvider();
    const notice = new Notice(t("Testing " + profile.name + "…", "正在测试 " + profile.name + "…"), 0);
    try {
      const response = await chatCompletion({ ...this.aiSettings(), model: profile.model }, [
        { role: "system", content: "You are a connectivity test. Reply with exactly: OK" },
        { role: "user", content: "Reply with exactly OK." }
      ]);
      notice.hide();
      new Notice(t("Provider responded successfully: " + response.slice(0, 80), "供应商响应成功：" + response.slice(0, 80)));
    } catch (error) {
      notice.hide();
      new Notice(t("Provider test failed: ", "供应商测试失败：") + (error instanceof Error ? error.message : String(error)), 8000);
    }
  }

  private async generateTitleOrGroupName(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const notice = new Notice(t("Generating title suggestions…", "正在生成标题建议…"), 0);
    try {
      const data = readCanvasData(selected.canvas);
      const node = selected.node;
      let context = await this.getNodeContext(selected.canvas, node.id);
      if (node.type === "group") {
        const contained = data.nodes.filter((child: CanvasNodeData) => child.id !== node.id && child.x >= node.x && child.y >= node.y && child.x + child.width <= node.x + node.width && child.y + child.height <= node.y + node.height);
        context += "\n\nGroup contents:\n" + contained.map((child: CanvasNodeData) => String(child.text ?? child.file ?? child.url ?? child.type)).join("\n").slice(0, 6000);
      }
      const raw = await this.completeStructured(t("Generate a short, specific English title from the Canvas content below. Return only JSON: {\"title\":\"...\"}. Use 4 to 24 characters or a phrase of suitable length; no quotes or numbering.\n\n", "根据以下 Canvas 内容生成一个简短、具体的中文标题。只返回 JSON：{\"title\":\"...\"}。标题 4 至 24 个汉字或适当长度的短语；不要带引号和序号。\n\n") + context, node);
      const parsed = this.parseJsonPayload(raw);
      const title = typeof parsed.title === "string" ? parsed.title.trim().replace(/^["“”]+|["“”]+$/g, "") : "";
      if (!title) throw new Error(t("AI did not return a valid title.", "AI 没有返回有效标题。"));
      if (node.type === "group") {
        patchNode(selected.canvas, node.id, { label: title, bcSuggestedGroupName: title });
        this.decorate(selected.canvas);
        notice.hide();
        new Notice(t("Updated the group name to: ", "已将分组名称更新为：") + title);
      } else {
        const suggestion = this.makeDefaultTextNode(t("Title suggestion\n", "标题建议\n") + title, node.x + node.width + 100, node.y);
        insertCanvasNode(selected.canvas, suggestion, node.id);
        notice.hide();
        new Notice(t("Created a title suggestion node; the original node was not modified.", "已创建标题建议节点；原节点内容未修改。"));
      }
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }
  private async generateRelatedQuestions(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const notice = new Notice(t("Generating follow-up research questions…", "正在生成后续研究问题…"), 0);
    try {
      const context = await this.getNodeContext(selected.canvas, selected.node.id);
      const raw = await this.completeStructured(
        t("Generate 5 distinct follow-up research questions from the notes below. Return only JSON: {\"questions\":[\"Question 1\",\"Question 2\"]}. Each question must be under 100 characters; do not answer them and do not repeat.\n\n", "根据以下笔记生成 5 个有差异的后续研究问题，只返回 JSON：{\"questions\":[\"问题 1\",\"问题 2\"]}。每个问题不超过 100 字；不要回答问题，不要重复。\n\n") + context,
        selected.node
      );
      const parsed = this.parseJsonPayload(raw);
      const questions = Array.isArray(parsed.questions)
        ? [...new Set(parsed.questions.filter((question): question is string => typeof question === "string").map(question => question.trim()).filter(Boolean))].slice(0, 8)
        : [];
      if (!questions.length) throw new Error(t("AI did not return a valid question list.", "AI 没有返回有效的问题列表。"));
      for (let i = 0; i < questions.length; i++) {
        const defaultHeight = DEFAULT_NODE_HEIGHT;
        const node = this.makeDefaultTextNode(t("Research question: ", "研究问题：") + questions[i],
          selected.node.x + selected.node.width + 100, selected.node.y + i * (defaultHeight + 20));
        insertCanvasNode(selected.canvas, node, selected.node.id);
      }
      notice.hide();
      new Notice(t("Created " + questions.length + " follow-up research question nodes.", "已创建 " + questions.length + " 个后续研究问题节点。"));
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }
  private async completeStructured(prompt: string, node?: CanvasNodeData): Promise<string> {
    const settings = this.aiSettings(node);
    return chatCompletion(settings, [
      { role: "system", content: "Return only valid JSON. Do not include Markdown fences or commentary." },
      { role: "user", content: prompt }
    ]);
  }

  private expandIdeaIntoMindMap(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。")); return; }
    const selected = this.selected(canvas);
    this.input(t("AI mind map expansion", "AI 扩展思维导图"), t("Enter an idea, topic, or question", "输入想法、主题或问题"), async idea => {
      const notice = new Notice(t("Generating the mind map structure…", "正在生成思维导图结构…"), 0);
      try {
        const context = selected ? await this.getNodeContext(canvas, selected.node.id) : "";
        const raw = await this.completeStructured(
          t("Expand the topic into an English mind map. Return JSON: {\"nodes\":[{\"id\":\"n1\",\"parentId\":null,\"text\":\"...\"}]}. ", "将主题扩展成中文思维导图，返回 JSON：{\"nodes\":[{\"id\":\"n1\",\"parentId\":null,\"text\":\"...\"}]}. ") +
          t("At most 24 nodes; ids must be unique; the first node is the topic root and uses parentId=null; every other node's parentId points to an existing node; each text must be under 180 characters; ", "最多 24 个节点；id 必须唯一；第一个节点是主题根节点并使用 parentId=null；每个后续节点的 parentId 指向已有节点；每个 text 不超过 180 字；") +
          t("mark uncertain information and never invent sources. Topic: ", "不确定的信息需标明，不得编造来源。主题：") + idea + (context ? t("\nExisting Canvas context:\n", "\n现有 Canvas 上下文：\n") + context : "") ,
          selected?.node
        );
        const parsed = this.parseJsonPayload(raw);
        const items = Array.isArray(parsed.nodes) ? parsed.nodes.filter(isJsonObject).slice(0, 24) : [];
        if (!items.length) throw new Error(t("AI returned an empty nodes array.", "AI 返回的 nodes 为空。"));
        const validItems = items.filter((item): item is Record<string, unknown> & { text: string; id?: string | number | boolean; parentId?: string | number | boolean | null } =>
          typeof item.text === "string" && Boolean(item.text.trim()) &&
          (item.id === undefined || typeof item.id === "string" || typeof item.id === "number" || typeof item.id === "boolean") &&
          (item.parentId == null || typeof item.parentId === "string" || typeof item.parentId === "number" || typeof item.parentId === "boolean"));
        if (!validItems.length) throw new Error(t("AI did not provide valid node text.", "AI 没有提供有效的节点文本。"));
        const idMap = new Map<string, CanvasNodeData>();
        const fallbackRoot = selected?.node;
        const ordered = validItems.slice();
        const roots = ordered.filter(item => item.parentId == null);
        const rootItems = roots.length ? roots.slice(0, 1) : [ordered[0]];
        const baseX = fallbackRoot ? fallbackRoot.x + fallbackRoot.width + 100 : 0;
        const baseY = fallbackRoot ? fallbackRoot.y : 0;
        let rootNode: CanvasNodeData | undefined = fallbackRoot;
        for (let i = 0; i < rootItems.length; i++) {
          const item = rootItems[i];
          if (!fallbackRoot) {
            rootNode = this.makeDefaultTextNode(String(item.text).trim(), baseX, baseY);
            insertCanvasNode(canvas, rootNode);
          }
          const itemId = String(item.id ?? "root");
          if (rootNode) idMap.set(itemId, rootNode);
        }
        if (!rootNode) throw new Error(t("Could not create the mind map root node.", "无法创建思维导图根节点。"));

        const remaining = ordered.filter(item => !rootItems.includes(item));
        let unresolved = remaining;
        let guard = remaining.length + 1;
        let row = 0;
        while (unresolved.length && guard-- > 0) {
          const nextRound: typeof unresolved = [];
          let madeProgress = false;
          for (const item of unresolved) {
            const parentId = item.parentId == null ? String(rootItems[0].id ?? "root") : String(item.parentId);
            const parent = idMap.get(parentId) ?? (item.parentId == null ? rootNode : undefined);
            if (!parent) { nextRound.push(item); continue; }
            const child = makeTextNode(String(item.text).trim().slice(0, 1200),
              parent.x + parent.width + 100, parent.y + row * 12, { width: 300, height: 140 });
            insertCanvasNode(canvas, child, parent.id);
            idMap.set(String(item.id ?? "node-" + row), child);
            row += 1;
            madeProgress = true;
          }
          if (!madeProgress) break;
          unresolved = nextRound;
        }
        if (unresolved.length) new Notice(t("Skipped " + unresolved.length + " nodes with an invalid parentId.", "有 " + unresolved.length + " 个节点因 parentId 无效而跳过。"));
        this.decorate(canvas);
        notice.hide();
        new Notice(t("Created a mind map from the topic (" + idMap.size + " nodes).", "已从主题创建思维导图（" + idMap.size + " 个节点）。"));
      } catch (error) {
        notice.hide();
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      }
    });
  }

  private async saveSpacedRepetitionDeck(
    cards: Array<{ question?: string; answer?: string }>,
    sourceNode: CanvasNodeData
  ): Promise<string> {
    const settings = this.settings();
    const folder = normalizeSpacedRepetitionFolderPath(
      String(settings.spacedRepetitionFolder || "Better Canvas/Flashcards")
    );
    const deckName = String(settings.spacedRepetitionDeck || "better-canvas");
    const title = String(sourceNode.text ?? "Flashcards");
    const markdown = formatSpacedRepetitionDeck(cards, deckName, title);
    await this.ensureFolder(folder);
    const path = uniqueSpacedRepetitionPath(
      folder,
      title,
      this.p.app.vault.getFiles().map((file: TFile) => file.path)
    );
    // Never overwrite an existing user note; collisions use a numbered suffix.
    await this.p.app.vault.create(path, markdown);
    return path;
  }

  private async generateFlashcardNodes(target?: string | AISelectionTarget): Promise<void> {
    const selected = this.aiSelection(target);
    if (!selected) return;
    const spacedRepetition = this.settings().flashcardOutputMode === "spaced-repetition";
    const notice = new Notice(spacedRepetition ? t("Generating and exporting the review deck…", "正在生成并导出复习卡组…") : t("Generating standalone flashcards…", "正在生成独立闪卡…"), 0);
    try {
      const context = await this.getNodeContext(selected.canvas, selected.nodeIds);
      if (!this.aiSelection(selected)) return;
      const raw = await this.completeStructured(
        t("Create 5 to 10 English review flashcards from the material below. Return only JSON: {\"cards\":[{\"question\":\"...\",\"answer\":\"...\"}]}. ", "基于以下资料生成 5 至 10 张中文复习闪卡，只返回 JSON：{\"cards\":[{\"question\":\"...\",\"answer\":\"...\"}]}. ") +
        t("Questions must prompt active recall; answers must be concise and verifiable; do not add facts that are not in the material. Material:\n", "问题要能主动回忆，答案简洁可验证；不要补充资料中没有的事实。资料：\n") + context,
        selected.node
      );
      const parsed = this.parseJsonPayload(raw);
      const cards = Array.isArray(parsed.cards) ? parsed.cards.slice(0, 12).filter((card): card is { question: string; answer: string } =>
        isJsonObject(card) && typeof card.question === "string" && Boolean(card.question.trim()) &&
        typeof card.answer === "string" && Boolean(card.answer.trim())) : [];
      if (!cards.length) throw new Error(t("AI did not return valid review flashcards.", "AI 未返回有效的复习闪卡。"));
      const fresh = this.aiSelection(selected);
      if (!fresh) return;

      if (spacedRepetition) {
        const filePath = await this.saveSpacedRepetitionDeck(cards, selected.node);
        notice.hide();
        new Notice(t("Exported " + cards.length + " flashcards to " + filePath + ". Existing notes are not overwritten.", "已导出 " + cards.length + " 张闪卡到 " + filePath + "。现有笔记不会被覆盖。"));
        return;
      }

      const position = this.aiOutputPosition(fresh.nodes);
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const text = t("Question: ", "问题：") + card.question.trim() + t("\n\nAnswer: ", "\n\n答案：") + card.answer.trim();
        const node = makeTextNode(text, position.x,
          position.y + i * 180, { width: 330, height: 150 });
        insertCanvasNode(selected.canvas, node, selected.nodeIds);
      }
      notice.hide();
      new Notice(t("Created " + cards.length + " standalone review flashcard nodes.", "已创建 " + cards.length + " 张独立复习闪卡节点。"));
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      notice.hide();
    }
  }
  private async runAI(
    rootIds: string | readonly string[],
    instruction: string,
    modelOverride?: string,
    replaceNodeId?: string,
    nativeVideoUrl?: string,
    canvas = this.canvas()
  ): Promise<void> {
    if (!canvas) {
      new Notice(t("Open a Canvas first.", "请先打开一个 Canvas。"));
      return;
    }
    const selection = this.aiSelection({ canvas, nodeIds: typeof rootIds === "string" ? [rootIds] : rootIds });
    if (!selection) return;
    const { node: source, nodeIds } = selection;
    const nodeId = source.id;
    const sourceMetadata = nodeIds.length > 1 ? { bcSourceNodes: [...nodeIds] } : {};

    const previous = this.activeGenerations.get(canvas);
    if (previous) previous.controller.abort();
    const controller = new AbortController();
    this.activeGenerations.set(canvas, { controller, nodeId });
    const notice = new Notice(t("Better Canvas: preparing AI context…", "Better Canvas：正在准备 AI 上下文…"), 0);
    let responseNodeId = "";
    let accumulated = "";
    let lastUpdate = 0;
    let lastFlushedLength = 0;

    try {
      const context = await this.getNodeContext(canvas, nodeIds);
      const images = await this.getConnectedImages(canvas, nodeIds);
      if (controller.signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
      const prompt = t("Answer based on the provided Obsidian Canvas notes; do not claim to have read sources that were not provided.\n\nTask: ", "请基于所给 Obsidian Canvas 笔记回答，不要声称读取了未提供的来源。\n\n任务：") + instruction + t("\n\nCanvas context:\n", "\n\n画布上下文：\n") + context;
      const contentParts: Exclude<ChatMessageContent, string> = [
        { type: "text", text: prompt },
        ...images,
        ...(nativeVideoUrl ? [{ type: "file_data" as const, file_data: { file_uri: nativeVideoUrl, mime_type: "video/*" } }] : [])
      ];
      const content: ChatMessageContent = images.length || nativeVideoUrl ? contentParts : prompt;

      const fresh = this.aiSelection(selection);
      if (!fresh) return;
      const position = this.aiOutputPosition(fresh.nodes);
      const generationSettings = this.aiSettings(source, modelOverride);
      const generationProvider = isLocalAgentBackend(generationSettings.backend)
        ? generationSettings.backend : this.currentProvider(source).id;
      const placeholder: CanvasNodeData = {
        ...makeTextNode("", position.x, position.y, {
          width: Math.max(300, fresh.node.width),
          height: 180
        }),
        bcGenerating: true,
        bcGenerated: false,
        bcPrompt: instruction,
        bcSourceNode: nodeId,
        ...sourceMetadata,
        bcAIModel: generationSettings.model,
        bcAIProvider: generationProvider
      };
      responseNodeId = placeholder.id;
      insertCanvasNode(canvas, placeholder, nodeIds);

      const answer = await chatCompletionStream(
        generationSettings,
        [
          { role: "system", content: this.settings().systemPrompt || "You are a precise assistant. Preserve uncertainty." },
          { role: "user", content }
        ],
        controller.signal,
        delta => {
          accumulated += delta;
          const now = Date.now();
          if (now - lastUpdate >= 120 || accumulated.length - lastFlushedLength >= 120) {
            patchNode(canvas, responseNodeId, { text: accumulated, bcGenerating: true });
            lastUpdate = now;
            lastFlushedLength = accumulated.length;
          }
        }
      );

      accumulated = answer;
      const replaced = !replaceNodeId || replaceNodeId === responseNodeId ||
        removeCanvasNode(canvas, replaceNodeId);
      patchNode(canvas, responseNodeId, {
        text: answer,
        bcGenerating: false,
        bcGenerated: true,
        bcStopped: false,
        bcPrompt: instruction,
        bcSourceNode: nodeId,
        ...sourceMetadata,
        bcAIModel: generationSettings.model,
        bcAIProvider: generationProvider
      });
      notice.hide();
      new Notice(replaced ? t("AI reply added as a connected node.", "AI 回复已添加为关联节点。") : t("A new AI reply was generated, but the old reply could not be removed automatically.", "新的 AI 回复已生成，但旧回复未能自动移除。"));
    } catch (error) {
      const stopped = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      let cleanupFailed = false;
      if (responseNodeId) {
        if (stopped) {
          patchNode(canvas, responseNodeId, {
            text: accumulated || t("(Generation stopped; no text output yet)", "（生成已停止，暂无文本输出）"),
            bcGenerating: false,
            bcGenerated: false,
            bcStopped: true
          });
        } else if (accumulated) {
          patchNode(canvas, responseNodeId, {
            text: accumulated,
            bcGenerating: false,
            bcGenerated: false,
            bcGenerationError: error instanceof Error ? error.message : String(error)
          });
        } else {
          cleanupFailed = !removeCanvasNode(canvas, responseNodeId);
          if (cleanupFailed) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("Better Canvas could not remove a failed AI placeholder; using visible error state.", responseNodeId);
            // A last-resort visible error state is preferable to an empty node
            // that remains marked as permanently generating.
            patchNode(canvas, responseNodeId, {
              text: t("AI generation failed and this placeholder node could not be removed automatically.", "AI 生成失败，且无法自动移除该占位节点。"),
              bcGenerating: false,
              bcGenerated: false,
              bcGenerationError: message
            });
          }
        }
      }
      notice.hide();
      if (stopped) new Notice(t("AI generation stopped; the partial output was kept.", "AI 生成已停止；已保留已生成的部分内容。"));
      else if (cleanupFailed) new Notice(t("AI generation failed and the placeholder node could not be removed; the loading state has been stopped.", "AI 生成失败，无法自动移除占位节点；已停止加载状态。"), 8000);
      else new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      notice.hide();
      if (this.activeGenerations.get(canvas)?.controller === controller) this.activeGenerations.delete(canvas);
    }
  }

  private stopAI(): void {
    const canvas = this.canvas();
    const current = canvas ? this.activeGenerations.get(canvas) : undefined;
    const active = current ?? Array.from(this.activeGenerations.values()).at(-1);
    if (!active) {
      new Notice(t("No AI request is currently running.", "当前没有正在运行的 AI 请求。"));
      return;
    }
    active.controller.abort();
  }

  private async regenerate(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    const node = selection.node;
    if (!node.bcGenerated || typeof node.bcSourceNode !== "string" || typeof node.bcPrompt !== "string") {
      new Notice(t("The selected node has no AI metadata to regenerate from.", "所选节点没有可重新生成的 AI 元数据。"));
      return;
    }
    const sourceIds = isStringArray(node.bcSourceNodes) && node.bcSourceNodes.length
      ? node.bcSourceNodes : [node.bcSourceNode];
    const modelOverride = !isLocalAgentBackend(node.bcAIProvider) && typeof node.bcAIModel === "string" ? node.bcAIModel : undefined;
    await this.runAI(sourceIds, node.bcPrompt, modelOverride,
      node.id, undefined, selection.canvas);
  }

  private async generateImageForNode(target?: string | AISelectionTarget): Promise<void> {
    const selection = this.aiSelection(target);
    if (!selection) return;
    const { canvas, node } = selection;
    const notice = new Notice(t("Generating image…", "正在生成图片…"), 0);
    try {
      const context = await this.getNodeContext(canvas, selection.nodeIds);
      if (!this.aiSelection(selection)) return;
      const settings = this.settings();
      const imageProtocol = settings.imageProtocol === "gemini" ? "gemini" : "openai";
      const imageModel = String(settings.imageModel || "gpt-image-1");
      const imageSettings: AISettings = {
        ...this.aiSettings(node),
        baseUrl: String(settings.imageBaseUrl || (imageProtocol === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta"
          : "https://api.openai.com/v1")),
        apiKey: String(settings.imageApiKey || ""),
        model: imageModel,
        imageModel,
        protocol: imageProtocol,
        backend: "api"
      };
      const result = await generateImage(imageSettings,
        "Create a clear visual based on these notes. Avoid long text in the image.\n\n" + context.slice(0, 7000));
      const fresh = this.aiSelection(selection);
      if (!fresh) return;
      const folder = String(settings.attachmentFolder || "Better Canvas/Generated Images");
      await this.ensureFolder(folder);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = folder + "/better-canvas-" + stamp + "." + result.extension;
      const bytes = result.bytes.slice();
      await this.p.app.vault.createBinary(path, bytes.buffer);
      const position = this.aiOutputPosition(fresh.nodes);
      const imageNode: CanvasNodeData = {
        id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
        type: "file",
        file: path,
        ...position,
        y: selection.nodeIds.length === 1 ? fresh.node.y + fresh.node.height + 30 :
          position.y,
        width: 320,
        height: 240
      };
      insertCanvasNode(canvas, imageNode, selection.nodeIds);
      notice.hide();
      new Notice(t("The generated image was saved to the vault and connected to the source node.", "生成图片已保存至 Vault，并连接到源节点。"));
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      notice.hide();
    }
  }

  private async runMcpTool(): Promise<void> {
    const canvasForWrite = this.canvas();
    if (!canvasForWrite) {
      new Notice(t("Open a Canvas first, then call an MCP tool to store the result.", "请先打开一个 Canvas，再调用 MCP 工具以保存结果。"));
      return;
    }
    if (canvasForWrite.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode before writing MCP results.", "当前 Canvas 处于只读模式。请先解除只读模式再写入 MCP 结果。"));
      return;
    }
    const s = this.settings();
    const useStdio = s.mcpTransport === "stdio";
    const useSse = s.mcpTransport === "sse";
    if (!useStdio && !s.mcpEndpoint) { new Notice(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。")); return; }
    try {
      const tools = useStdio
        ? await listLocalMcpTools(String(s.mcpStdioConfig ?? ""))
        : useSse
          ? await listSseMcpTools(s.mcpEndpoint, s.mcpApiKey)
          : await listRemoteTools(s.mcpEndpoint, s.mcpApiKey);
      if (!tools.length) { new Notice(t("The MCP service exposes no tools.", "MCP 服务未暴露工具。")); return; }
      const summary = tools.map(tool => tool.name + (tool.description ? " — " + tool.description : "")).join("\n");
      this.input(t("Select MCP tool", "选择 MCP 工具"), summary + t("\n\nEnter the full tool name", "\n\n输入完整工具名"), name => {
        const tool = tools.find(item => item.name === name.trim());
        if (!tool) return new Notice(t("The tool name is not in the list.", "工具名称不在列表中。"));
        this.input(t("MCP arguments", "MCP 参数"), t("Enter a JSON object, e.g. {}", "输入 JSON object，例如 {}"), async raw => {
          const args = parseJsonObjectPrompt(raw, t("arguments", "参数"));
          const sourceSelection = this.selected(canvasForWrite);
          const notice = new Notice(t("Calling the MCP tool…", "正在调用 MCP 工具…"), 0);
          try {
            const result = useStdio
              ? await callLocalMcpTool(String(s.mcpStdioConfig ?? ""), tool.name, args)
              : useSse
                ? await callSseMcpTool(s.mcpEndpoint, s.mcpApiKey, tool.name, args)
                : await callRemoteTool(s.mcpEndpoint, s.mcpApiKey, tool.name, args);
            await this.saveMcpResult(tool.name, result, canvasForWrite, sourceSelection?.node);
            notice.hide();
          } catch (error) {
            notice.hide();
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          }
        }, "{}", false, promptValidator(value => parseJsonObjectPrompt(value, t("arguments", "参数"))));
      }, tools[0].name);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private mcpOutputContext(): { canvas: CanvasRuntime; source?: CanvasNodeData } | null {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice(t("Open a Canvas first, then add the MCP result as a node.", "请先打开一个 Canvas，再将 MCP 结果添加为节点。"));
      return null;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode before writing MCP results.", "当前 Canvas 处于只读模式。请先解除只读模式再写入 MCP 结果。"));
      return null;
    }
    let source: CanvasNodeData | undefined;
    try {
      if (canvas.selection?.size === 1) {
        const internal = canvas.selection.values().next().value;
        source = readCanvasData(canvas).nodes.find((node: CanvasNodeData) => node.id === internal?.id);
      }
    } catch {
      // An empty or stale selection is fine; the result will be standalone.
    }
    return { canvas, source };
  }

  private async listConfiguredMcpResources(): Promise<McpResource[]> {
    const s = this.settings();
    if (s.mcpTransport === "stdio") return await listLocalMcpResources(String(s.mcpStdioConfig ?? ""));
    if (!String(s.mcpEndpoint ?? "").trim()) throw new Error(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。"));
    if (s.mcpTransport === "sse") return await listSseMcpResources(s.mcpEndpoint, s.mcpApiKey);
    return await listRemoteResources(s.mcpEndpoint, s.mcpApiKey);
  }

  private async readConfiguredMcpResource(uri: string): Promise<RemoteMcpResult> {
    const s = this.settings();
    if (s.mcpTransport === "stdio") return await readLocalMcpResource(String(s.mcpStdioConfig ?? ""), uri);
    if (!String(s.mcpEndpoint ?? "").trim()) throw new Error(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。"));
    if (s.mcpTransport === "sse") return await readSseMcpResource(s.mcpEndpoint, s.mcpApiKey, uri);
    return await readRemoteResource(s.mcpEndpoint, s.mcpApiKey, uri);
  }

  private async listConfiguredMcpPrompts(): Promise<McpPrompt[]> {
    const s = this.settings();
    if (s.mcpTransport === "stdio") return await listLocalMcpPrompts(String(s.mcpStdioConfig ?? ""));
    if (!String(s.mcpEndpoint ?? "").trim()) throw new Error(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。"));
    if (s.mcpTransport === "sse") return await listSseMcpPrompts(s.mcpEndpoint, s.mcpApiKey);
    return await listRemotePrompts(s.mcpEndpoint, s.mcpApiKey);
  }

  private async getConfiguredMcpPrompt(name: string, args: Record<string, string>): Promise<RemoteMcpResult> {
    const s = this.settings();
    if (s.mcpTransport === "stdio") return await getLocalMcpPrompt(String(s.mcpStdioConfig ?? ""), name, args);
    if (!String(s.mcpEndpoint ?? "").trim()) throw new Error(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。"));
    if (s.mcpTransport === "sse") return await getSseMcpPrompt(s.mcpEndpoint, s.mcpApiKey, name, args);
    return await getRemotePrompt(s.mcpEndpoint, s.mcpApiKey, name, args);
  }

  private async listMcpResources(): Promise<void> {
    const context = this.mcpOutputContext();
    if (!context) return;
    const loading = new Notice(t("Listing MCP resources…", "正在列出 MCP resources…"), 0);
    try {
      const resources = await this.listConfiguredMcpResources();
      await this.saveMcpResult("MCP Resources", {
        text: formatMcpResourceCatalog(resources),
        images: []
      }, context.canvas, context.source);
      loading.hide();
      new Notice(t("Wrote " + resources.length + " MCP resources to the Canvas.", "已将 " + resources.length + " 个 MCP 资源写入 Canvas。"));
    } catch (error) {
      loading.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private async readMcpResource(): Promise<void> {
    const context = this.mcpOutputContext();
    if (!context) return;
    const loading = new Notice(t("Reading the MCP resource list…", "正在读取 MCP resource 列表…"), 0);
    let resources: McpResource[];
    try {
      resources = await this.listConfiguredMcpResources();
      loading.hide();
    } catch (error) {
      loading.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
      return;
    }
    if (!resources.length) {
      new Notice(t("The MCP service exposes no readable resources.", "MCP 服务没有公开可读取的 resources。"));
      return;
    }
    const options = resources.map(item =>
      item.uri + " — " + item.name + (item.description ? "\n  " + item.description : "")
    ).join("\n\n");
    this.input(t("Select MCP resource URI", "选择 MCP resource URI"), options + t("\n\nEnter the full URI; only values from the list above are accepted.", "\n\n输入完整 URI；只允许从上方列表选择。"), uri => {
      const resource = resources.find(item => item.uri === uri.trim());
      if (!resource) {
        new Notice(t("The resource URI is not in the current MCP service's list.", "资源 URI 不在当前 MCP 服务的列表中。"));
        return;
      }
      void (async () => {
        const notice = new Notice(t("Reading MCP resource…", "正在读取 MCP resource…"), 0);
        try {
          const result = await this.readConfiguredMcpResource(resource.uri);
          await this.saveMcpResult("Resource: " + resource.name, result, context.canvas, context.source);
          notice.hide();
          new Notice(t("Added the MCP resource to the Canvas.", "已将 MCP resource 添加到 Canvas。"));
        } catch (error) {
          notice.hide();
          new Notice(error instanceof Error ? error.message : String(error), 8000);
        }
      })();
    }, resources[0].uri);
  }

  private async listMcpPrompts(): Promise<void> {
    const context = this.mcpOutputContext();
    if (!context) return;
    const loading = new Notice(t("Listing MCP prompts…", "正在列出 MCP prompts…"), 0);
    try {
      const prompts = await this.listConfiguredMcpPrompts();
      await this.saveMcpResult("MCP Prompts", {
        text: formatMcpPromptCatalog(prompts),
        images: []
      }, context.canvas, context.source);
      loading.hide();
      new Notice(t("Wrote " + prompts.length + " MCP prompts to the Canvas.", "已将 " + prompts.length + " 个 MCP 提示模板写入 Canvas。"));
    } catch (error) {
      loading.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private async getMcpPrompt(): Promise<void> {
    const context = this.mcpOutputContext();
    if (!context) return;
    const loading = new Notice(t("Reading the MCP prompt list…", "正在读取 MCP prompt 列表…"), 0);
    let prompts: McpPrompt[];
    try {
      prompts = await this.listConfiguredMcpPrompts();
      loading.hide();
    } catch (error) {
      loading.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
      return;
    }
    if (!prompts.length) {
      new Notice(t("The MCP service exposes no runnable prompts.", "MCP 服务没有公开可执行的 prompts。"));
      return;
    }
    const summary = prompts.map(prompt =>
      prompt.name + (prompt.description ? " — " + prompt.description : "") +
      (prompt.arguments.length ? t("\n  Arguments: ", "\n  参数：") + prompt.arguments.map(arg =>
        arg.name + (arg.required ? t("(required)", "（必填）") : "") + (arg.description ? " — " + arg.description : "")
      ).join(", ") : "")
    ).join("\n\n");
    this.input(t("Select MCP prompt", "选择 MCP Prompt"), summary + t("\n\nEnter the full name; only values from the list above are accepted.", "\n\n输入完整名称；只允许从上方列表选择。"), name => {
      const prompt = prompts.find(item => item.name === name.trim());
      if (!prompt) {
        new Notice(t("The prompt name is not in the current MCP service's list.", "Prompt 名称不在当前 MCP 服务的列表中。"));
        return;
      }
      this.input(t("MCP prompt arguments", "MCP Prompt 参数"), t("Enter a JSON object; argument values must be strings.\n\n", "输入 JSON object；参数值必须是字符串。\n\n") + summary, raw => {
        const args = parseMcpPromptArguments(raw);
        const missing = prompt.arguments.filter(arg => arg.required && !String(args[arg.name] ?? "").trim());
        if (missing.length) {
          new Notice(t("Missing required prompt arguments: ", "缺少必填 Prompt 参数：") + missing.map(arg => arg.name).join(", "));
          return;
        }
        void (async () => {
          const notice = new Notice(t("Resolving MCP prompt…", "正在解析 MCP Prompt…"), 0);
          try {
            const result = await this.getConfiguredMcpPrompt(prompt.name, args);
            await this.saveMcpResult("Prompt: " + prompt.name, result, context.canvas, context.source);
            notice.hide();
            new Notice(t("Added the MCP prompt result to the Canvas.", "已将 MCP Prompt 结果添加到 Canvas。"));
          } catch (error) {
            notice.hide();
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          }
        })();
      }, "{}", false, promptValidator(parseMcpPromptArguments));
    }, prompts[0].name);
  }

  private async runAIMcpTool(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    if (selection.canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode. Turn off read-only mode before writing MCP results.", "当前 Canvas 处于只读模式。请先解除只读模式再写入 MCP 结果。"));
      return;
    }
    const settings = this.settings();
    const useStdio = settings.mcpTransport === "stdio";
    const useSse = settings.mcpTransport === "sse";
    if (!useStdio && !settings.mcpEndpoint) {
      new Notice(t("Enter the remote MCP endpoint URL in settings first.", "请先在设置中填写远程 MCP endpoint URL。"));
      return;
    }

    const loading = new Notice(t("Reading MCP tools and asking AI to plan a call…", "正在读取 MCP 工具并让 AI 规划调用…"), 0);
    try {
      const tools = useStdio
        ? await listLocalMcpTools(String(settings.mcpStdioConfig ?? ""))
        : useSse
          ? await listSseMcpTools(settings.mcpEndpoint, settings.mcpApiKey)
          : await listRemoteTools(settings.mcpEndpoint, settings.mcpApiKey);
      if (!tools.length) throw new Error(t("The MCP service exposes no tools.", "MCP 服务未暴露工具。"));
      const context = await this.getNodeContext(selection.canvas, selection.node.id);
      const menu = tools.slice(0, 80).map(tool => ({
        name: tool.name,
        description: (tool.description ?? "").slice(0, 500),
        inputSchema: tool.inputSchema ?? {}
      }));
      const raw = await this.completeStructured(
        t("You may choose one MCP tool for the user to complete the task. Only pick a tool from the list below whose name matches exactly; arguments must satisfy inputSchema.\n", "你可以为用户选择一个 MCP 工具来完成任务。只能从下列 tool 列表中选择 name 完全相同的工具；参数必须符合 inputSchema。\n") +
        t("If no tool fits, return {\"toolName\":\"\",\"arguments\":{},\"reason\":\"explain why no tool is called\"}.\n", "如果没有合适的工具，返回 {\"toolName\":\"\",\"arguments\":{},\"reason\":\"说明不调用工具的原因\"}。\n") +
        t("Return JSON only; do not execute anything and do not claim the tool has already run.\n\nUser task: ", "必须只返回 JSON，禁止直接执行、禁止声称工具已经执行。\n\n用户任务：") +
        t("Using the selected Canvas notes, handle the parts that external tools can do with an MCP tool.\n\nCanvas context:\n", "请围绕选中的 Canvas 笔记，使用 MCP 工具处理能由外部工具完成的部分。\n\nCanvas 上下文：\n") + context.slice(0, 10000) +
        t("\n\nAvailable tools:\n", "\n\n可用工具：\n") + JSON.stringify(menu),
        selection.node
      );
      const proposal = this.parseJsonPayload(raw);
      if (!proposal.toolName || typeof proposal.toolName !== "string") {
        throw new Error(typeof proposal.reason === "string" && proposal.reason ? proposal.reason : t("AI did not choose an MCP tool.", "AI 没有选择 MCP 工具。"));
      }
      const tool = tools.find(item => item.name === proposal.toolName);
      if (!tool) throw new Error(t("The tool name returned by AI is not in the MCP tool list.", "AI 返回的工具名称不在 MCP 工具列表中。"));
      if (!isJsonObject(proposal.arguments)) {
        throw new Error(t("The tool arguments returned by AI are not a JSON object.", "AI 返回的工具参数不是 JSON object。"));
      }
      loading.hide();

      const suggested = {
        toolName: tool.name,
        arguments: proposal.arguments,
        reason: typeof proposal.reason === "string" ? proposal.reason : ""
      };
      const toolNames = tools.map(item => item.name);
      this.input(
        t("Confirm MCP call: ", "确认 MCP 调用：") + tool.name,
        t("Check the arguments. Pressing “Submit” sends the toolName and arguments in this JSON to your configured MCP service.", "请检查参数。按“提交”即会把此 JSON 中的 toolName 与 arguments 发送给你配置的 MCP 服务。"),
        async edited => {
          const confirmed = parseMcpToolConfirmation(edited, toolNames);
          const running = new Notice(t("Running the confirmed MCP tool: " + confirmed.toolName, "正在执行已确认的 MCP 工具：" + confirmed.toolName), 0);
          try {
            const result = useStdio
              ? await callLocalMcpTool(String(settings.mcpStdioConfig ?? ""), confirmed.toolName, confirmed.arguments)
              : useSse
                ? await callSseMcpTool(settings.mcpEndpoint, settings.mcpApiKey, confirmed.toolName, confirmed.arguments)
                : await callRemoteTool(
                    settings.mcpEndpoint,
                    settings.mcpApiKey,
                    confirmed.toolName,
                    confirmed.arguments
                  );
            const canvas = selection.canvas;
            const current = readCanvasData(canvas).nodes.find((node: CanvasNodeData) => node.id === selection.node.id);
            await this.saveMcpResult(confirmed.toolName, result, canvas, current);
            running.hide();
            new Notice(t("MCP call complete; the result was saved as a new node.", "MCP 调用完成；结果已保存为新节点。"));
          } catch (error) {
            running.hide();
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          }
        },
        JSON.stringify(suggested, null, 2),
        false,
        promptValidator(value => parseMcpToolConfirmation(value, toolNames))
      );
    } catch (error) {
      loading.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private createCanvasPortal(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice(t("Open a Canvas first.", "请先打开 Canvas。")); return; }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) { new Notice(t("This Canvas is in read-only mode.", "当前 Canvas 处于只读模式。")); return; }
    const selection = this.selected(canvas);
    const currentPath = this.activeCanvasView()?.file?.path;
    const canvasFiles = this.p.app.vault.getFiles().filter((file: TFile) =>
      file.extension.toLowerCase() === "canvas" && file.path !== currentPath
    );
    if (!canvasFiles.length) { new Notice(t("No other Canvas files are available in the vault.", "Vault 中没有可用的其他 Canvas 文件。")); return; }

    const chooseCanvasFile = (file: TFile): void => {
      const x = selection ? selection.node.x + selection.node.width + 100 : 0;
      const y = selection ? selection.node.y : 0;
      const node: CanvasNodeData = {
        id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
        type: "file",
        file: file.path,
        portal: true,
        x,
        y,
        width: 360,
        height: 260
      };
      insertCanvasNode(canvas, node, selection?.node.id);
      const view = this.activeCanvasView();
      if (view) void this.portalManager?.refreshView(view, true);
      new Notice(t("Created and opened an editable Canvas Portal. Verify that the child Canvas content stays in sync.", "已创建并打开可编辑 Canvas Portal。请确认子画布内容同步正常。"));
    };
    const ModalClass = class extends SuggestModal<TFile> {
      getSuggestions(query: string): TFile[] {
        const needle = query.trim().toLocaleLowerCase();
        return canvasFiles
          .filter((file: TFile) => !needle || file.path.toLocaleLowerCase().includes(needle) || file.basename.toLocaleLowerCase().includes(needle))
          .slice(0, 100);
      }
      renderSuggestion(file: TFile, element: HTMLElement): void {
        element.createDiv({ text: file.basename });
        element.createEl("small", { text: file.path });
      }
      onChooseSuggestion(file: TFile): void {
        chooseCanvasFile(file);
      }
    };
    new ModalClass(this.p.app).open();
  }

  private addTextNodeToPortal(): void {
    const selection = this.selected();
    if (!selection) return;
    if (selection.node.type !== "file" ||
        typeof selection.node.file !== "string" ||
        !selection.node.file.toLowerCase().endsWith(".canvas")) {
      new Notice(t("Select a node that points to another .canvas file first.", "请先选择指向另一个 .canvas 文件的节点。"));
      return;
    }
    this.input(
      t("Create a text node in a Canvas Portal", "在 Canvas Portal 中创建文本节点"),
      t("Enter the content to add to the Portal source Canvas", "输入要添加到 Portal 源画布的内容"),
      value => void this.portalManager?.addTextNodeToPortal(value, selection.node.id)
    );
  }

  private ocrSelectedPdfPage(): void {
    const selection = this.selected();
    if (!selection) return;
    const node = selection.node;
    if (node.type !== "file" || typeof node.file !== "string" || !node.file.toLowerCase().endsWith(".pdf")) {
      new Notice(t("Select a PDF file node or a pinned PDF page node first.", "请先选择一个 PDF 文件节点或固定 PDF 页面节点。"));
      return;
    }
    const file = this.p.app.vault.getAbstractFileByPath(node.file);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") {
      new Notice(t("Could not find the selected PDF file.", "找不到所选 PDF 文件。"));
      return;
    }
    // getConnectedImages rasterizes the selected/pinned PDF page and sends it
    // to the configured vision-capable provider through the regular AI path.
    void this.runAI(
      node.id,
      t("Run OCR transcription on the page corresponding to the selected PDF node instead of summarizing. Extract all visible text line by line, preserving headings, paragraphs, bullets, tables, and formulas where possible, in Markdown. Mark unclear characters as [unclear] and do not guess invisible content. If the node has no explicit page number, transcribe page 1.", "请对所选 PDF 节点对应的页面执行 OCR 转录，而不是总结。逐行提取所有可见文字，尽量保留标题、段落、项目符号、表格和公式结构，使用 Markdown 格式。将无法确定的字符标成 [不清晰]，不要猜测不可见内容。若当前节点没有明确页码，则转录第 1 页。")
    );
  }

  private ocrPdfPageRange(): void {
    const selection = this.selected();
    if (!selection) return;
    const node = selection.node;
    if (node.type !== "file" || typeof node.file !== "string" || !node.file.toLowerCase().endsWith(".pdf")) {
      new Notice(t("Select a PDF file node first.", "请先选择一个 PDF 文件节点。"));
      return;
    }
    const file = this.p.app.vault.getAbstractFileByPath(node.file);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") {
      new Notice(t("Could not find the selected PDF file.", "找不到所选 PDF 文件。"));
      return;
    }

    this.input(
      t("Batch OCR PDF page range", "批量 OCR PDF 页码范围"),
      t("e.g. 1-10 or 1-3,5,8-10; at most 20 pages per batch.", "例如 1-10 或 1-3,5,8-10；每批最多 20 页。"),
      value => {
        let pages: number[];
        try {
          pages = parsePdfPageSelection(value, 20);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
          return;
        }
        void this.runPdfPageOcrRange(selection.canvas, node, file, pages);
      },
      "1-10"
    );
  }

  private async runPdfPageOcrRange(
    canvas: CanvasRuntime,
    sourceNode: CanvasNodeData,
    file: TFile,
    pages: number[]
  ): Promise<void> {
    const preparationNotice = new Notice(t("Checking the PDF page range…", "正在检查 PDF 页码范围…"), 0);
    try {
      // Preflight the complete selection before creating nodes or making AI calls.
      for (const page of pages) {
        const contexts = await extractPdfPages(this.p.app, file, pinnedPdfSubpath(page), 1, false);
        if (!contexts.length) throw new Error(t("The PDF does not contain page " + page + "; no batch task was created.", "PDF 不包含第 " + page + " 页；未创建批量任务。"));
      }
      if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
        throw new Error(t("This Canvas has switched to read-only mode; the batch OCR task cannot be created.", "当前 Canvas 已切换为只读模式，不能创建批量 OCR 任务。"));
      }
      const latestSource = readCanvasData(canvas).nodes.find((item: CanvasNodeData) => item.id === sourceNode.id);
      if (!latestSource) throw new Error(t("The original PDF node no longer exists. Select the PDF again and retry.", "原 PDF 节点已不存在，请重新选择 PDF 后重试。"));

      const startX = latestSource.x + latestSource.width + 100;
      const task = makeTextNode(
        t("PDF batch OCR task\n\nSource file: ", "PDF 批量 OCR 任务\n\n源文件：") + file.path +
        t("\nPages: ", "\n页码：") + pages.join(", ") +
        t("\nStatus: ready to run\n\nEach page will produce a separate OCR result node.", "\n状态：准备运行\n\n每页将生成独立的 OCR 结果节点。"),
        startX,
        latestSource.y,
        { width: 380, height: 190 }
      );
      (task).bcPdfOcrBatch = { source: file.path, pages, state: "running" };
      insertCanvasNode(canvas, task, latestSource.id);

      const pageNodes: Array<{ node: CanvasNodeData; page: number }> = [];
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        const pageNode: CanvasNodeData = {
          id: createId(),
          type: "file",
          file: file.path,
          subpath: pinnedPdfSubpath(page),
          pinned: true,
          bcPdfOcrBatchPage: page,
          x: task.x + task.width + 100,
          y: task.y + index * 260,
          width: 320,
          height: 220
        };
        insertCanvasNode(canvas, pageNode, task.id);
        pageNodes.push({ node: pageNode, page });
      }

      preparationNotice.hide();
      let completed = 0;
      let failed = 0;
      let stopped = false;
      for (let index = 0; index < pageNodes.length; index++) {
        const item = pageNodes[index];
        await this.runAI(
          item.node.id,
          t("For PDF file “", "请对 PDF 文件“") + file.path + t("”, run OCR transcription on page ", "”的第 ") + item.page +
          t(" instead of summarizing. Extract all visible text on this page line by line, preserving headings, paragraphs, bullets, tables, and formulas where possible, in Markdown. Mark unclear characters as [unclear] and do not guess invisible content. Transcribe only this page, not other pages.", " 页执行 OCR 转录，而不是总结。逐行提取该页所有可见文字，尽量保留标题、段落、项目符号、表格和公式结构，使用 Markdown。将无法确定的字符标成 [不清晰]，不要猜测不可见内容。只转录当前页，不要转录其他页。")
        );
        const currentNodes = readCanvasData(canvas).nodes;
        const output = currentNodes.find(candidate =>
          candidate.bcSourceNode === item.node.id && candidate.bcGenerated === true
        );
        if (output) {
          completed++;
        } else {
          const partial = currentNodes.find(candidate =>
            candidate.bcSourceNode === item.node.id && candidate.bcStopped === true
          );
          if (partial) {
            stopped = true;
            break;
          }
          failed++;
        }
        new Notice(t("PDF batch OCR progress: " + (index + 1) + " / " + pageNodes.length, "PDF 批量 OCR 进度：" + (index + 1) + " / " + pageNodes.length), 1800);
      }

      const skipped = pages.length - completed - failed;
      const state = stopped ? t("Stopped", "已停止") : t("Completed", "完成");
      patchNode(canvas, task.id, {
        text: t("PDF batch OCR task\n\nSource file: ", "PDF 批量 OCR 任务\n\n源文件：") + file.path +
          t("\nPages: ", "\n页码：") + pages.join(", ") +
          t("\nStatus: ", "\n状态：") + state +
          t("\nSucceeded: ", "\n成功：") + completed + t(" pages\nFailed: ", " 页\n失败：") + failed + t(" pages\nNot processed: ", " 页\n未处理：") + skipped + t(" pages", " 页"),
        bcPdfOcrBatchState: stopped ? "stopped" : "completed",
        bcPdfOcrBatchCompleted: completed,
        bcPdfOcrBatchFailed: failed
      });
      new Notice(t("PDF batch OCR " + state.toLowerCase() + ": " + completed + " succeeded, " + failed + " failed, " + skipped + " not processed.", "PDF 批量 OCR " + state + "：成功 " + completed + " 页，失败 " + failed + " 页，未处理 " + skipped + " 页。"), 6000);
    } catch (error) {
      preparationNotice.hide();
      new Notice(t("Could not start PDF batch OCR: ", "无法启动 PDF 批量 OCR：") + (error instanceof Error ? error.message : String(error)), 8000);
    }
  }

  private createPdfReviewBoard(): void {
    const selection = this.selected();
    if (!selection) return;
    if (selection.node.type !== "file" || !String(selection.node.file ?? "").toLowerCase().endsWith(".pdf")) {
      new Notice(t("Select a PDF file node.", "请选择一个 PDF 文件节点。"));
      return;
    }
    this.input(t("Create PDF page annotation board", "创建 PDF 分页批注工作区"), t("Enter the page count (1 to 30)", "输入页数（1 至 30）"), value => {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 30) { new Notice(t("Enter an integer from 1 to 30.", "请输入 1 至 30 的整数。")); return; }
      const { canvas, node } = selection;
      for (let page = 1; page <= count; page++) {
        const pageNode: CanvasNodeData = {
          id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
          type: "file",
          file: String(node.file),
          subpath: pinnedPdfSubpath(page),
          pinned: true,
          x: node.x + node.width + 100,
          y: node.y + (page - 1) * 300,
          width: 340,
          height: 250
        };
        insertCanvasNode(canvas, pageNode, node.id);
        const annotationNode = makeTextNode(t("Page ", "第 ") + page + t(" annotations\n\n- Key points:\n- Questions:\n- Next actions:", " 页批注\n\n- 关键内容：\n- 疑问：\n- 后续行动："),
          pageNode.x + pageNode.width + 50, pageNode.y, { width: 300, height: 230 });
        insertCanvasNode(canvas, annotationNode, pageNode.id);
      }
      new Notice(t("Created " + count + " pinned page renders with matching annotation nodes. Annotations still live in connected text nodes; drawing marks directly on PDF page images is not supported yet.", "已创建 " + count + " 个固定渲染页面和对应批注节点。页面批注仍以关联文本节点为主，尚不支持在 PDF 页图上直接绘制标记。"));
    }, "10");
  }
  private splitPdfPages(): void {
    const selection = this.selected();
    if (!selection) return;
    if (selection.node.type !== "file" || !String(selection.node.file ?? "").toLowerCase().endsWith(".pdf")) {
      new Notice(t("Select a PDF file node.", "请选择一个 PDF 文件节点。")); return;
    }
    this.input(t("Split PDF pages", "拆分 PDF 页面"), t("Enter the number of pages to create (max 30)", "输入要创建的页面数（最多 30）"), value => {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 30) return new Notice(t("Enter an integer from 1 to 30.", "请输入 1 至 30 的整数。"));
      for (let page = 1; page <= count; page++) {
        const node: CanvasNodeData = {
          id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
          type: "file",
          file: String(selection.node.file),
          subpath: pinnedPdfSubpath(page),
          pinned: true,
          x: selection.node.x + selection.node.width + 100,
          y: selection.node.y + (page - 1) * 260,
          width: 320,
          height: 240
        };
        insertCanvasNode(selection.canvas, node, selection.node.id);
      }
      new Notice(t("Created " + count + " pinned PDF page nodes.", "已创建 " + count + " 个固定渲染的 PDF 页面节点。"));
    }, "10");
  }

  private syncAutoEdges(canvas: CanvasRuntime, canvasFile: TFile): void {
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) return;
    const s = this.settings();
    if (!s.autoFileNodeEdgesEnabled) return;
    const data = readCanvasData(canvas);
    const prefix = "bc-auto-";
    const keep = data.edges.filter((edge: CanvasEdgeData) => !String(edge.id).startsWith(prefix));
    const fileNodes = data.nodes.filter((node): node is CanvasNodeData & { file: string } =>
      node.type === "file" && typeof node.file === "string"
    );
    const generated = buildAutoFileNodeEdges(
      fileNodes.map(node => ({ id: node.id, file: node.file })),
      filePath => {
        const file = this.p.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return undefined;
        return this.p.app.metadataCache.getFileCache(file)?.frontmatter?.[s.autoEdgesFrontmatterKey || "canvas-edges"];
      },
      targetPath => this.p.app.metadataCache.getFirstLinkpathDest(targetPath, canvasFile.path)?.path
    );
    const edges = [...keep, ...generated];
    if (JSON.stringify(edges) === JSON.stringify(data.edges)) return;
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }

  private refreshAutoEdges(): void {
    if (!this.settings().autoFileNodeEdgesEnabled) return;
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = isCanvasViewRuntime(leaf.view) ? leaf.view : null
      if (view?.canvas && view?.file) this.syncAutoEdges(view.canvas, view.file);
    }
  }

  private registerMarkdownNodeEmbeds(): void {
    this.p.registerMarkdownPostProcessor((element: HTMLElement, context: MarkdownPostProcessorContext) =>
      this.renderCanvasNodeReferences(element, context));
  }

  private async renderCanvasNodeReferences(element: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> {
    const items = Array.from(element.querySelectorAll<HTMLElement>(".internal-link, .internal-embed"));
    for (const item of items) {
      const raw = item.getAttribute("data-href") || item.getAttribute("href") || "";
      const match = raw.match(/^(.+?\.canvas)#([^#]+)$/i);
      if (!match) continue;
      const file = this.p.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(match[1]), context.sourcePath);
      if (!(file instanceof TFile) || file.extension !== "canvas") continue;
      try {
        const json = parseUnknownJson(await this.p.app.vault.cachedRead(file));
        const node = isCanvasData(json) ? json.nodes.find(item => item.id === decodeURIComponent(match[2])) : undefined;
        if (!node) continue;
        const body = String(node.text ?? node.file ?? node.url ?? "");
        if (item.classList.contains("internal-embed")) {
          const preview = item.ownerDocument.win.createDiv();
          preview.className = "better-canvas-node-embed";
          preview.dataset.source = file.path + "#" + node.id;
          item.replaceWith(preview);
          if (node.type === "text") {
            const renderChild = new MarkdownRenderChild(preview);
            context.addChild(renderChild);
            await MarkdownRenderer.render(this.p.app, body, preview, context.sourcePath, renderChild);
          } else if (node.type === "link" && typeof node.url === "string") {
            try {
              const url = new URL(node.url);
              if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported URL protocol");
              const anchor = preview.createEl("a", {
                text: node.url,
                href: url.toString(),
                attr: { target: "_blank", rel: "noopener noreferrer" }
              });
              anchor.setAttribute("aria-label", t("Open linked website", "打开链接网页"));
            } catch {
              preview.createEl("p", { text: node.url });
            }
          } else if (node.type === "file" && typeof node.file === "string") {
            const embeddedFile = this.p.app.vault.getAbstractFileByPath(node.file);
            if (!(embeddedFile instanceof TFile)) {
              preview.createEl("p", { text: node.file });
            } else {
              const ext = embeddedFile.extension.toLowerCase();
              if (ext === "md" || ext === "markdown") {
                const markdown = await this.p.app.vault.cachedRead(embeddedFile);
                const renderChild = new MarkdownRenderChild(preview);
                context.addChild(renderChild);
                await MarkdownRenderer.render(this.p.app, markdown, preview, embeddedFile.path, renderChild);
              } else if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) {
                const image = preview.createEl("img", {
                  attr: { src: this.p.app.vault.getResourcePath(embeddedFile), alt: embeddedFile.basename, loading: "lazy" }
                });
                image.classList.add("bc-media-embed-image");
              } else if (["mp3", "wav", "m4a", "ogg", "flac", "mp4", "webm", "mov"].includes(ext)) {
                const isVideo = ["mp4", "webm", "mov"].includes(ext);
                const media = preview.ownerDocument.win.createEl(isVideo ? "video" : "audio");
                media.controls = true;
                media.preload = "none";
                media.src = this.p.app.vault.getResourcePath(embeddedFile);
                media.classList.add(isVideo ? "bc-media-embed-video" : "bc-media-embed-audio");
                preview.appendChild(media);
              } else {
                const anchor = preview.createEl("a", { text: embeddedFile.path, href: "#" });
                anchor.addEventListener("click", event => {
                  event.preventDefault();
                  void this.p.app.workspace.openLinkText(embeddedFile.path, context.sourcePath, false);
                });
              }
            }
          } else {
            preview.createEl("p", { text: typeof node.label === "string" ? node.label : body });
          }
        } else {
          item.textContent = body.split("\n")[0] || file.basename;
          item.setAttribute("title", body.slice(0, 500));
        }
      } catch (error) {
        console.warn("Better Canvas node embed failed", error);
      }
    }
  }
}
