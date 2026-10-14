import {
  App,
  ItemView,
  Modal,
  MarkdownPostProcessorContext,
  MarkdownRenderer,
  Notice,
  PluginSettingTab,
  Setting,
  SuggestModal,
  TFile
} from "obsidian";
import { toPng, toSvg } from "html-to-image";
import { AIProtocol, chatCompletion, chatCompletionStream, generateImage, ChatMessageContent } from "./ai";
import { readCanvasData, makeTextNode, insertCanvasNode, CanvasNodeData } from "./canvas";
import {
  colorIncidentEdges,
  decorateCanvas,
  flipIncidentEdges,
  moveSelectionEdgesToTop,
  patchNode,
  reorderNode,
  resizeNodeToText,
  styleSelectedEdges,
  styleSelectedEdgeArrow,
  toggleGroupCollapse
} from "./enhancements";
import { retrieveWebpage, retrieveYouTubeTranscript } from "./web";
import { callRemoteTool, listRemoteTools } from "./mcp";
import { CanvasMetadataIndexer } from "./canvas-metadata";
import { PinnedPdfPageRenderer, pinnedPdfSubpath } from "./pdf-pages";

interface ProviderProfile {
  id: string;
  protocol?: AIProtocol;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
}

interface FeatureSettings {
  providerProfiles: ProviderProfile[];
  activeProviderId: string;
  autoFileNodeEdgesEnabled: boolean;
  autoEdgesFrontmatterKey: string;
  customColors: string[];
  youtubeLanguage: string;
  gridSize: number;
  defaultNodeWidth: number;
  defaultNodeHeight: number;
  mcpEndpoint: string;
  mcpApiKey: string;
  canvasMetadataEnabled: boolean;
}

const DEFAULT_PROFILES: ProviderProfile[] = [{
  id: "default",
  protocol: "openai",
  name: "Default / OpenAI compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  imageModel: "gpt-image-1"
}];

class FeaturePromptModal extends Modal {
  constructor(
    app: App,
    private titleText: string,
    private placeholderText: string,
    private onSubmitValue: (value: string) => unknown,
    private initialValue = ""
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.titleText });
    const input = this.contentEl.createEl("textarea", {
      attr: { rows: "5", placeholder: this.placeholderText }
    });
    input.value = this.initialValue;
    input.style.width = "100%";
    input.style.resize = "vertical";
    const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
    const submit = footer.createEl("button", { text: "提交", cls: "mod-cta" });
    submit.onclick = () => {
      const value = input.value.trim();
      this.close();
      if (value) void this.onSubmitValue(value);
    };
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

export default class BetterCanvasFeatures {
  private focusedCanvases = new Map<any, string>();
  private paletteStyle: HTMLStyleElement | null = null;
  private customCssStyle: HTMLStyleElement | null = null;
  private boundContainers = new WeakSet<HTMLElement>();
  private resizeObservers = new WeakSet<HTMLElement>();
  private activeGenerations = new Map<any, { controller: AbortController; nodeId: string }>();
  private metadataIndexer: CanvasMetadataIndexer | null = null;
  private pdfPageRenderer: PinnedPdfPageRenderer | null = null;
  private p: any;

  constructor(plugin: any) {
    this.p = plugin;
  }

  init(): void {
    this.migrateSettings();
    this.metadataIndexer = new CanvasMetadataIndexer(this.p.app, this.p, () => Boolean(this.settings().canvasMetadataEnabled));
    this.metadataIndexer.start();
    this.pdfPageRenderer = new PinnedPdfPageRenderer(this.p);
    this.pdfPageRenderer.start();
    this.p.register(() => this.cleanup());
    this.registerCommands();
    this.registerCanvasMenus();
    this.registerMarkdownNodeEmbeds();
    this.p.addSettingTab(new BetterCanvasFeatureSettingsTab(this.p.app, this.p, this));
    this.p.registerEvent(this.p.app.workspace.on("layout-change", () => this.refresh()));
    this.p.registerEvent(this.p.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.p.registerEvent(this.p.app.metadataCache.on("changed", () => this.refreshAutoEdges()));
    this.p.app.workspace.onLayoutReady(() => this.refresh());
  }

  settings(): any {
    return this.p.settings as any;
  }

  async save(): Promise<void> {
    await this.p.saveSettings();
  }

  refreshMetadataCache(): void {
    this.metadataIndexer?.refreshAll();
  }

  private cleanup(): void {
    for (const active of this.activeGenerations.values()) active.controller.abort();
    this.activeGenerations.clear();
    this.paletteStyle?.remove();
    this.paletteStyle = null;
    this.customCssStyle?.remove();
    this.customCssStyle = null;
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
        imageModel: s.imageModel || "gpt-image-1"
      }];
    }
    s.providerProfiles = s.providerProfiles.filter((p: any) => p && typeof p.id === "string" && typeof p.baseUrl === "string");
    if (!s.providerProfiles.length) s.providerProfiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
    if (!s.providerProfiles.some((p: ProviderProfile) => p.id === s.activeProviderId)) {
      s.activeProviderId = s.providerProfiles[0].id;
    }
    if (typeof s.autoFileNodeEdgesEnabled !== "boolean") s.autoFileNodeEdgesEnabled = true;
    if (typeof s.autoEdgesFrontmatterKey !== "string") s.autoEdgesFrontmatterKey = "canvas-edges";
    if (!Array.isArray(s.customColors)) s.customColors = ["#d14d41", "#438c7a", "#5c6bc0"];
    if (typeof s.youtubeLanguage !== "string") s.youtubeLanguage = "en";
    if (!Number.isFinite(s.gridSize) || s.gridSize < 1 || s.gridSize > 500) s.gridSize = 20;
    if (!Number.isFinite(s.defaultNodeWidth) || s.defaultNodeWidth < 120 || s.defaultNodeWidth > 1200) s.defaultNodeWidth = 280;
    if (!Number.isFinite(s.defaultNodeHeight) || s.defaultNodeHeight < 80 || s.defaultNodeHeight > 1000) s.defaultNodeHeight = 140;
    if (typeof s.mcpEndpoint !== "string") s.mcpEndpoint = "";
    if (typeof s.mcpApiKey !== "string") s.mcpApiKey = "";
    if (typeof s.canvasMetadataEnabled !== "boolean") s.canvasMetadataEnabled = true;
    if (typeof s.customCss !== "string") s.customCss = "";
    void this.save();
  }

  private currentProvider(node?: CanvasNodeData): ProviderProfile {
    const s = this.settings() as FeatureSettings & any;
    const preferredId = typeof (node as any)?.bcAIProvider === "string"
      ? String((node as any).bcAIProvider)
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

  private aiSettings(node?: CanvasNodeData, modelOverride?: string): any {
    const s = this.settings();
    const profile = this.currentProvider(node);
    return {
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: modelOverride || (typeof (node as any)?.bcAIModel === "string" ? String((node as any).bcAIModel) : profile.model),
      imageModel: profile.imageModel,
      protocol: profile.protocol || "openai",
      systemPrompt: s.systemPrompt || "Answer accurately and preserve uncertainty."
    };
  }

  private activeCanvasView(): any | null {
    const view = this.p.app.workspace.getActiveViewOfType(ItemView) as any;
    return view?.getViewType?.() === "canvas" && view.canvas ? view : null;
  }

  private canvas(): any | null {
    return this.activeCanvasView()?.canvas ?? null;
  }

  private selected(canvas = this.canvas()): { canvas: any; node: CanvasNodeData } | null {
    if (!canvas) {
      new Notice("请先打开一个 Canvas。");
      return null;
    }
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先运行“切换 Canvas 只读模式”解除锁定。");
      return null;
    }
    const selection = canvas.selection;
    if (!selection || selection.size !== 1) {
      new Notice("请在画布中只选择一个节点。");
      return null;
    }
    const internal = selection.values().next().value;
    if (!internal?.id || !canvas.nodes?.has?.(internal.id)) {
      new Notice("当前选中对象不是节点。");
      return null;
    }
    const node = readCanvasData(canvas).nodes.find((item: CanvasNodeData) => item.id === internal.id);
    if (!node) {
      new Notice("无法读取所选节点数据。");
      return null;
    }
    return { canvas, node };
  }

  private selectNode(canvas: any, id: string): void {
    const node = canvas?.nodes?.get?.(id);
    if (!node) return;
    canvas.selectOnly?.(node);
    canvas.zoomToSelection?.();
  }

  private input(title: string, placeholder: string, cb: (value: string) => unknown, initial = ""): void {
    new FeaturePromptModal(this.p.app, title, placeholder, cb, initial).open();
  }

  private registerCommands(): void {
    const add = (id: string, name: string, callback: () => void) =>
      this.p.addCommand({ id, name: "Better Canvas: " + name, callback });

    add("bc-set-node-color", "设置节点颜色", () => this.setNodeColor());
    add("bc-set-node-shape", "设置节点形状", () => this.setNodeShape());
    add("bc-set-node-border", "设置节点边框样式", () => this.setNodeBorder());
    add("bc-set-node-text-align", "设置所选节点文字对齐", () => this.setNodeTextAlign());
    add("bc-set-node-class", "设置节点自定义样式类", () => this.setNodeCustomClass());
    add("bc-set-edge-arrow", "设置所选连线箭头样式", () => this.edgeArrowStyle());
    add("bc-resize-node", "根据文字自动调整节点尺寸", () => this.resizeNode());
    add("bc-toggle-auto-resize", "切换所选节点自动调整尺寸", () => this.toggleAutoResize());
    add("bc-set-zoom-breakpoint", "设置所选节点缩放断点", () => this.setZoomBreakpoint());
    add("bc-flip-edges", "翻转节点关联的连线", () => this.flipEdges());
    add("bc-color-edges", "设置节点关联连线颜色", () => this.colorEdges());
    add("bc-select-edges", "选择节点关联的连线", () => this.selectEdges("all"));
    add("bc-select-incoming-edges", "选择指向节点的连线", () => this.selectEdges("incoming"));
    add("bc-select-outgoing-edges", "选择从节点发出的连线", () => this.selectEdges("outgoing"));
    add("bc-style-selected-edges", "设置当前选中连线样式", () => this.edgeStyle());
    add("bc-front-node", "将节点置于最前", () => this.reorder(true));
    add("bc-align-selection-grid", "将所选节点对齐到网格", () => this.alignSelectionToGrid());
    add("bc-toggle-readonly", "切换 Canvas 只读模式", () => this.toggleReadonly());
    add("bc-back-node", "将节点置于最后", () => this.reorder(false));
    add("bc-focus", "切换专注模式", () => this.focus());
    add("bc-collapse-group", "折叠/展开所选分组", () => this.collapseGroup());
    add("bc-encapsulate", "将选区移动到新 Canvas", () => void this.encapsulate());
    add("bc-copy-node-link", "复制节点 Wikilink", () => void this.copyNodeLink());
    add("bc-export-json", "导出 Canvas JSON", () => void this.export("canvas"));
    add("bc-export-png", "导出 Canvas PNG", () => void this.export("png"));
    add("bc-export-svg", "导出 Canvas SVG", () => void this.export("svg"));
    add("bc-ingest-web", "导入网页正文", () => this.input("导入网页正文", "完整 URL", value => void this.ingest(value, false)));
    add("bc-ingest-youtube", "导入 YouTube 字幕", () => this.input("导入 YouTube 字幕", "YouTube 视频 URL", value => void this.ingest(value, true)));
    add("bc-set-node-provider", "为节点指定 AI 供应商", () => this.setNodeProvider());
    add("bc-set-node-model", "为节点指定 AI 模型", () => this.setNodeModel());
    add("bc-ask-custom-model", "指定模型并向 AI 提问", () => this.askWithModel());
    add("bc-test-provider", "测试当前 AI 供应商连接", () => void this.testProvider());
    add("bc-related-questions", "生成后续研究问题节点", () => void this.generateRelatedQuestions());
    add("bc-generate-title", "生成节点标题或分组名称", () => void this.generateTitleOrGroupName());
    add("bc-expand-idea-mindmap", "用 AI 将想法扩展为思维导图", () => this.expandIdeaIntoMindMap());
    add("bc-generate-flashcard-nodes", "生成独立复习闪卡节点", () => this.generateFlashcardNodes());
    add("bc-generate-image", "根据所选节点生成图片", () => void this.generateImageForNode());
    add("bc-regenerate", "重新生成所选 AI 节点", () => void this.regenerate());
    add("bc-stop-ai", "停止当前 AI 生成", () => this.stopAI());
    add("bc-mcp-tool", "调用远程 MCP 工具", () => void this.runMcpTool());
    add("bc-pdf-pages", "将 PDF 节点拆分为分页卡片", () => this.splitPdfPages());
    add("bc-pdf-review-board", "为 PDF 创建分页批注工作区", () => this.createPdfReviewBoard());
    add("bc-create-canvas-portal", "插入 Canvas 嵌入卡片", () => this.createCanvasPortal());
  }

  private registerCanvasMenus(): void {
    const workspace = this.p.app.workspace as any;
    const nodeMenu = workspace.on("canvas:node-menu", (menu: any, node: any) => {
      if (!menu?.addItem || !node?.id) return;
      const actions: Array<[string, string, () => void]> = [
        ["设置节点形状", "shapes", () => this.setNodeShape()],
        ["设置节点文字对齐", "align-center", () => this.setNodeTextAlign()],
        ["设置节点颜色", "palette", () => this.setNodeColor()],
        ["复制节点 Wikilink", "link", () => void this.copyNodeLink()],
        ["翻转关联连线", "git-compare", () => this.flipEdges()],
        ["切换专注模式", "focus", () => this.focus()],
        ["将节点置于最前", "layers", () => this.reorder(true)],
        ["将节点置于最后", "layers-2", () => this.reorder(false)],
        ["重新生成 AI 节点", "rotate-cw", () => void this.regenerate()]
      ];
      for (const action of actions) {
        menu.addItem((item: any) => item.setTitle("Better Canvas: " + action[0]).setIcon(action[1]).onClick(() => {
          this.selectNode(this.canvas(), String(node.id));
          action[2]();
        }));
      }
    });
    this.p.registerEvent(nodeMenu);

    const selectionMenu = workspace.on("canvas:selection-menu", (menu: any, canvas: any) => {
      if (!menu?.addItem || !canvas) return;
      menu.addItem((item: any) => item.setTitle("Better Canvas: 选择关联连线").setIcon("git-branch").onClick(() => this.selectEdges("all", canvas)));
      menu.addItem((item: any) => item.setTitle("Better Canvas: 封装选区").setIcon("file-plus").onClick(() => void this.encapsulate(canvas)));
      menu.addItem((item: any) => item.setTitle("Better Canvas: 设置连线样式").setIcon("palette").onClick(() => this.edgeStyle(canvas)));
    });
    this.p.registerEvent(selectionMenu);
  }

  private refresh(): void {
    this.applyPalette();
    this.applyUserCss();
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view as any;
      if (!view?.canvas) continue;
      this.observeAutoResize(view, view.canvas);
      this.bindMindMapShortcuts(view, view.canvas);
      this.decorate(view.canvas);
      this.applyZoomBreakpoints(view.canvas);
      this.applyFocus(view.canvas);
      if (view.file) this.syncAutoEdges(view.canvas, view.file);
    }
  }

  private decorate(canvas: any): void {
    decorateCanvas(canvas);
    const data = readCanvasData(canvas);
    for (const item of data.nodes) {
      const node = canvas.nodes?.get?.(item.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (!(element instanceof HTMLElement)) continue;
      if (typeof (item as any).bcNodeColor === "string") element.style.borderColor = String((item as any).bcNodeColor);
      element.dataset.bcShape = typeof (item as any).bcShape === "string" ? String((item as any).bcShape) : "default";
      element.dataset.bcBorder = typeof (item as any).bcBorderStyle === "string" ? String((item as any).bcBorderStyle) : "solid";
      const previousClass = element.dataset.bcCustomClass;
      if (previousClass) element.classList.remove("bc-user-" + previousClass);
      const nextClass = typeof (item as any).bcCustomClass === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(String((item as any).bcCustomClass))
        ? String((item as any).bcCustomClass) : "";
      if (nextClass) element.classList.add("bc-user-" + nextClass);
      element.dataset.bcCustomClass = nextClass;
    }
    this.applyFocus(canvas);
  }

  applyUserCss(): void {
    this.customCssStyle?.remove();
    const css = String(this.settings().customCss ?? "");
    if (!css.trim()) { this.customCssStyle = null; return; }
    this.customCssStyle = document.createElement("style");
    this.customCssStyle.dataset.owner = "obsidian-better-canvas";
    this.customCssStyle.textContent = css;
    document.head.appendChild(this.customCssStyle);
  }
  private applyPalette(): void {
    this.paletteStyle?.remove();
    const s = this.settings();
    const colors = (Array.isArray(s.customColors) ? s.customColors : []).filter((color: string) => {
      const span = document.createElement("span");
      span.style.color = color;
      return Boolean(span.style.color);
    }).slice(0, 12);
    if (!colors.length) return;
    this.paletteStyle = document.createElement("style");
    this.paletteStyle.textContent = "body{" + colors.map((color: string, index: number) =>
      "--canvas-color-" + (7 + index) + ":" + color + ";"
    ).join("") + "}";
    document.head.appendChild(this.paletteStyle);
  }

  private setNodeColor(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点颜色", "例如 #5c6bc0", value => {
      const span = document.createElement("span");
      span.style.color = value;
      if (!span.style.color) {
        new Notice("无法识别颜色。");
        return;
      }
      patchNode(selection.canvas, selection.node.id, { color: span.style.color, bcNodeColor: span.style.color });
      this.decorate(selection.canvas);
    });
  }

  private setNodeShape(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点形状", "default / pill / ellipse / diamond / parallelogram / hexagon / pentagon / octagon / triangle / trapezoid / chevron / cloud", value => {
      const shape = value.toLowerCase();
      if (!["default", "pill", "ellipse", "diamond", "parallelogram", "hexagon", "pentagon", "octagon", "triangle", "trapezoid", "chevron", "cloud"].includes(shape)) {
        new Notice("形状无效。");
        return;
      }
      patchNode(selection.canvas, selection.node.id, { bcShape: shape });
      this.decorate(selection.canvas);
    });
  }

  private setNodeBorder(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点边框", "solid / dashed / dotted / double", value => {
      const style = value.toLowerCase();
      if (!["solid", "dashed", "dotted", "double"].includes(style)) {
        new Notice("边框样式无效。");
        return;
      }
      patchNode(selection.canvas, selection.node.id, { bcBorderStyle: style });
      this.decorate(selection.canvas);
    });
  }

  private makeConfiguredTextNode(text: string, x: number, y: number, height?: number): CanvasNodeData {
    const settings = this.settings();
    const width = Number(settings.defaultNodeWidth) || 280;
    const defaultHeight = Number(settings.defaultNodeHeight) || 140;
    return makeTextNode(text, x, y, { width, height: height ?? defaultHeight });
  }
  private setZoomBreakpoint(): void {
    const selected = this.selected();
    if (!selected) return;
    this.input("设置缩放断点", "输入缩放比例（例如 0.6）；输入 off 清除", value => {
      if (value.trim().toLowerCase() === "off") {
        patchNode(selected.canvas, selected.node.id, { bcZoomBreakpoint: null });
        this.applyZoomBreakpoints(selected.canvas);
        new Notice("已清除节点缩放断点。");
        return;
      }
      const breakpoint = Number(value);
      if (!Number.isFinite(breakpoint) || breakpoint < 0.05 || breakpoint > 5) {
        new Notice("请输入 0.05 到 5 之间的缩放比例，或输入 off。");
        return;
      }
      patchNode(selected.canvas, selected.node.id, { bcZoomBreakpoint: breakpoint });
      this.applyZoomBreakpoints(selected.canvas);
      new Notice("已设置缩放断点：" + breakpoint);
    }, typeof (selected.node as any).bcZoomBreakpoint === "number" ? String((selected.node as any).bcZoomBreakpoint) : "off");
  }

  private applyZoomBreakpoints(canvas: any): void {
    const zoom = Number(canvas?.zoom);
    if (!Number.isFinite(zoom)) return;
    for (const nodeData of readCanvasData(canvas).nodes) {
      const node = canvas?.nodes?.get?.(nodeData.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (!(element instanceof HTMLElement)) continue;
      const stored = (nodeData as any).bcZoomBreakpoint;
      const cssValue = window.getComputedStyle(element).getPropertyValue("--variable-breakpoint").trim();
      const cssBreakpoint = cssValue ? Number.parseFloat(cssValue) : NaN;
      const breakpoint = typeof stored === "number" && Number.isFinite(stored) ? stored : cssBreakpoint;
      if (!Number.isFinite(breakpoint)) {
        delete element.dataset.bcBreakpointHidden;
        continue;
      }
      element.dataset.bcBreakpointHidden = String(zoom <= breakpoint);
    }
  }
  private setNodeCustomClass(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点自定义样式类", "输入 class 名（字母、数字、下划线和连字符）；留空可清除", value => {
      const token = value.trim();
      if (token && !/^[a-zA-Z0-9_-]{1,50}$/.test(token)) {
        new Notice("class 名只能包含字母、数字、下划线和连字符（最多 50 个字符）。");
        return;
      }
      patchNode(selection.canvas, selection.node.id, { bcCustomClass: token || undefined });
      this.decorate(selection.canvas);
      new Notice(token ? "已应用样式类 bc-user-" + token : "已清除节点自定义样式类。");
    }, String((selection.node as any).bcCustomClass ?? ""));
  }
  private setNodeTextAlign(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点文字对齐", "left / center / right / justify", value => {
      const align = value.trim().toLowerCase();
      if (!["left", "center", "right", "justify"].includes(align)) {
        new Notice("对齐方式无效。");
        return;
      }
      patchNode(selection.canvas, selection.node.id, { bcTextAlign: align });
      this.decorate(selection.canvas);
    }, String((selection.node as any).bcTextAlign ?? "left"));
  }

  private edgeArrowStyle(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开 Canvas。"); return; }
    this.input("设置连线箭头样式", "default / triangle-outline / half-triangle / thin-triangle / diamond / diamond-outline / circle / circle-outline / blunt / none", value => {
      const allowed = ["default", "triangle-outline", "half-triangle", "thin-triangle", "diamond", "diamond-outline", "circle", "circle-outline", "blunt", "none"];
      const style = value.trim().toLowerCase();
      if (!allowed.includes(style)) { new Notice("箭头样式无效。"); return; }
      const count = styleSelectedEdgeArrow(canvas, style as any);
      this.decorate(canvas);
      new Notice(count ? "已设置 " + count + " 条连线的箭头样式。" : "请先选择一条或多条连线。");
    }, "default");
  }
  private resizeNode(): void {
    const selection = this.selected();
    if (!selection) return;
    new Notice(resizeNodeToText(selection.canvas, selection.node.id) ? "已调整节点尺寸。" : "仅支持文本节点。");
  }

  private toggleAutoResize(): void {
    const selection = this.selected();
    if (!selection) return;
    const enabled = (selection.node as any).bcAutoResize !== true;
    patchNode(selection.canvas, selection.node.id, { bcAutoResize: enabled });
    if (enabled) resizeNodeToText(selection.canvas, selection.node.id);
    new Notice(enabled ? "此节点已启用自动尺寸。" : "此节点已关闭自动尺寸。");
  }

  private bindMindMapShortcuts(view: any, canvas: any): void {
    const container = view?.containerEl;
    if (!(container instanceof HTMLElement) || this.boundContainers.has(container)) return;
    this.boundContainers.add(container);

    this.p.registerDomEvent(container, "keydown", (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true'], .cm-editor"))) return;
      const selectedInternal = canvas?.selection?.values?.().next?.().value;
      if (!selectedInternal || selectedInternal.isEditing) return;
      const direction = event.key === "ArrowLeft" ? "left"
        : event.key === "ArrowRight" ? "right"
        : event.key === "ArrowUp" ? "up"
        : event.key === "ArrowDown" ? "down" : "";
      if (!direction || !(event.ctrlKey || event.metaKey)) return;
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
      const created = makeTextNode("", x, y, { width: node.width, height: node.height });
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

  private observeAutoResize(view: any, canvas: any): void {
    const container = view?.containerEl;
    if (!(container instanceof HTMLElement) || this.resizeObservers.has(container)) return;
    this.resizeObservers.add(container);
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        const data = readCanvasData(canvas);
        for (const node of data.nodes) {
          if (node.type === "text" && (node as any).bcAutoResize === true) {
            resizeNodeToText(canvas, node.id);
          }
        }
        this.applyZoomBreakpoints(canvas);
      }, 220);
    });
    observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "transform", "class"] });
    this.p.register(() => observer.disconnect());
  }

  private flipEdges(): void {
    const selection = this.selected();
    if (!selection) return;
    const count = flipIncidentEdges(selection.canvas, selection.node.id);
    new Notice(count ? "已翻转 " + count + " 条连线。" : "此节点没有关联连线。");
  }

  private colorEdges(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置连线颜色", "例如 #5c6bc0", value => {
      const span = document.createElement("span");
      span.style.color = value;
      if (!span.style.color) {
        new Notice("无法识别颜色。");
        return;
      }
      const count = colorIncidentEdges(selection.canvas, selection.node.id, span.style.color);
      this.decorate(selection.canvas);
      new Notice("已设置 " + count + " 条连线颜色。");
    });
  }

  private edgeStyle(canvas = this.canvas()): void {
    if (!canvas) return;
    this.input("设置选中连线样式", "颜色,solid|dashed|dotted，例如 #5c6bc0,dashed", value => {
      const parts = value.split(",");
      const color = (parts[0] ?? "").trim();
      const style = (parts[1] ?? "solid").trim().toLowerCase();
      const span = document.createElement("span");
      span.style.color = color;
      if (!span.style.color || !["solid", "dashed", "dotted"].includes(style)) {
        new Notice("格式无效。");
        return;
      }
      const count = styleSelectedEdges(canvas, span.style.color, style as "solid" | "dashed" | "dotted");
      this.decorate(canvas);
      new Notice(count ? "已更新 " + count + " 条连线。" : "请先选择连线。");
    });
  }

  private selectEdges(direction: "all" | "incoming" | "outgoing", canvas = this.canvas()): void {
    if (!canvas) return;
    const count = moveSelectionEdgesToTop(canvas, direction);
    new Notice(count ? "已选择 " + count + " 条连线。" : "没有匹配连线。");
  }

  private toggleReadonly(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开 Canvas。"); return; }
    const wrapper = canvas.wrapperEl as HTMLElement | undefined;
    if (!(wrapper instanceof HTMLElement)) { new Notice("无法获取 Canvas 容器。"); return; }
    const enabled = !wrapper.classList.contains("bc-readonly");
    wrapper.classList.toggle("bc-readonly", enabled);
    new Notice(enabled ? "已启用只读模式；节点不能被鼠标拖动或编辑。再次运行命令可解除。" : "已退出只读模式。");
  }
  private alignSelectionToGrid(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开 Canvas。"); return; }
    const selection = canvas.selection;
    const ids = new Set<string>();
    for (const item of selection?.values?.() ?? []) {
      const id = item?.id ?? item?.getData?.()?.id;
      if (typeof id === "string" && canvas.nodes?.has?.(id)) ids.add(id);
    }
    if (!ids.size) { new Notice("请先选择一个或多个节点。"); return; }
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
    new Notice("已将 " + ids.size + " 个节点对齐到 " + step + " px 网格。");
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
      new Notice("已退出专注模式。");
    } else {
      this.focusedCanvases.set(canvas, selection.node.id);
      new Notice("已聚焦所选节点及其直接关联节点。");
    }
    this.applyFocus(canvas);
  }

  private applyFocus(canvas: any): void {
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
      const path = edge?.path?.display ?? edge?.path?.el ?? edge?.path;
      const related = Boolean(root) && (edgeData.fromNode === root || edgeData.toNode === root);
      if (path instanceof SVGElement) path.classList.toggle("bc-focus-dimmed", Boolean(root) && !related);
    }
  }

  private collapseGroup(): void {
    const selection = this.selected();
    if (!selection) return;
    const state = toggleGroupCollapse(selection.canvas, selection.node.id);
    if (state === "not-group") new Notice("请选择分组节点。");
    else if (state === "collapsed") new Notice("分组内没有可折叠节点。");
    else if (state === "missing") new Notice("找不到节点。");
    else new Notice(state === "expanded" ? "已展开分组。" : "已折叠分组。");
    this.decorate(selection.canvas);
  }

  private async encapsulate(canvas = this.canvas()): Promise<void> {
    if (!canvas) {
      new Notice("请先打开 Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先解除只读模式再封装选区。");
      return;
    }
    const data = readCanvasData(canvas);
    const ids = new Set<string>();
    for (const item of canvas.selection?.values?.() ?? []) {
      if (item?.id && data.nodes.some((node: CanvasNodeData) => node.id === item.id)) ids.add(item.id);
    }
    const nodes = data.nodes.filter((node: CanvasNodeData) => ids.has(node.id));
    if (!nodes.length) {
      new Notice("请先选择要封装的节点。");
      return;
    }
    const edges = data.edges.filter((edge: any) => ids.has(edge.fromNode) && ids.has(edge.toNode));
    this.input("封装选区", "新 Canvas 文件名（不需要扩展名）", async name => {
      const base = name.replace(/[\\/:*?"<>|]/g, "-").trim();
      if (!base) return;
      const view = this.activeCanvasView();
      const folder = view?.file?.parent?.path ?? "";
      const pathBase = (folder ? folder + "/" : "") + base;
      const filePath = await this.uniquePath(pathBase, "canvas");
      const selectedCenterX = nodes.reduce((sum: number, node: CanvasNodeData) => sum + node.x + node.width / 2, 0) / nodes.length;
      const selectedCenterY = nodes.reduce((sum: number, node: CanvasNodeData) => sum + node.y + node.height / 2, 0) / nodes.length;
      await this.p.app.vault.create(filePath, JSON.stringify({ nodes, edges }, null, 2));
      const fileNode: CanvasNodeData = {
        id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
        type: "file",
        file: filePath,
        x: selectedCenterX - 150,
        y: selectedCenterY - 100,
        width: 300,
        height: 200
      };
      canvas.importData({
        ...data,
        nodes: [...data.nodes.filter((node: CanvasNodeData) => !ids.has(node.id)), fileNode],
        edges: data.edges.filter((edge: any) => !ids.has(edge.fromNode) && !ids.has(edge.toNode))
      });
      canvas.requestSave?.();
      canvas.requestFrame?.();
      new Notice("选区已移动到 " + filePath);
    });
  }

  private async copyNodeLink(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    const file = this.activeCanvasView()?.file;
    if (!(file instanceof TFile)) return;
    const link = "[[" + file.path + "#" + selection.node.id + "]]";
    try {
      await navigator.clipboard.writeText(link);
      new Notice("已复制节点 Wikilink。");
    } catch {
      this.input("节点 Wikilink", "请手动复制", () => {}, link);
    }
  }

  private async export(format: "canvas" | "png" | "svg"): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开 Canvas。"); return; }
    const view = this.activeCanvasView();
    const baseName = String(view?.file?.basename ?? "canvas").replace(/[\\/:*?"<>|]/g, "-");
    const folder = String(this.settings().attachmentFolder || "Better Canvas Exports").replace(/^\/+|\/+$/g, "");
    await this.ensureFolder(folder);
    if (format === "canvas") {
      const filePath = await this.uniquePath(folder + "/" + baseName + "-export", "canvas");
      await this.p.app.vault.create(filePath, JSON.stringify(readCanvasData(canvas), null, 2));
      new Notice("已导出 " + filePath);
      return;
    }
    const container = canvas.wrapperEl;
    if (!(container instanceof HTMLElement)) { new Notice("无法获取 Canvas DOM。"); return; }
    const notice = new Notice("正在导出 " + format.toUpperCase() + "…", 0);
    try {
      const dataUrl = format === "png"
        ? await toPng(container, { cacheBust: true, pixelRatio: 2 })
        : await toSvg(container, { cacheBust: true });
      const filePath = await this.uniquePath(folder + "/" + baseName + "-export", format);
      const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
      if (format === "svg") {
        if (dataUrl.includes(";base64,")) {
          const binary = atob(payload);
          const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          await this.p.app.vault.create(filePath, new TextDecoder().decode(bytes));
        } else {
          await this.p.app.vault.create(filePath, decodeURIComponent(payload));
        }
      } else {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        await this.p.app.vault.createBinary(filePath, bytes.buffer as ArrayBuffer);
      }
      notice.hide();
      new Notice("已导出 " + filePath);
    } catch (error) {
      notice.hide();
      new Notice("导出失败：" + (error instanceof Error ? error.message : String(error)), 8000);
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
    if (!clean) throw new Error("输出目录不能为空。");
    let current = "";
    for (const part of clean.split("/")) {
      current = current ? current + "/" + part : part;
      if (!this.p.app.vault.getAbstractFileByPath(current)) await this.p.app.vault.createFolder(current);
    }
  }

  private async ingest(raw: string, youtube: boolean): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) {
      new Notice("请先打开 Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先解除只读模式再导入内容。");
      return;
    }
    const selection = this.selected(canvas);
    const notice = new Notice("正在读取来源内容…", 0);
    try {
      const page = youtube
        ? await retrieveYouTubeTranscript(raw, this.settings().youtubeLanguage || "en")
        : await retrieveWebpage(raw);
      const body = "# " + page.title + "\n\nSource: " + page.url + "\n\n" + page.text;
      const node = makeTextNode(body,
        selection ? selection.node.x + selection.node.width + 100 : 0,
        selection ? selection.node.y : 0,
        { width: 420, height: Math.max(220, Math.min(720, Math.ceil(body.length / 55) * 22)) });
      insertCanvasNode(canvas, node, selection?.node.id);
      notice.hide();
      new Notice((youtube ? "YouTube 字幕" : "网页正文") + "已导入。");
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private setNodeProvider(): void {
    const selection = this.selected();
    if (!selection) return;
    const s = this.settings();
    const choices = (s.providerProfiles as ProviderProfile[]).map(profile => profile.id + " — " + profile.name).join("\n");
    this.input("设置节点 AI 供应商", choices + "\n\n输入 profile id", value => {
      const profile = (s.providerProfiles as ProviderProfile[]).find(item => item.id === value.trim());
      if (!profile) return new Notice("没有匹配的 profile id。");
      patchNode(selection.canvas, selection.node.id, { bcAIProvider: profile.id });
      new Notice("节点供应商已设置为 " + profile.name);
    }, String((selection.node as any).bcAIProvider ?? s.activeProviderId));
  }

  private setNodeModel(): void {
    const selection = this.selected();
    if (!selection) return;
    this.input("设置节点 AI 模型", "输入模型名；留空恢复当前供应商默认模型", value => {
      patchNode(selection.canvas, selection.node.id, { bcAIModel: value.trim() || undefined });
      new Notice(value.trim() ? "节点模型已设置为 " + value.trim() : "已恢复供应商默认模型。");
    }, String((selection.node as any).bcAIModel ?? this.currentProvider(selection.node).model));
  }

  private askWithModel(): void {
    const selection = this.selected();
    if (!selection) return;
    const provider = this.currentProvider(selection.node);
    this.input("指定模型并提问", "模型名，例如 gpt-4o-mini", model => {
      this.input("向 AI 提问", "例如：总结笔记并指出不确定之处", question =>
        void this.runAI(selection.node.id, question, model), "");
    }, provider.model);
  }

  private async getNodeContext(canvas: any, rootId: string): Promise<string> {
    const data = readCanvasData(canvas);
    const root = data.nodes.find((node: CanvasNodeData) => node.id === rootId);
    if (!root) throw new Error("找不到所选节点。");
    const connected = new Set<string>([rootId]);
    for (const edge of data.edges) {
      if (edge.fromNode === rootId) connected.add(edge.toNode);
      if (edge.toNode === rootId) connected.add(edge.fromNode);
    }
    const sections: string[] = [];
    for (const id of connected) {
      const node = data.nodes.find((candidate: CanvasNodeData) => candidate.id === id);
      if (!node) continue;
      let body = String(node.text ?? node.file ?? node.url ?? "[" + node.type + " node]");
      if (node.type === "file" && node.file) {
        const file = this.p.app.vault.getAbstractFileByPath(node.file);
        if (file instanceof TFile && file.extension.toLowerCase() === "md") {
          try { body = await this.p.app.vault.cachedRead(file); } catch { /* retain file path */ }
        }
      }
      sections.push("[Node " + node.id + (id === rootId ? " — selected" : "") + "]\n" + body.slice(0, 3000));
    }
    return sections.join("\n\n--- Connected node ---\n\n").slice(0, 14000);
  }

  private async getConnectedImages(canvas: any, rootId: string): Promise<Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }>> {
    const data = readCanvasData(canvas);
    const ids = new Set<string>([rootId]);
    for (const edge of data.edges) {
      if (edge.fromNode === rootId) ids.add(edge.toNode);
      if (edge.toNode === rootId) ids.add(edge.fromNode);
    }
    const images: Array<{ type: "image_url"; image_url: { url: string; detail: "auto" } }> = [];
    for (const node of data.nodes) {
      if (!ids.has(node.id) || node.type !== "file" || !node.file) continue;
      const file = this.p.app.vault.getAbstractFileByPath(node.file);
      if (!(file instanceof TFile)) continue;
      const ext = file.extension.toLowerCase();
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

  private parseJsonPayload<T>(raw: string): T {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 没有返回有效 JSON。");
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }

  private async testProvider(): Promise<void> {
    const profile = this.currentProvider();
    const notice = new Notice("正在测试 " + profile.name + "…", 0);
    try {
      const response = await chatCompletion({ ...this.aiSettings(), model: profile.model }, [
        { role: "system", content: "You are a connectivity test. Reply with exactly: OK" },
        { role: "user", content: "Reply with exactly OK." }
      ]);
      notice.hide();
      new Notice("供应商响应成功：" + response.slice(0, 80));
    } catch (error) {
      notice.hide();
      new Notice("供应商测试失败：" + (error instanceof Error ? error.message : String(error)), 8000);
    }
  }

  private async generateTitleOrGroupName(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const notice = new Notice("正在生成标题建议…", 0);
    try {
      const data = readCanvasData(selected.canvas);
      const node = selected.node;
      let context = await this.getNodeContext(selected.canvas, node.id);
      if (node.type === "group") {
        const contained = data.nodes.filter((child: CanvasNodeData) => child.id !== node.id && child.x >= node.x && child.y >= node.y && child.x + child.width <= node.x + node.width && child.y + child.height <= node.y + node.height);
        context += "\n\nGroup contents:\n" + contained.map((child: CanvasNodeData) => String(child.text ?? child.file ?? child.url ?? child.type)).join("\n").slice(0, 6000);
      }
      const raw = await this.completeStructured("根据以下 Canvas 内容生成一个简短、具体的中文标题。只返回 JSON：{\"title\":\"...\"}。标题 4 至 24 个汉字或适当长度的短语；不要带引号和序号。\n\n" + context, node);
      const parsed = this.parseJsonPayload<{title?: string}>(raw);
      const title = typeof parsed.title === "string" ? parsed.title.trim().replace(/^["“”]+|["“”]+$/g, "") : "";
      if (!title) throw new Error("AI 没有返回有效标题。");
      if (node.type === "group") {
        patchNode(selected.canvas, node.id, { label: title, bcSuggestedGroupName: title });
        this.decorate(selected.canvas);
        notice.hide();
        new Notice("已将分组名称更新为：" + title);
      } else {
        const suggestion = this.makeConfiguredTextNode("标题建议\n" + title, node.x + node.width + 100, node.y);
        insertCanvasNode(selected.canvas, suggestion, node.id);
        notice.hide();
        new Notice("已创建标题建议节点；原节点内容未修改。");
      }
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }
  private async generateRelatedQuestions(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const notice = new Notice("正在生成后续研究问题…", 0);
    try {
      const context = await this.getNodeContext(selected.canvas, selected.node.id);
      const raw = await this.completeStructured(
        "根据以下笔记生成 5 个有差异的后续研究问题，只返回 JSON：{\"questions\":[\"问题 1\",\"问题 2\"]}。每个问题不超过 100 字；不要回答问题，不要重复。\n\n" + context,
        selected.node
      );
      const parsed = this.parseJsonPayload<{questions?: string[]}>(raw);
      const questions = Array.isArray(parsed.questions)
        ? [...new Set(parsed.questions.filter(question => typeof question === "string").map(question => question.trim()).filter(Boolean))].slice(0, 8)
        : [];
      if (!questions.length) throw new Error("AI 没有返回有效的问题列表。");
      for (let i = 0; i < questions.length; i++) {
        const defaultHeight = Number(this.settings().defaultNodeHeight) || 140;
        const node = this.makeConfiguredTextNode("研究问题：" + questions[i],
          selected.node.x + selected.node.width + 100, selected.node.y + i * (defaultHeight + 20));
        insertCanvasNode(selected.canvas, node, selected.node.id);
      }
      notice.hide();
      new Notice("已创建 " + questions.length + " 个后续研究问题节点。");
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

  private async expandIdeaIntoMindMap(): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开一个 Canvas。"); return; }
    const selected = this.selected(canvas);
    this.input("AI 扩展思维导图", "输入想法、主题或问题", async idea => {
      const notice = new Notice("正在生成思维导图结构…", 0);
      try {
        const context = selected ? await this.getNodeContext(canvas, selected.node.id) : "";
        const raw = await this.completeStructured(
          "将主题扩展成中文思维导图，返回 JSON：{\"nodes\":[{\"id\":\"n1\",\"parentId\":null,\"text\":\"...\"}]}. " +
          "最多 24 个节点；id 必须唯一；第一个节点是主题根节点并使用 parentId=null；每个后续节点的 parentId 指向已有节点；每个 text 不超过 180 字；" +
          "不确定的信息需标明，不得编造来源。主题：" + idea + (context ? "\n现有 Canvas 上下文：\n" + context : "") ,
          selected?.node
        );
        const parsed = this.parseJsonPayload<{nodes?: Array<{id?: string; parentId?: string | null; text?: string}>}>(raw);
        const items = Array.isArray(parsed.nodes) ? parsed.nodes.slice(0, 24) : [];
        if (!items.length) throw new Error("AI 返回的 nodes 为空。");
        const validItems = items.filter(item => typeof item.text === "string" && item.text.trim());
        if (!validItems.length) throw new Error("AI 没有提供有效的节点文本。");
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
            rootNode = this.makeConfiguredTextNode(String(item.text).trim(), baseX, baseY);
            insertCanvasNode(canvas, rootNode);
          }
          const itemId = String(item.id ?? "root");
          if (rootNode) idMap.set(itemId, rootNode);
        }
        if (!rootNode) throw new Error("无法创建思维导图根节点。");

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
        if (unresolved.length) new Notice("有 " + unresolved.length + " 个节点因 parentId 无效而跳过。");
        this.decorate(canvas);
        notice.hide();
        new Notice("已从主题创建思维导图（" + idMap.size + " 个节点）。");
      } catch (error) {
        notice.hide();
        new Notice(error instanceof Error ? error.message : String(error), 8000);
      }
    });
  }

  private async generateFlashcardNodes(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    const notice = new Notice("正在生成独立闪卡…", 0);
    try {
      const context = await this.getNodeContext(selected.canvas, selected.node.id);
      const raw = await this.completeStructured(
        "基于以下资料生成 5 至 10 张中文复习闪卡，只返回 JSON：{\"cards\":[{\"question\":\"...\",\"answer\":\"...\"}]}. " +
        "问题要能主动回忆，答案简洁可验证；不要补充资料中没有的事实。资料：\n" + context,
        selected.node
      );
      const parsed = this.parseJsonPayload<{cards?: Array<{question?: string; answer?: string}>}>(raw);
      const cards = Array.isArray(parsed.cards) ? parsed.cards.slice(0, 12).filter(card =>
        typeof card.question === "string" && Boolean(card.question.trim()) &&
        typeof card.answer === "string" && Boolean(card.answer.trim())) : [];
      if (!cards.length) throw new Error("AI 未返回有效的复习闪卡。");
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const text = "问题：" + card.question!.trim() + "\n\n答案：" + card.answer!.trim();
        const node = makeTextNode(text, selected.node.x + selected.node.width + 100,
          selected.node.y + i * 180, { width: 330, height: 150 });
        insertCanvasNode(selected.canvas, node, selected.node.id);
      }
      notice.hide();
      new Notice("已创建 " + cards.length + " 张独立复习闪卡节点。");
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }
  private async runAI(nodeId: string, instruction: string, modelOverride?: string, replaceNodeId?: string): Promise<void> {
    const canvas = this.canvas();
    if (!canvas) return;
    const data = readCanvasData(canvas);
    const source = data.nodes.find((node: CanvasNodeData) => node.id === nodeId);
    if (!source) {
      new Notice("找不到 AI 上下文的源节点。");
      return;
    }

    const previous = this.activeGenerations.get(canvas);
    if (previous) previous.controller.abort();
    const controller = new AbortController();
    this.activeGenerations.set(canvas, { controller, nodeId });
    const notice = new Notice("Better Canvas：正在准备 AI 上下文…", 0);
    let responseNodeId = "";
    let accumulated = "";
    let lastUpdate = 0;
    let lastFlushedLength = 0;

    try {
      const context = await this.getNodeContext(canvas, nodeId);
      const images = await this.getConnectedImages(canvas, nodeId);
      if (controller.signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
      const prompt = "请基于所给 Obsidian Canvas 笔记回答，不要声称读取了未提供的来源。\n\n任务：" + instruction + "\n\n画布上下文：\n" + context;
      const content: ChatMessageContent = images.length
        ? [{ type: "text", text: prompt }, ...images]
        : prompt;

      const fresh = readCanvasData(canvas).nodes.find((node: CanvasNodeData) => node.id === nodeId) ?? source;
      const placeholder: CanvasNodeData = {
        ...makeTextNode("", fresh.x + fresh.width + 100, fresh.y, {
          width: Math.max(300, fresh.width),
          height: 180
        }),
        bcGenerating: true,
        bcGenerated: false,
        bcPrompt: instruction,
        bcSourceNode: nodeId,
        bcAIModel: modelOverride || (source as any).bcAIModel || this.currentProvider(source).model,
        bcAIProvider: this.currentProvider(source).id
      };
      responseNodeId = placeholder.id;
      insertCanvasNode(canvas, placeholder, nodeId);

      const answer = await chatCompletionStream(
        this.aiSettings(source, modelOverride),
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
      if (replaceNodeId && replaceNodeId !== responseNodeId) {
        const latest = readCanvasData(canvas);
        canvas.importData({
          ...latest,
          nodes: latest.nodes.filter((node: CanvasNodeData) => node.id !== replaceNodeId),
          edges: latest.edges.filter((edge: any) => edge.fromNode !== replaceNodeId && edge.toNode !== replaceNodeId)
        });
      }
      patchNode(canvas, responseNodeId, {
        text: answer,
        bcGenerating: false,
        bcGenerated: true,
        bcStopped: false,
        bcPrompt: instruction,
        bcSourceNode: nodeId,
        bcAIModel: modelOverride || (source as any).bcAIModel || this.currentProvider(source).model,
        bcAIProvider: this.currentProvider(source).id
      });
      notice.hide();
      new Notice("AI 回复已添加为关联节点。");
    } catch (error) {
      const stopped = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (responseNodeId) {
        if (stopped) {
          patchNode(canvas, responseNodeId, {
            text: accumulated || "（生成已停止，暂无文本输出）",
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
          const latest = readCanvasData(canvas);
          canvas.importData({
            ...latest,
            nodes: latest.nodes.filter((node: CanvasNodeData) => node.id !== responseNodeId),
            edges: latest.edges.filter((edge: any) => edge.fromNode !== responseNodeId && edge.toNode !== responseNodeId)
          });
        }
      }
      notice.hide();
      if (stopped) new Notice("AI 生成已停止；已保留已生成的部分内容。");
      else new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      if (this.activeGenerations.get(canvas)?.controller === controller) this.activeGenerations.delete(canvas);
    }
  }

  private stopAI(): void {
    const canvas = this.canvas();
    const current = canvas ? this.activeGenerations.get(canvas) : undefined;
    const active = current ?? Array.from(this.activeGenerations.values()).at(-1);
    if (!active) {
      new Notice("当前没有正在运行的 AI 请求。");
      return;
    }
    active.controller.abort();
  }

  private async regenerate(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    const node = selection.node as any;
    if (!node.bcGenerated || typeof node.bcSourceNode !== "string" || typeof node.bcPrompt !== "string") {
      new Notice("所选节点没有可重新生成的 AI 元数据。");
      return;
    }
    await this.runAI(node.bcSourceNode, node.bcPrompt, typeof node.bcAIModel === "string" ? node.bcAIModel : undefined, node.id);
  }

  private async generateImageForNode(): Promise<void> {
    const selection = this.selected();
    if (!selection) return;
    const { canvas, node } = selection;
    const notice = new Notice("正在生成图片…", 0);
    try {
      const context = await this.getNodeContext(canvas, node.id);
      const result = await generateImage(this.aiSettings(node),
        "Create a clear visual based on these notes. Avoid long text in the image.\n\n" + context.slice(0, 7000));
      const folder = String(this.settings().attachmentFolder || "Better Canvas/Generated Images");
      await this.ensureFolder(folder);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = folder + "/better-canvas-" + stamp + "." + result.extension;
      const bytes = result.bytes.slice();
      await this.p.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
      const imageNode: CanvasNodeData = {
        id: Math.random().toString(16).slice(2, 18).padEnd(16, "0").slice(0, 16),
        type: "file",
        file: path,
        x: node.x + node.width + 100,
        y: node.y + node.height + 30,
        width: 320,
        height: 240
      };
      insertCanvasNode(canvas, imageNode, node.id);
      notice.hide();
      new Notice("生成图片已保存至 Vault，并连接到源节点。");
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private async runMcpTool(): Promise<void> {
    const canvasForWrite = this.canvas();
    if (canvasForWrite?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先解除只读模式再写入 MCP 结果。");
      return;
    }
    const s = this.settings();
    if (!s.mcpEndpoint) { new Notice("请先在设置中填写 MCP Streamable HTTP endpoint。"); return; }
    try {
      const tools = await listRemoteTools(s.mcpEndpoint, s.mcpApiKey);
      if (!tools.length) { new Notice("MCP 服务未暴露工具。"); return; }
      const summary = tools.map(tool => tool.name + (tool.description ? " — " + tool.description : "")).join("\n");
      this.input("选择 MCP 工具", summary + "\n\n输入完整工具名", name => {
        const tool = tools.find(item => item.name === name.trim());
        if (!tool) return new Notice("工具名称不在列表中。");
        this.input("MCP 参数", "输入 JSON object，例如 {}", async raw => {
          let args: Record<string, unknown>;
          try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("需要 JSON object");
            args = parsed;
          } catch (error) {
            return new Notice(error instanceof Error ? error.message : "参数 JSON 无效");
          }
          const notice = new Notice("正在调用 MCP 工具…", 0);
          try {
            const result = await callRemoteTool(s.mcpEndpoint, s.mcpApiKey, tool.name, args);
            const canvas = this.canvas();
            if (canvas) {
              const selection = this.selected(canvas);
              const node = makeTextNode("# MCP: " + tool.name + "\n\n" + result,
                selection ? selection.node.x + selection.node.width + 100 : 0,
                selection ? selection.node.y : 0, { width: 420, height: 260 });
              insertCanvasNode(canvas, node, selection?.node.id);
            }
            notice.hide();
          } catch (error) {
            notice.hide();
            new Notice(error instanceof Error ? error.message : String(error), 8000);
          }
        }, "{}");
      }, tools[0].name);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private createCanvasPortal(): void {
    const canvas = this.canvas();
    if (!canvas) { new Notice("请先打开 Canvas。"); return; }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) { new Notice("当前 Canvas 处于只读模式。"); return; }
    const selection = this.selected(canvas);
    const canvasFiles = this.p.app.vault.getFiles().filter((file: TFile) => file.extension.toLowerCase() === "canvas");
    if (!canvasFiles.length) { new Notice("Vault 中还没有其他 Canvas 文件。"); return; }
    const ModalClass = class extends SuggestModal<TFile> {
      getSuggestions(query: string): TFile[] {
        const needle = query.trim().toLocaleLowerCase();
        return canvasFiles.filter((file: TFile) => !needle || file.path.toLocaleLowerCase().includes(needle) || file.basename.toLocaleLowerCase().includes(needle)).slice(0, 100);
      }
      renderSuggestion(file: TFile, element: HTMLElement): void {
        element.createEl("div", { text: file.basename });
        element.createEl("small", { text: file.path });
      }
      onChooseSuggestion(file: TFile): void {
        const text = "![[" + file.path + "]]";
        const node = makeTextNode(text, selection ? selection.node.x + selection.node.width + 100 : 0, selection ? selection.node.y : 0, { width: 500, height: 360 });
        insertCanvasNode(canvas, node, selection?.node.id);
        new Notice("已插入 Canvas 嵌入卡片。交互嵌入效果取决于当前 Obsidian 版本。");
      }
    };
    new ModalClass(this.p.app).open();
  }

  private createPdfReviewBoard(): void {
    const selection = this.selected();
    if (!selection) return;
    if (selection.node.type !== "file" || !String(selection.node.file ?? "").toLowerCase().endsWith(".pdf")) {
      new Notice("请选择一个 PDF 文件节点。");
      return;
    }
    this.input("创建 PDF 分页批注工作区", "输入页数（1 至 30）", value => {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 30) { new Notice("请输入 1 至 30 的整数。"); return; }
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
        const annotationNode = makeTextNode("第 " + page + " 页批注\n\n- 关键内容：\n- 疑问：\n- 后续行动：",
          pageNode.x + pageNode.width + 50, pageNode.y, { width: 300, height: 230 });
        insertCanvasNode(canvas, annotationNode, pageNode.id);
      }
      new Notice("已创建 " + count + " 个固定渲染页面和对应批注节点。页面批注仍以关联文本节点为主，尚不支持在 PDF 页图上直接绘制标记。");
    }, "10");
  }
  private splitPdfPages(): void {
    const selection = this.selected();
    if (!selection) return;
    if (selection.node.type !== "file" || !String(selection.node.file ?? "").toLowerCase().endsWith(".pdf")) {
      new Notice("请选择一个 PDF 文件节点。"); return;
    }
    this.input("拆分 PDF 页面", "输入要创建的页面数（最多 30）", value => {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 30) return new Notice("请输入 1 至 30 的整数。");
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
      new Notice("已创建 " + count + " 个固定渲染的 PDF 页面节点。");
    }, "10");
  }

  private syncAutoEdges(canvas: any, canvasFile: TFile): void {
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) return;
    const s = this.settings();
    if (!s.autoFileNodeEdgesEnabled) return;
    const data = readCanvasData(canvas);
    const prefix = "bc-auto-";
    const keep = data.edges.filter((edge: any) => !String(edge.id).startsWith(prefix));
    const generated: any[] = [];
    const fileNodes = data.nodes.filter((node: CanvasNodeData) => node.type === "file" && typeof node.file === "string");
    for (const node of fileNodes) {
      const file = this.p.app.vault.getAbstractFileByPath(node.file as string);
      if (!(file instanceof TFile)) continue;
      const frontmatter = this.p.app.metadataCache.getFileCache(file)?.frontmatter;
      const raw = frontmatter?.[s.autoEdgesFrontmatterKey || "canvas-edges"];
      const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const links = value.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
        const targets = links?.length
          ? links.map((link: string) => link.slice(2, -2).split("|")[0])
          : [value.trim()];
        for (const targetPath of targets) {
          const destination = this.p.app.metadataCache.getFirstLinkpathDest(targetPath, canvasFile.path);
          if (!destination) continue;
          for (const target of fileNodes) {
            if (target.id === node.id || target.file !== destination.path) continue;
            generated.push({
              id: prefix + node.id + "-" + target.id,
              fromNode: node.id,
              fromSide: "right",
              fromFloating: true,
              toNode: target.id,
              toSide: "left",
              toFloating: true
            });
          }
        }
      }
    }
    const edges = [...keep, ...generated];
    if (JSON.stringify(edges) === JSON.stringify(data.edges)) return;
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }

  private refreshAutoEdges(): void {
    if (!this.settings().autoFileNodeEdgesEnabled) return;
    for (const leaf of this.p.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view as any;
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
        const json = JSON.parse(await this.p.app.vault.cachedRead(file));
        const node = (json.nodes ?? []).find((item: CanvasNodeData) => item.id === decodeURIComponent(match[2]));
        if (!node) continue;
        const body = String(node.text ?? node.file ?? node.url ?? "");
        if (item.classList.contains("internal-embed")) {
          const preview = document.createElement("div");
          preview.className = "better-canvas-node-embed";
          preview.dataset.source = file.path + "#" + node.id;
          item.replaceWith(preview);
          if (node.type === "text") await MarkdownRenderer.renderMarkdown(body, preview, context.sourcePath, this.p);
          else preview.createEl("p", { text: body });
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

class BetterCanvasFeatureSettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: any, private features: BetterCanvasFeatures) {
    super(app, plugin);
  }

  display(): void {
    const c = this.containerEl;
    c.empty();
    const s = this.features.settings();
    c.createEl("h2", { text: "Better Canvas — Integration Features" });
    c.createEl("p", { text: "这些扩展直接与当前 Vault 的 Canvas 数据交互。不同 AI profile 通过 OpenAI-compatible Chat Completions / Images API 调用；API Key 保存于本地插件数据。" });

    new Setting(c).setName("Canvas metadata cache / backlinks")
      .setDesc("尝试将 .canvas 节点文本中的 Wikilinks、文件节点和画布 frontmatter 注册到 Obsidian metadata cache / graph。使用的是 Obsidian 内部接口；如果升级后遇到索引异常，可关闭此选项。")
      .addToggle(toggle => toggle.setValue(Boolean(s.canvasMetadataEnabled)).onChange(async value => {
        s.canvasMetadataEnabled = value;
        await this.features.save();
        if (value) this.features.refreshMetadataCache();
      }));

    new Setting(c).setName("Active AI Provider")
      .setDesc("选择用于新 AI 请求的供应商 profile；单个节点可覆盖供应商与模型。")
      .addDropdown(dropdown => {
        for (const profile of s.providerProfiles as ProviderProfile[]) dropdown.addOption(profile.id, profile.name);
        dropdown.setValue(s.activeProviderId).onChange(async value => {
          s.activeProviderId = value;
          const profile = (s.providerProfiles as ProviderProfile[]).find(item => item.id === value);
          if (profile) {
            s.baseUrl = profile.baseUrl;
            s.apiKey = profile.apiKey;
            s.model = profile.model;
            s.imageModel = profile.imageModel;
          }
          await this.features.save();
          this.display();
        });
      });

    new Setting(c).setName("AI Provider Profiles (JSON)")
      .setDesc("可配置原生 Anthropic、原生 Gemini 或 OpenAI-compatible endpoint。每个对象包含 id、name、protocol（openai/anthropic/gemini）、baseUrl、apiKey、model、imageModel。OpenAI-compatible 可用于 OpenAI、Ollama、OpenRouter、Groq 或兼容网关。不要分享包含真实密钥的导出文件。")
      .addTextArea(text => {
        text.inputEl.rows = 10;
        text.inputEl.style.width = "100%";
        text.setValue(JSON.stringify(s.providerProfiles, null, 2));
        text.onChange(async value => {
          try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed) || !parsed.length) return;
            const valid = parsed.every((profile: any) =>
              typeof profile?.id === "string" && typeof profile?.name === "string" &&
              typeof profile?.baseUrl === "string" && typeof profile?.model === "string"
            );
            if (!valid) return;
            s.providerProfiles = parsed.map((profile: any) => ({
              id: profile.id,
              name: profile.name,
              protocol: profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai",
              baseUrl: profile.baseUrl,
              apiKey: String(profile.apiKey ?? ""),
              model: profile.model,
              imageModel: String(profile.imageModel ?? profile.model)
            }));
            if (!(s.providerProfiles as ProviderProfile[]).some(profile => profile.id === s.activeProviderId)) {
              s.activeProviderId = (s.providerProfiles as ProviderProfile[])[0].id;
            }
            const active = (s.providerProfiles as ProviderProfile[]).find(profile => profile.id === s.activeProviderId);
            if (active) {
              s.baseUrl = active.baseUrl;
              s.apiKey = active.apiKey;
              s.model = active.model;
              s.imageModel = active.imageModel;
            }
            await this.features.save();
          } catch {
            // Retain last valid configuration until the JSON becomes valid.
          }
        });
      });

    new Setting(c).setName("Automatic file-node edges")
      .setDesc("从 file node 对应 Markdown 文件的 frontmatter 字段生成边。")
      .addToggle(toggle => toggle.setValue(Boolean(s.autoFileNodeEdgesEnabled)).onChange(async value => {
        s.autoFileNodeEdgesEnabled = value;
        await this.features.save();
      }));

    new Setting(c).setName("Auto-edge frontmatter key")
      .setDesc("默认 canvas-edges；内容支持 wiki link 字符串或列表。")
      .addText(text => text.setValue(String(s.autoEdgesFrontmatterKey)).onChange(async value => {
        s.autoEdgesFrontmatterKey = value.trim() || "canvas-edges";
        await this.features.save();
      }));

    new Setting(c).setName("Custom node CSS")
      .setDesc("输入仅在本地加载的 CSS。先给节点设置自定义 class，再用 .bc-user-your-class 作为选择器；注意 CSS 可以引用远程资源。")
      .addTextArea(text => {
        text.inputEl.rows = 12;
        text.inputEl.style.width = "100%";
        text.setValue(String(s.customCss ?? ""));
        text.onChange(async value => {
          s.customCss = value;
          await this.features.save();
          this.features.applyUserCss();
        });
      });
    new Setting(c).setName("Canvas grid size")
      .setDesc("用于“将所选节点对齐到网格”，单位为 Canvas 坐标像素。")
      .addText(text => text.setValue(String(s.gridSize)).onChange(async value => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 1 && number <= 500) { s.gridSize = number; await this.features.save(); }
      }));

    new Setting(c).setName("Default node width")
      .addText(text => text.setValue(String(s.defaultNodeWidth)).onChange(async value => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 120 && number <= 1200) { s.defaultNodeWidth = number; await this.features.save(); }
      }));

    new Setting(c).setName("Default node height")
      .addText(text => text.setValue(String(s.defaultNodeHeight)).onChange(async value => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 80 && number <= 1000) { s.defaultNodeHeight = number; await this.features.save(); }
      }));
    new Setting(c).setName("Custom canvas colors")
      .setDesc("以逗号分隔，例如 #d14d41, #438c7a, #5c6bc0；作为画布颜色 7、8、9…")
      .addText(text => text.setValue((s.customColors as string[]).join(", ")).onChange(async value => {
        s.customColors = value.split(",").map((item: string) => item.trim()).filter(Boolean).slice(0, 12);
        await this.features.save();
      }));

    new Setting(c).setName("YouTube caption language")
      .setDesc("语言代码，如 en、zh-Hans、ja。只有公开字幕可读取时才可导入。")
      .addText(text => text.setValue(String(s.youtubeLanguage)).onChange(async value => {
        s.youtubeLanguage = value.trim() || "en";
        await this.features.save();
      }));

    new Setting(c).setName("MCP Streamable HTTP endpoint")
      .setDesc("目前支持远程 Streamable HTTP MCP servers；不支持 stdio 或 SSE-only transport。")
      .addText(text => text.setPlaceholder("https://server.example/mcp").setValue(String(s.mcpEndpoint)).onChange(async value => {
        s.mcpEndpoint = value.trim();
        await this.features.save();
      }));

    new Setting(c).setName("MCP bearer token")
      .setDesc("可选，仅保存在此 Vault 的插件设置。")
      .addText(text => {
        text.inputEl.type = "password";
        text.setValue(String(s.mcpApiKey)).onChange(async value => {
          s.mcpApiKey = value.trim();
          await this.features.save();
        });
      });
  }
}
