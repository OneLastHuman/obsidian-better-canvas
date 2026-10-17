import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  SuggestModal,
  TFile
} from "obsidian";
import BetterCanvasFeatures from "./feature-integrator";
import { isMindMapShortcutEnabled } from "./mindmap-shortcuts";
import { parseCssStyleDefinitions, applyCustomStyleChoice, cssSnippetVaultPathFromHref, type CustomStyleDefinition, type CustomStyleChoice, type CustomStyleKind } from "./custom-style-presets";
import { decorateCanvas } from "./enhancements";
import { getNodeAIContextMenuActions } from "./node-ai-context-menu";
import NodeMenuUnifier from "./node-menu-unifier";
import { normalizeNamedPromptProfiles, type NamedPromptProfile } from "./prompt-profiles";
import type { ModelCapabilityReport } from "./model-capabilities";
import { AI_USAGE_EVENT, AI_USAGE_HISTORY_LIMIT, appendAIUsageRecord, normalizeAIUsageRecord, type AIUsageRecord } from "./ai-usage-core";
import { AIUsageModal } from "./ai-usage-modal";
import {
  CanvasNodeData,
  LayoutDirection,
  descendantsOf,
  getSelectedNode,
  insertCanvasNode,
  layoutTree,
  makeTextNode,
  readCanvasData
} from "./canvas";

interface NodeTemplate {
  name: string;
  text: string;
  width: number;
  height: number;
  color?: string;
  styleAttributes?: Record<string, unknown>;
  bcShape?: string;
  bcBorderStyle?: string;
  bcTextAlign?: string;
  bcCustomClass?: string;
  bcZoomBreakpoint?: number;
  bcAutoResize?: boolean;
}

interface BetterCanvasSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
  systemPrompt: string;
  backend: "api" | "opencode-acp" | "codex-cli";
  opencodeBinaryPath: string;
  direction: LayoutDirection;
  gapX: number;
  gapY: number;
  defaultNodeTextAlign: "left" | "center" | "right";
  attachmentFolder: string;
  templates: NodeTemplate[];
  mindMapShortcutChildTabEnabled: boolean;
  mindMapShortcutSiblingEnterEnabled: boolean;
  mindMapShortcutAltArrowNavigationEnabled: boolean;
  mindMapShortcutDirectionalCreationEnabled: boolean;
  systemPromptProfiles: NamedPromptProfile[];
  activeSystemPromptProfile: string;
  flashcardOutputMode: "canvas" | "spaced-repetition";
  spacedRepetitionFolder: string;
  spacedRepetitionDeck: string;
  modelCapabilityReports: Record<string, ModelCapabilityReport>;
  aiUsageRecords: AIUsageRecord[];
  aiModelPricesJson: string;
}

const DEFAULT_SETTINGS: BetterCanvasSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  imageModel: "gpt-image-1",
  systemPrompt: "You are a precise assistant helping the user reason from their Obsidian notes. Preserve uncertainty and do not invent facts.",
  backend: "api",
  opencodeBinaryPath: "opencode",
  direction: "LR",
  gapX: 100,
  gapY: 44,
  defaultNodeTextAlign: "center",
  attachmentFolder: "Better Canvas/Generated Images",
  templates: [],
  mindMapShortcutChildTabEnabled: true,
  mindMapShortcutSiblingEnterEnabled: true,
  mindMapShortcutAltArrowNavigationEnabled: true,
  mindMapShortcutDirectionalCreationEnabled: true,
  systemPromptProfiles: [],
  activeSystemPromptProfile: "",
  flashcardOutputMode: "canvas",
  spacedRepetitionFolder: "Better Canvas/Flashcards",
  spacedRepetitionDeck: "better-canvas",
  modelCapabilityReports: {},
  aiUsageRecords: [],
  aiModelPricesJson: "{}"
};

function simpleNodeText(node: CanvasNodeData): string {
  if (typeof node.text === "string" && node.text.trim()) return node.text;
  if (typeof node.file === "string") return node.file;
  if (typeof node.url === "string") return node.url;
  return `[${node.type} node]`;
}

class PromptModal extends Modal {
  private readonly title: string;
  private readonly placeholder: string;
  private readonly initialValue: string;
  private readonly onSubmit: (value: string) => void;

  constructor(app: App, title: string, placeholder: string, onSubmit: (value: string) => void, initialValue = "") {
    super(app);
    this.title = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
    this.initialValue = initialValue;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    const input = contentEl.createEl("textarea", { attr: { rows: "5", placeholder: this.placeholder } });
    input.value = this.initialValue;
    input.style.width = "100%";
    input.style.resize = "vertical";
    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const submit = actions.createEl("button", { text: "提交", cls: "mod-cta" });
    submit.onclick = () => {
      const value = input.value.trim();
      this.close();
      if (value) this.onSubmit(value);
    };
    input.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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

class TemplatePickerModal extends Modal {
  constructor(
    app: App,
    private readonly templates: NodeTemplate[],
    private readonly onPick: (template: NodeTemplate) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "插入节点模板" });
    if (this.templates.length === 0) {
      this.contentEl.createEl("p", { text: "还没有模板。先选择一个节点，运行“保存所选节点为模板”。" });
      return;
    }
    const list = this.contentEl.createDiv({ cls: "better-canvas-template-list" });
    for (const template of this.templates) {
      const button = list.createEl("button", { text: template.name });
      button.addEventListener("click", () => {
        this.close();
        this.onPick(template);
      });
    }
  }
}

class CustomStylePresetModal extends SuggestModal<CustomStyleChoice> {
  constructor(
    app: App,
    private readonly choices: CustomStyleChoice[],
    private readonly onChoose: (choice: CustomStyleChoice) => void
  ) {
    super(app);
    this.setPlaceholder("选择 CSS 自定义样式及其值");
  }

  getSuggestions(query: string): CustomStyleChoice[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return this.choices;
    return this.choices.filter(choice => [
      choice.definition.label,
      choice.definition.key,
      choice.option.label,
      choice.option.value ?? "null",
      choice.definition.kind
    ].join(" ").toLocaleLowerCase().includes(normalized));
  }

  renderSuggestion(choice: CustomStyleChoice, element: HTMLElement): void {
    element.createEl("div", {
      text: choice.definition.label + " — " + choice.option.label
    });
    element.createEl("small", {
      text: (choice.definition.kind === "node" ? "节点" : "连线") + " · " +
        choice.definition.key + " = " + (choice.option.value === null ? "null（重置）" : choice.option.value)
    });
  }

  onChooseSuggestion(choice: CustomStyleChoice, _event: MouseEvent | KeyboardEvent): void {
    this.onChoose(choice);
  }
}

class PresentationModal extends Modal {
  private index = 0;
  private readonly keyHandler = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      this.index = Math.min(Math.max(0, this.slides.length - 1), this.index + 1);
      this.renderSlide();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      event.stopPropagation();
      this.index = Math.max(0, this.index - 1);
      this.renderSlide();
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();
      this.index = 0;
      this.renderSlide();
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      this.index = Math.max(0, this.slides.length - 1);
      this.renderSlide();
    }
  };

  constructor(app: App, private readonly slides: Array<{ title: string; body: string }>) {
    super(app);
    this.modalEl.addClass("better-canvas-presentation");
  }

  onOpen(): void {
    document.addEventListener("keydown", this.keyHandler, true);
    this.renderSlide();
  }

  private renderSlide(): void {
    this.contentEl.empty();
    if (this.slides.length === 0) {
      this.contentEl.createEl("p", { text: "当前画布没有可展示的节点。" });
      return;
    }
    const slide = this.slides[this.index];
    this.contentEl.createEl("h2", { text: slide.title || `节点 ${this.index + 1}` });
    this.contentEl.createEl("div", { cls: "better-canvas-slide", text: slide.body });
    this.contentEl.createEl("p", { text: `${this.index + 1} / ${this.slides.length} · ←/→ 或 PageUp/PageDown 翻页 · Esc 退出` });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    const previous = actions.createEl("button", { text: "上一张" });
    previous.disabled = this.index === 0;
    previous.onclick = () => {
      this.index = Math.max(0, this.index - 1);
      this.renderSlide();
    };
    const next = actions.createEl("button", { text: "下一张", cls: "mod-cta" });
    next.disabled = this.index >= this.slides.length - 1;
    next.onclick = () => {
      this.index = Math.min(this.slides.length - 1, this.index + 1);
      this.renderSlide();
    };
  }

  onClose(): void {
    document.removeEventListener("keydown", this.keyHandler, true);
    this.contentEl.empty();
  }
}

export default class BetterCanvasPlugin extends Plugin {
  declare settings: BetterCanvasSettings;
  private boundContainers = new WeakSet<HTMLElement>();
  private features: BetterCanvasFeatures;
  private nodeMenuUnifier: NodeMenuUnifier;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() ?? {}) };
    this.settings.templates = Array.isArray(this.settings.templates) ? this.settings.templates : [];
    this.settings.systemPromptProfiles = normalizeNamedPromptProfiles(this.settings.systemPromptProfiles);
    if (this.settings.flashcardOutputMode !== "spaced-repetition") this.settings.flashcardOutputMode = "canvas";
    if (typeof this.settings.spacedRepetitionFolder !== "string") this.settings.spacedRepetitionFolder = "Better Canvas/Flashcards";
    if (typeof this.settings.spacedRepetitionDeck !== "string") this.settings.spacedRepetitionDeck = "better-canvas";
    if (typeof this.settings.aiModelPricesJson !== "string") this.settings.aiModelPricesJson = "{}";
    this.settings.aiUsageRecords = appendAIUsageRecord(this.settings.aiUsageRecords, null, AI_USAGE_HISTORY_LIMIT);
    const handleAIUsage = (event: Event): void => {
      const record = normalizeAIUsageRecord((event as CustomEvent<unknown>).detail);
      if (!record) return;
      this.settings.aiUsageRecords = appendAIUsageRecord(this.settings.aiUsageRecords, record, AI_USAGE_HISTORY_LIMIT);
      void this.saveSettings().catch(error => new Notice(error instanceof Error ? error.message : "保存 AI 用量记录失败。"));
    };
    window.addEventListener(AI_USAGE_EVENT, handleAIUsage);
    this.register(() => window.removeEventListener(AI_USAGE_EVENT, handleAIUsage));

    this.registerCommands();
    this.registerCanvasContextMenu();
    this.features = new BetterCanvasFeatures(this);
    this.features.init();
    this.nodeMenuUnifier = new NodeMenuUnifier(this);
    this.nodeMenuUnifier.start();
    this.registerEvent(this.app.workspace.on("layout-change", () => this.bindCanvasKeyboard()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.bindCanvasKeyboard()));
    this.app.workspace.onLayoutReady(() => this.bindCanvasKeyboard());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private showAIUsageReport(): void {
    new AIUsageModal(
      this.app,
      this.settings.aiUsageRecords,
      this.settings.aiModelPricesJson,
      async json => {
        this.settings.aiModelPricesJson = json;
        await this.saveSettings();
      },
      async () => {
        this.settings.aiUsageRecords = [];
        await this.saveSettings();
      }
    ).open();
  }

  private getCanvas(): any | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView) as any;
    if (!view || view.getViewType?.() !== "canvas" || !view.canvas) return null;
    return view.canvas;
  }

  private getSelectedRecord(canvas: any): CanvasNodeData | undefined {
    return getSelectedNode(canvas);
  }

  private selectNode(canvas: any, id: string): void {
    const internalNode = canvas?.nodes?.get?.(id);
    if (!internalNode) return;
    canvas.selectOnly?.(internalNode);
    canvas.zoomToSelection?.();
  }

  private selectedOrNotice(canvas = this.getCanvas()): { canvas: any; node: CanvasNodeData } | null {
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return null;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先运行“切换 Canvas 只读模式”解除锁定。");
      return null;
    }
    const node = this.getSelectedRecord(canvas);
    if (!node) {
      new Notice("请在画布中只选择一个节点。");
      return null;
    }
    return { canvas, node };
  }

  private registerCommands(): void {
    this.addCommand({ id: "create-child-node", name: "创建子节点", callback: () => this.createChildNode() });
    this.addCommand({ id: "create-sibling-node", name: "创建同级节点", callback: () => this.createSiblingNode() });
    this.addCommand({ id: "create-floating-node", name: "创建游离节点", callback: () => this.createFloatingNode() });
    this.addCommand({ id: "auto-layout-tree", name: "自动整理思维导图", callback: () => this.autoLayout() });
    this.addCommand({ id: "split-heading-into-mindmap", name: "将所选 Markdown 文件的 H1 拆为思维导图", callback: () => void this.splitHeadingsIntoMindMap() });
    this.addCommand({ id: "ask-ai", name: "向 AI 提问所选节点", callback: () => this.features.askSelectedNode() });
    this.addCommand({ id: "ai-usage-report", name: "查看 AI 用量与成本", callback: () => this.showAIUsageReport() });
    this.addCommand({ id: "generate-flashcards", name: "从所选节点生成复习闪卡", callback: () => this.features.generateFlashcardsFromSelection() });
    this.addCommand({ id: "generate-image", name: "根据所选节点生成图片", callback: () => this.features.generateImageFromSelection() });
    this.addCommand({ id: "add-web-link", name: "在画布中添加网页链接卡片", callback: () => this.addWebLink() });
    this.addCommand({ id: "save-node-template", name: "保存所选节点为模板", callback: () => this.saveNodeTemplate() });
    this.addCommand({ id: "insert-node-template", name: "插入节点模板", callback: () => this.insertNodeTemplate() });
    this.addCommand({ id: "apply-css-style-preset", name: "应用 CSS 自定义样式预设", callback: () => { void this.applyCustomStylePreset(); } });
    this.addCommand({ id: "search-canvas", name: "搜索当前画布", callback: () => this.searchCanvas() });
    this.addCommand({ id: "start-presentation", name: "开始画布演示", callback: () => this.startPresentation() });
    this.addCommand({ id: "select-node-tree", name: "选择所选节点及其子树", callback: () => this.selectNodeTree() });
  }

  private registerCanvasContextMenu(): void {
    const workspace = this.app.workspace as any;
    const ref = workspace.on("canvas:node-menu", (menu: any, node: any) => {
      if (!menu?.addItem || !node?.id) return;
      const nodeId = String(node.id);
      const canvas = this.getCanvas();
      const record = canvas ? readCanvasData(canvas).nodes.find(item => item.id === nodeId) : undefined;
      const isGeneratedAI = Boolean((record as any)?.bcGenerated);

      for (const action of getNodeAIContextMenuActions(isGeneratedAI)) {
        menu.addItem((item: any) => {
          item.setTitle(action.title).setIcon(action.icon).onClick(() => {
            switch (action.id) {
              case "ask":
                this.features.askSelectedNode(nodeId);
                break;
              case "image":
                this.features.generateImageFromSelection(nodeId);
                break;
              case "flashcards":
                this.features.generateFlashcardsFromSelection(nodeId);
                break;
              case "model":
                this.features.chooseModelForNode(nodeId);
                break;
              case "regenerate":
                this.features.regenerateNode(nodeId);
                break;
            }
          });
        });
      }

      menu.addItem((item: any) => item.setTitle("整理").setIcon("git-branch").onClick(() => {
        this.selectNode(this.getCanvas(), nodeId);
        this.autoLayout();
      }));
      menu.addItem((item: any) => item.setTitle("样式").setIcon("palette").onClick((event: MouseEvent | KeyboardEvent) => {
        const currentCanvas = (node as any)?.canvas ?? this.getCanvas();
        if (!currentCanvas) {
          new Notice("请先打开一个 Obsidian Canvas。");
          return;
        }
        this.nodeMenuUnifier.openStyleFromContextMenu(currentCanvas, nodeId, event);
      }));
    });
    this.registerEvent(ref);
  }

  private async loadedCustomStyleDefinitions(): Promise<CustomStyleDefinition[]> {
    const cssContents: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      const ownerNode = (sheet as CSSStyleSheet & { ownerNode?: Node | null }).ownerNode;
      const inlineText = ownerNode?.textContent;
      if (typeof inlineText === "string" && inlineText.trim()) {
        cssContents.push(inlineText);
        continue;
      }
      if (typeof sheet.href !== "string" || !sheet.href) continue;
      const snippetPath = cssSnippetVaultPathFromHref(
        sheet.href,
        String((this.app.vault as any).configDir ?? "")
      );
      if (!snippetPath) continue;
      try {
        const text = await this.app.vault.adapter.read(snippetPath);
        if (text.trim()) cssContents.push(text);
      } catch {
        // A snippet may disappear or be inaccessible during reload; keep scanning.
      }
    }
    for (const styleElement of Array.from(document.querySelectorAll("style"))) {
      const text = styleElement.textContent;
      if (typeof text === "string" && text.trim()) cssContents.push(text);
    }
    return parseCssStyleDefinitions(cssContents.join("\n"));
  }

  private async applyCustomStylePreset(): Promise<void> {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式，无法更改样式。");
      return;
    }

    const selectedItems = Array.from(canvas.selection?.values?.() ?? []) as any[];
    const selectedIds = [...new Set(selectedItems
      .map(item => item?.id ?? item?.getData?.()?.id)
      .filter((id): id is string => typeof id === "string"))];
    const currentData = readCanvasData(canvas);
    const selectedSet = new Set(selectedIds);
    const nodeIds = currentData.nodes.filter(node => selectedSet.has(node.id)).map(node => node.id);
    const edgeIds = currentData.edges.filter(edge => selectedSet.has(edge.id)).map(edge => edge.id);

    if (nodeIds.length > 0 && edgeIds.length > 0) {
      new Notice("请只选择节点或只选择连线，再应用 CSS 自定义样式。");
      return;
    }
    const kind: CustomStyleKind | null = nodeIds.length > 0 ? "node" : edgeIds.length > 0 ? "edge" : null;
    if (!kind) {
      new Notice("请先选择一个或多个节点，或选择一个或多个连线。");
      return;
    }
    const targetIds = kind === "node" ? nodeIds : edgeIds;
    const definitions = (await this.loadedCustomStyleDefinitions()).filter(definition => definition.kind === kind);
    const choices = definitions.flatMap(definition =>
      definition.options.map(option => ({ definition, option }))
    );
    if (choices.length === 0) {
      new Notice("未找到可用的" + (kind === "node" ? "节点" : "连线") +
        "样式预设。请在已启用的 CSS snippet 中添加 @advanced-canvas-" + kind + "-style 配置。");
      return;
    }

    new CustomStylePresetModal(this.app, choices, choice => {
      if (this.getCanvas() !== canvas) {
        new Notice("当前画布已切换；未应用样式。请在目标画布重新运行命令。");
        return;
      }
      if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
        new Notice("当前 Canvas 处于只读模式，无法更改样式。");
        return;
      }
      const latestData = readCanvasData(canvas);
      const result = applyCustomStyleChoice(latestData, targetIds, choice.definition, choice.option.value);
      if (result.updated === 0) {
        new Notice("所选节点或连线已不存在，未应用样式。");
        return;
      }
      canvas.importData(result.data);
      canvas.requestSave?.();
      canvas.requestFrame?.();
      decorateCanvas(canvas);
      new Notice("已将“" + choice.definition.label + " / " + choice.option.label + "”应用到 " +
        result.updated + " 个" + (kind === "node" ? "节点" : "连线") + "。");
    }).open();
  }

  private bindCanvasKeyboard(): void {
    const view = this.app.workspace.getActiveViewOfType(ItemView) as any;
    if (!view || view.getViewType?.() !== "canvas" || !view.containerEl) return;
    const container = view.containerEl as HTMLElement;
    if (this.boundContainers.has(container)) return;
    this.boundContainers.add(container);

    this.registerDomEvent(container, "keydown", (event: KeyboardEvent) => {
      const canvas = this.getCanvas();
      if (!canvas) return;
      if (canvas.wrapperEl?.classList?.contains("bc-readonly")) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true'], .cm-editor"))) return;
      const selectedInternal = canvas.selection?.values?.().next?.().value;
      if (selectedInternal?.isEditing) return;
      const node = this.getSelectedRecord(canvas);

      if (isMindMapShortcutEnabled(this.settings, "navigateAltArrow") &&
          event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        this.navigateSelection(canvas, event.key);
      } else if (node && isMindMapShortcutEnabled(this.settings, "childTab") &&
          event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.createChildNode();
      } else if (node && isMindMapShortcutEnabled(this.settings, "siblingEnter") &&
          event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.createSiblingNode();
      }
    });
  }

  private navigateSelection(canvas: any, key: string): void {
    const current = this.getSelectedRecord(canvas);
    if (!current) return;
    const direction = key === "ArrowUp" ? "up" : key === "ArrowDown" ? "down" : key === "ArrowLeft" ? "left" : "right";
    const cx = current.x + current.width / 2;
    const cy = current.y + current.height / 2;
    const candidates = readCanvasData(canvas).nodes
      .filter(node => node.id !== current.id)
      .map(node => {
        const nx = node.x + node.width / 2;
        const ny = node.y + node.height / 2;
        const dx = nx - cx;
        const dy = ny - cy;
        const inDirection = direction === "left" ? dx < 0 : direction === "right" ? dx > 0 : direction === "up" ? dy < 0 : dy > 0;
        const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
        const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        return { node, inDirection, score: primary + secondary * 1.7 };
      })
      .filter(item => item.inDirection)
      .sort((a, b) => a.score - b.score);
    if (candidates[0]) this.selectNode(canvas, candidates[0].node.id);
  }

  private createChildNode(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { canvas, node } = selected;
    const child = makeTextNode("", node.x + node.width + this.settings.gapX, node.y, { width: node.width, height: node.height });
    insertCanvasNode(canvas, child, node.id);
    window.setTimeout(() => {
      const internal = canvas.nodes?.get?.(child.id);
      if (internal) {
        canvas.selectOnly?.(internal);
        internal.startEditing?.();
        canvas.zoomToSelection?.();
      }
    }, 0);
  }

  private createSiblingNode(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { canvas, node } = selected;
    const data = readCanvasData(canvas);
    const incoming = data.edges.find(edge => edge.toNode === node.id);
    if (!incoming) {
      new Notice("所选节点没有父节点；请使用“创建子节点”或先连接到一个父节点。");
      return;
    }
    const siblings = data.edges.filter(edge => edge.fromNode === incoming.fromNode)
      .map(edge => data.nodes.find(item => item.id === edge.toNode))
      .filter((item): item is CanvasNodeData => Boolean(item));
    const y = siblings.reduce((bottom, sibling) => Math.max(bottom, sibling.y + sibling.height), node.y + node.height) + 36;
    const sibling = makeTextNode("", node.x, y, { width: node.width, height: node.height });
    insertCanvasNode(canvas, sibling, incoming.fromNode);
    window.setTimeout(() => {
      const internal = canvas.nodes?.get?.(sibling.id);
      if (internal) {
        canvas.selectOnly?.(internal);
        internal.startEditing?.();
        canvas.zoomToSelection?.();
      }
    }, 0);
  }

  private createFloatingNode(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { canvas, node } = selected;
    const floating = makeTextNode("", node.x + node.width + this.settings.gapX, node.y + node.height + 40, { width: node.width, height: node.height });
    insertCanvasNode(canvas, floating);
    window.setTimeout(() => {
      const internal = canvas.nodes?.get?.(floating.id);
      if (internal) {
        canvas.selectOnly?.(internal);
        internal.startEditing?.();
        canvas.zoomToSelection?.();
      }
    }, 0);
  }

  private autoLayout(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const count = layoutTree(selected.canvas, selected.node.id, this.settings.direction, this.settings.gapX, this.settings.gapY);
    new Notice(count > 0 ? `已整理 ${count} 个节点。` : "没有找到可整理的节点。");
  }

  private async splitHeadingsIntoMindMap(): Promise<void> {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { canvas, node } = selected;
    if (node.type !== "file" || !node.file) {
      new Notice("请先选择一个 Markdown 文件节点。");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(node.file);
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("所选节点不是可读取的 Markdown 文件。");
      return;
    }
    const headings = (this.app.metadataCache.getFileCache(file)?.headings ?? []).filter(heading => heading.level === 1);
    if (headings.length === 0) {
      new Notice("该文件没有 H1 标题。");
      return;
    }
    headings.forEach((heading, index) => {
      const child = makeTextNode(heading.heading.trim(), node.x + node.width + this.settings.gapX, node.y + (index - (headings.length - 1) / 2) * 170);
      insertCanvasNode(canvas, child, node.id);
    });
    new Notice(`已从“${file.basename}”创建 ${headings.length} 个标题节点。`);
  }

  private addWebLink(): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先解除只读模式再添加节点。");
      return;
    }
    const selected = this.getSelectedRecord(canvas);
    new PromptModal(this.app, "添加网页链接卡片", "输入完整的 http:// 或 https:// URL", value => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        new Notice("URL 格式不正确。");
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        new Notice("仅支持 http 和 https 链接。");
        return;
      }
      const node: CanvasNodeData = {
        id: `bc${Math.random().toString(16).slice(2, 14)}`.slice(0, 16),
        type: "link",
        url: url.toString(),
        x: selected ? selected.x + selected.width + this.settings.gapX : 0,
        y: selected ? selected.y : 0,
        width: 360,
        height: 220
      };
      insertCanvasNode(canvas, node, selected?.id);
    }).open();
  }

  private saveNodeTemplate(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { node } = selected;
    new PromptModal(this.app, "保存节点模板", "模板名称", async name => {
      const source = node as CanvasNodeData & {
        styleAttributes?: Record<string, unknown>;
        bcShape?: string;
        bcBorderStyle?: string;
        bcTextAlign?: string;
        bcCustomClass?: string;
        bcZoomBreakpoint?: number;
        bcAutoResize?: boolean;
      };
      this.settings.templates.push({
        name,
        text: typeof node.text === "string" ? node.text : "",
        width: node.width,
        height: node.height,
        ...(typeof node.color === "string" ? { color: node.color } : {}),
        ...(source.styleAttributes && typeof source.styleAttributes === "object"
          ? { styleAttributes: JSON.parse(JSON.stringify(source.styleAttributes)) as Record<string, unknown> } : {}),
        ...(typeof source.bcShape === "string" ? { bcShape: source.bcShape } : {}),
        ...(typeof source.bcBorderStyle === "string" ? { bcBorderStyle: source.bcBorderStyle } : {}),
        ...(typeof source.bcTextAlign === "string" ? { bcTextAlign: source.bcTextAlign } : {}),
        ...(typeof source.bcCustomClass === "string" ? { bcCustomClass: source.bcCustomClass } : {}),
        ...(typeof source.bcZoomBreakpoint === "number" ? { bcZoomBreakpoint: source.bcZoomBreakpoint } : {}),
        ...(typeof source.bcAutoResize === "boolean" ? { bcAutoResize: source.bcAutoResize } : {})
      });
      await this.saveSettings();
      new Notice(`已保存模板“${name}”。`);
    }).open();
  }

  private insertNodeTemplate(): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。请先解除只读模式再插入模板。");
      return;
    }
    const selected = this.getSelectedRecord(canvas);
    new TemplatePickerModal(this.app, this.settings.templates, template => {
      const node = {
        ...makeTextNode(template.text,
          selected ? selected.x + selected.width + this.settings.gapX : 0,
          selected ? selected.y : 0,
          { width: template.width, height: template.height, ...(template.color ? { color: template.color } : {}) }),
        ...(template.styleAttributes ? { styleAttributes: JSON.parse(JSON.stringify(template.styleAttributes)) } : {}),
        ...(template.bcShape ? { bcShape: template.bcShape } : {}),
        ...(template.bcBorderStyle ? { bcBorderStyle: template.bcBorderStyle } : {}),
        ...(template.bcTextAlign ? { bcTextAlign: template.bcTextAlign } : {}),
        ...(template.bcCustomClass ? { bcCustomClass: template.bcCustomClass } : {}),
        ...(typeof template.bcZoomBreakpoint === "number" ? { bcZoomBreakpoint: template.bcZoomBreakpoint } : {}),
        ...(typeof template.bcAutoResize === "boolean" ? { bcAutoResize: template.bcAutoResize } : {})
      };
      insertCanvasNode(canvas, node, selected?.id);
    }).open();
  }

  private searchCanvas(): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    new PromptModal(this.app, "搜索当前画布", "输入要查找的文本", query => {
      const needle = query.toLocaleLowerCase();
      const result = readCanvasData(canvas).nodes.find(node =>
        [node.text, node.file, node.url, node.type]
          .some(value => typeof value === "string" && value.toLocaleLowerCase().includes(needle))
      );
      if (!result) {
        new Notice("当前画布中没有匹配的节点。");
        return;
      }
      this.selectNode(canvas, result.id);
      new Notice("已选择第一个匹配节点。");
    }).open();
  }

  private selectNodeTree(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const ids = descendantsOf(selected.canvas, selected.node.id);
    const canvas = selected.canvas;
    canvas.deselectAll?.();
    for (const id of ids) {
      const internal = canvas.nodes?.get?.(id);
      if (internal) canvas.select?.(internal);
    }
    canvas.zoomToSelection?.();
    new Notice(`已选择 ${ids.length} 个节点。`);
  }

  private startPresentation(): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    const data = readCanvasData(canvas);
    const nodes = data.nodes.filter(node => node.type !== "group");
    const nodeMap = new Map(nodes.map(node => [node.id, node] as [string, CanvasNodeData]));
    const outgoing = new Map<string, string[]>();
    const incoming = new Set<string>();
    for (const edge of data.edges) {
      if (!nodeMap.has(edge.fromNode) || !nodeMap.has(edge.toNode)) continue;
      const children = outgoing.get(edge.fromNode) ?? [];
      children.push(edge.toNode);
      outgoing.set(edge.fromNode, children);
      incoming.add(edge.toNode);
    }
    const spatialOrder = (a: CanvasNodeData, b: CanvasNodeData) => a.x - b.x || a.y - b.y;
    for (const [id, children] of outgoing.entries()) {
      children.sort((a, b) => spatialOrder(nodeMap.get(a)!, nodeMap.get(b)!));
      outgoing.set(id, children);
    }
    const roots = nodes.filter(node => !incoming.has(node.id)).slice().sort(spatialOrder);
    const ordered: CanvasNodeData[] = [];
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      const node = nodeMap.get(id);
      if (!node) return;
      visited.add(id);
      ordered.push(node);
      for (const childId of outgoing.get(id) ?? []) visit(childId);
    };
    for (const root of roots) visit(root.id);
    for (const node of nodes.slice().sort(spatialOrder)) visit(node.id);
    const slides = ordered.map(node => ({
      title: typeof node.text === "string" && node.text.trim()
        ? node.text.split("\n")[0].slice(0, 100)
        : (node.file ?? node.url ?? node.type),
      body: simpleNodeText(node)
    }));
    new PresentationModal(this.app, slides).open();
  }
}
