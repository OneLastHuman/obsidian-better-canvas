import {
  App,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile
} from "obsidian";
import { chatCompletion, generateImage } from "./ai";
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
}

interface BetterCanvasSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
  systemPrompt: string;
  direction: LayoutDirection;
  gapX: number;
  gapY: number;
  attachmentFolder: string;
  templates: NodeTemplate[];
}

const DEFAULT_SETTINGS: BetterCanvasSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  imageModel: "gpt-image-1",
  systemPrompt: "You are a precise assistant helping the user reason from their Obsidian notes. Preserve uncertainty and do not invent facts.",
  direction: "LR",
  gapX: 100,
  gapY: 44,
  attachmentFolder: "Better Canvas/Generated Images",
  templates: []
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

class PresentationModal extends Modal {
  private index = 0;

  constructor(app: App, private readonly slides: Array<{ title: string; body: string }>) {
    super(app);
    this.modalEl.addClass("better-canvas-presentation");
  }

  onOpen(): void {
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
    this.contentEl.createEl("p", { text: `${this.index + 1} / ${this.slides.length}` });
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
    this.contentEl.empty();
  }
}

export default class BetterCanvasPlugin extends Plugin {
  settings: BetterCanvasSettings;
  private boundContainers = new WeakSet<HTMLElement>();

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() ?? {}) };
    this.settings.templates = Array.isArray(this.settings.templates) ? this.settings.templates : [];
    this.addSettingTab(new BetterCanvasSettingTab(this.app, this));
    this.registerCommands();
    this.registerCanvasContextMenu();
    this.registerEvent(this.app.workspace.on("layout-change", () => this.bindCanvasKeyboard()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.bindCanvasKeyboard()));
    this.app.workspace.onLayoutReady(() => this.bindCanvasKeyboard());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    const node = this.getSelectedRecord(canvas);
    if (!node) {
      new Notice("请在画布中只选择一个节点。");
      return null;
    }
    return { canvas, node };
  }

  private registerCommands(): void {
    this.addCommand({ id: "create-child-node", name: "Better Canvas: 创建子节点", callback: () => this.createChildNode() });
    this.addCommand({ id: "create-sibling-node", name: "Better Canvas: 创建同级节点", callback: () => this.createSiblingNode() });
    this.addCommand({ id: "create-floating-node", name: "Better Canvas: 创建游离节点", callback: () => this.createFloatingNode() });
    this.addCommand({ id: "auto-layout-tree", name: "Better Canvas: 自动整理思维导图", callback: () => this.autoLayout() });
    this.addCommand({ id: "split-heading-into-mindmap", name: "Better Canvas: 将所选 Markdown 文件的 H1 拆为思维导图", callback: () => void this.splitHeadingsIntoMindMap() });
    this.addCommand({ id: "ask-ai", name: "Better Canvas: 向 AI 提问所选节点", callback: () => this.promptAskNode() });
    this.addCommand({ id: "generate-flashcards", name: "Better Canvas: 从所选节点生成复习闪卡", callback: () => this.generateFlashcards() });
    this.addCommand({ id: "generate-image", name: "Better Canvas: 根据所选节点生成图片", callback: () => void this.generateImageForNode() });
    this.addCommand({ id: "add-web-link", name: "Better Canvas: 在画布中添加网页链接卡片", callback: () => this.addWebLink() });
    this.addCommand({ id: "save-node-template", name: "Better Canvas: 保存所选节点为模板", callback: () => this.saveNodeTemplate() });
    this.addCommand({ id: "insert-node-template", name: "Better Canvas: 插入节点模板", callback: () => this.insertNodeTemplate() });
    this.addCommand({ id: "search-canvas", name: "Better Canvas: 搜索当前画布", callback: () => this.searchCanvas() });
    this.addCommand({ id: "start-presentation", name: "Better Canvas: 开始画布演示", callback: () => this.startPresentation() });
    this.addCommand({ id: "select-node-tree", name: "Better Canvas: 选择所选节点及其子树", callback: () => this.selectNodeTree() });
  }

  private registerCanvasContextMenu(): void {
    const workspace = this.app.workspace as any;
    const ref = workspace.on("canvas:node-menu", (menu: any, node: any) => {
      if (!menu?.addItem || !node?.id) return;
      menu.addItem((item: any) => item.setTitle("Better Canvas: 向 AI 提问").setIcon("sparkles").onClick(() => this.promptAskNode(String(node.id))));
      menu.addItem((item: any) => item.setTitle("Better Canvas: 生成复习闪卡").setIcon("graduation-cap").onClick(() => {
        this.selectNode(this.getCanvas(), String(node.id));
        this.generateFlashcards();
      }));
      menu.addItem((item: any) => item.setTitle("Better Canvas: 自动整理思维导图").setIcon("git-branch").onClick(() => {
        this.selectNode(this.getCanvas(), String(node.id));
        this.autoLayout();
      }));
    });
    this.registerEvent(ref);
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
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, [contenteditable='true'], .cm-editor"))) return;
      const selectedInternal = canvas.selection?.values?.().next?.().value;
      if (selectedInternal?.isEditing) return;
      const node = this.getSelectedRecord(canvas);

      if (event.altKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        this.navigateSelection(canvas, event.key);
      } else if (node && event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.createChildNode();
      } else if (node && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
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

  private promptAskNode(nodeId?: string): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
      return;
    }
    if (nodeId) this.selectNode(canvas, nodeId);
    const selected = this.getSelectedRecord(canvas);
    if (!selected) {
      new Notice("请先选择一个节点。");
      return;
    }
    new PromptModal(this.app, "向 AI 提问", "例如：总结这个节点，并列出值得继续研究的问题",
      question => void this.runAI(selected.id, question)).open();
  }

  private async nodeContext(canvas: any, rootId: string): Promise<string> {
    const data = readCanvasData(canvas);
    const root = data.nodes.find(node => node.id === rootId);
    if (!root) throw new Error("找不到所选节点。");
    const connectedIds = new Set<string>([rootId]);
    for (const edge of data.edges) {
      if (edge.fromNode === rootId) connectedIds.add(edge.toNode);
      if (edge.toNode === rootId) connectedIds.add(edge.fromNode);
    }
    const pieces: string[] = [];
    for (const id of connectedIds) {
      const node = data.nodes.find(candidate => candidate.id === id);
      if (!node) continue;
      let body = simpleNodeText(node);
      if (node.type === "file" && node.file) {
        const file = this.app.vault.getAbstractFileByPath(node.file);
        if (file instanceof TFile) {
          try {
            body = await this.app.vault.cachedRead(file);
          } catch {
            // Keep the file path as context when reading is unavailable.
          }
        }
      }
      pieces.push(`[Node ${node.id}${id === rootId ? " — selected" : ""}]\n${body.slice(0, 3500)}`);
    }
    return pieces.join("\n\n--- Connected node ---\n\n").slice(0, 14000);
  }

  private async runAI(nodeId: string, instruction: string, taskLabel = "AI 回复"): Promise<void> {
    const canvas = this.getCanvas();
    if (!canvas) return;
    const source = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
    if (!source) {
      new Notice("找不到原始节点。");
      return;
    }
    const notice = new Notice("Better Canvas：正在请求 AI…", 0);
    try {
      const context = await this.nodeContext(canvas, nodeId);
      const answer = await chatCompletion(this.settings, [
        { role: "system", content: this.settings.systemPrompt },
        {
          role: "user",
          content: `请基于以下 Obsidian Canvas 节点内容完成任务。不要声称访问了未提供的网页或媒体。\n\n任务：${instruction}\n\n画布上下文：\n${context}`
        }
      ]);
      const responseNode = makeTextNode(answer, source.x + source.width + this.settings.gapX, source.y, {
        width: Math.max(300, source.width),
        height: Math.max(180, Math.min(440, Math.ceil(answer.length / 42) * 24))
      });
      insertCanvasNode(canvas, responseNode, source.id);
      notice.hide();
      new Notice(`${taskLabel}已添加为关联节点。`);
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private generateFlashcards(): void {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    void this.runAI(selected.node.id,
      "请根据这些笔记生成 5 张中文复习闪卡。每张按“问题：…\n答案：…”格式编写，答案应简洁、可验证；若资料不足请明确标注。",
      "复习闪卡");
  }

  private async generateImageForNode(): Promise<void> {
    const selected = this.selectedOrNotice();
    if (!selected) return;
    const { canvas, node } = selected;
    const notice = new Notice("Better Canvas：正在生成图片…", 0);
    try {
      const context = await this.nodeContext(canvas, node.id);
      const result = await generateImage(this.settings,
        `Create a useful visual based on these notes. Do not include long text in the image.\n\n${context.slice(0, 7000)}`);
      await this.ensureFolder(this.settings.attachmentFolder);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const path = `${this.settings.attachmentFolder}/better-canvas-${stamp}.${result.extension}`;
      const bytes = result.bytes.slice();
      await this.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
      const imageNode: CanvasNodeData = {
        id: `bc${Math.random().toString(16).slice(2, 14)}`.slice(0, 16),
        type: "file",
        file: path,
        x: node.x + node.width + this.settings.gapX,
        y: node.y + node.height + 30,
        width: 320,
        height: 240
      };
      insertCanvasNode(canvas, imageNode, node.id);
      notice.hide();
      new Notice("生成图片已保存到 Vault，并连接到原节点。");
    } catch (error) {
      notice.hide();
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = path.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized) throw new Error("图片附件目录不能为空。");
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  private addWebLink(): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      new Notice("请先打开一个 Obsidian Canvas。");
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
      this.settings.templates.push({
        name,
        text: typeof node.text === "string" ? node.text : "",
        width: node.width,
        height: node.height,
        ...(typeof node.color === "string" ? { color: node.color } : {})
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
    const selected = this.getSelectedRecord(canvas);
    new TemplatePickerModal(this.app, this.settings.templates, template => {
      const node = makeTextNode(template.text,
        selected ? selected.x + selected.width + this.settings.gapX : 0,
        selected ? selected.y : 0,
        { width: template.width, height: template.height, ...(template.color ? { color: template.color } : {}) });
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
    const slides = readCanvasData(canvas).nodes
      .filter(node => node.type !== "group")
      .slice()
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map(node => ({
        title: typeof node.text === "string" && node.text.trim()
          ? node.text.split("\n")[0].slice(0, 100)
          : (node.file ?? node.url ?? node.type),
        body: simpleNodeText(node)
      }));
    new PresentationModal(this.app, slides).open();
  }
}

class BetterCanvasSettingTab extends PluginSettingTab {
  plugin: BetterCanvasPlugin;

  constructor(app: App, plugin: BetterCanvasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Better Canvas" });
    containerEl.createEl("p", {
      text: "Canvas 增强和思维导图功能无需配置 AI。AI 请求通过下方兼容 OpenAI 的端点发送。API Key 仅保存于当前 Vault 的插件数据中。"
    });

    new Setting(containerEl)
      .setName("API Base URL")
      .setDesc("例如 https://api.openai.com/v1；不要在 URL 中放入 API Key。")
      .addText(text => text.setPlaceholder("https://api.openai.com/v1").setValue(this.plugin.settings.baseUrl).onChange(async value => {
        this.plugin.settings.baseUrl = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("本地插件设置；请不要将真实密钥提交到 Git。")
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-…").setValue(this.plugin.settings.apiKey).onChange(async value => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Chat model")
      .setDesc("用于问答和复习闪卡的模型名称。")
      .addText(text => text.setPlaceholder("gpt-4o-mini").setValue(this.plugin.settings.model).onChange(async value => {
        this.plugin.settings.model = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Image model")
      .setDesc("图像服务支持的模型；兼容服务也可能不支持图像接口。")
      .addText(text => text.setPlaceholder("gpt-image-1").setValue(this.plugin.settings.imageModel).onChange(async value => {
        this.plugin.settings.imageModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("AI 助手的默认系统提示词。")
      .addText(text => text.setValue(this.plugin.settings.systemPrompt).onChange(async value => {
        this.plugin.settings.systemPrompt = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("默认布局方向")
      .setDesc("自动整理思维导图时使用的方向。")
      .addDropdown(dropdown => dropdown
        .addOption("LR", "左到右")
        .addOption("RL", "右到左")
        .addOption("TB", "上到下")
        .addOption("BT", "下到上")
        .setValue(this.plugin.settings.direction)
        .onChange(async value => {
          this.plugin.settings.direction = value as LayoutDirection;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("节点水平间距")
      .addText(text => text.setValue(String(this.plugin.settings.gapX)).onChange(async value => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0 && number <= 1000) {
          this.plugin.settings.gapX = number;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName("节点垂直间距")
      .addText(text => text.setValue(String(this.plugin.settings.gapY)).onChange(async value => {
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0 && number <= 1000) {
          this.plugin.settings.gapY = number;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName("图片附件目录")
      .setDesc("Vault 内生成图片的相对目录。")
      .addText(text => text.setValue(this.plugin.settings.attachmentFolder).onChange(async value => {
        this.plugin.settings.attachmentFolder = value.trim() || DEFAULT_SETTINGS.attachmentFolder;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("节点模板")
      .setDesc(`已保存 ${this.plugin.settings.templates.length} 个模板。`)
      .addButton(button => button.setButtonText("清空模板").setWarning().onClick(async () => {
        this.plugin.settings.templates = [];
        await this.plugin.saveSettings();
        this.display();
      }));
  }
}
