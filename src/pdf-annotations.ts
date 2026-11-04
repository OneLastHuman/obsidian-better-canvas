import { ItemView, Notice, Plugin } from "obsidian";
import { insertCanvasNode, makeTextNode, readCanvasData, type CanvasNodeData } from "./canvas";
import { isCanvasViewRuntime, type CanvasRuntime } from "./canvas-runtime";
import { confirmAction } from "./confirmation-modal";
import { patchNode } from "./enhancements";
import { strokeTouchesEraser } from "./pdf-annotation-geometry";
import { buildPdfAnnotationMarkdown } from "./pdf-annotation-export";
import { t } from "./i18n";

interface PdfPoint {
  x: number;
  y: number;
}

interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfTextHighlight {
  text: string;
  rects: PdfRect[];
  color?: string;
  opacity?: number;
  createdAt?: number;
}

interface PdfStroke {
  points: PdfPoint[];
  color: string;
  width: number;
  tool?: "pen" | "highlighter";
  opacity?: number;
  createdAt?: number;
}
function isPoint(value: unknown): value is PdfPoint {
  return typeof value === "object" && value !== null && "x" in value && "y" in value &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y);
}
function isRect(value: unknown): value is PdfRect {
  return isPoint(value) && "width" in value && typeof value.width === "number" &&
    "height" in value && typeof value.height === "number";
}
function readStrokes(value: unknown): PdfStroke[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown): entry is PdfStroke => typeof entry === "object" && entry !== null &&
    "points" in entry && Array.isArray(entry.points) && entry.points.every(isPoint) &&
    "color" in entry && typeof entry.color === "string" && "width" in entry && typeof entry.width === "number" &&
    (!("tool" in entry) || entry.tool === undefined || entry.tool === "pen" || entry.tool === "highlighter") &&
    (!("opacity" in entry) || entry.opacity === undefined || typeof entry.opacity === "number") &&
    (!("createdAt" in entry) || entry.createdAt === undefined || typeof entry.createdAt === "number"));
}
function readHighlights(value: unknown): PdfTextHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown): entry is PdfTextHighlight => typeof entry === "object" && entry !== null &&
    "text" in entry && typeof entry.text === "string" && "rects" in entry &&
    Array.isArray(entry.rects) && entry.rects.every(isRect) &&
    (!("color" in entry) || entry.color === undefined || typeof entry.color === "string") &&
    (!("opacity" in entry) || entry.opacity === undefined || typeof entry.opacity === "number") &&
    (!("createdAt" in entry) || entry.createdAt === undefined || typeof entry.createdAt === "number"));
}


function isPinnedPdf(node: CanvasNodeData | undefined): node is CanvasNodeData {
  return node?.type === "file" &&
    typeof node.file === "string" &&
    node.file.toLowerCase().endsWith(".pdf") &&
    typeof node.subpath === "string" &&
    node.subpath.includes("pinned=true");
}

function makeSvgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return createSvg(name);
}

/**
 * Adds a transparent SVG drawing layer over pinned PDF page nodes. Stroke
 * points are stored in the Canvas JSON under bcPdfStrokes, not in an external
 * database, so annotations remain portable with the .canvas file.
 */
export class PdfAnnotationManager {
  private plugin: Plugin;
  private observers = new Map<HTMLElement, MutationObserver>();
  private resizeObservers = new Map<HTMLElement, ResizeObserver>();
  private excerptContainers = new WeakSet<HTMLElement>();
  private toolbarContainers = new Map<HTMLElement, HTMLDivElement>();
  private refreshQueued = false;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  start(): void {
    this.plugin.addCommand({
      id: "bc-toggle-pdf-annotation",
      name: t("Better Canvas: Toggle pinned PDF annotation mode", "Better Canvas: 切换固定 PDF 页面批注模式"),
      callback: () => this.toggleForSelection()
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-pen",
      name: t("Better Canvas: PDF red pen annotation", "Better Canvas: PDF 红笔批注"),
      callback: () => this.setToolForSelection("pen", "#e53935", 5)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-blue-pen",
      name: t("Better Canvas: PDF blue pen annotation", "Better Canvas: PDF 蓝笔批注"),
      callback: () => this.setToolForSelection("pen", "#1e88e5", 5)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-highlighter",
      name: t("Better Canvas: PDF yellow highlighter", "Better Canvas: PDF 黄色荧光笔"),
      callback: () => this.setToolForSelection("highlighter", "#ffeb3b", 16)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-eraser",
      name: t("Better Canvas: PDF annotation eraser", "Better Canvas: PDF 批注橡皮擦"),
      callback: () => this.setToolForSelection("eraser", "#ffffff", 22)
    });
    this.plugin.addCommand({
      id: "bc-undo-pdf-annotation",
      name: t("Better Canvas: Undo last PDF annotation", "Better Canvas: 撤销最后一笔 PDF 批注"),
      callback: () => this.undoForSelection()
    });
    this.plugin.addCommand({
      id: "bc-clear-pdf-annotations",
      name: t("Better Canvas: Clear annotations on selected PDF pages", "Better Canvas: 清除所选 PDF 页面的批注"),
      callback: () => this.clearForSelection()
    });
    this.plugin.addCommand({
      id: "bc-export-pdf-annotation-bundle",
      name: t("Better Canvas: Export PDF annotations of current Canvas to Markdown", "Better Canvas: 导出当前 Canvas 的 PDF 批注为 Markdown"),
      callback: () => { void this.exportAnnotationsForActiveCanvas(); }
    });
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.plugin.app.workspace.onLayoutReady(() => this.refresh());
    this.plugin.register(() => this.stop());
  }

  stop(): void {
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
    for (const observer of this.resizeObservers.values()) observer.disconnect();
    this.resizeObservers.clear();
    for (const toolbar of this.toolbarContainers.values()) toolbar.remove();
    this.toolbarContainers.clear();
  }

  private activeCanvas(): CanvasRuntime | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView);
    return isCanvasViewRuntime(view) ? view.canvas : null;
  }

  private async exportAnnotationsForActiveCanvas(): Promise<void> {
    const canvas = this.activeCanvas();
    if (!canvas) {
      new Notice(t("Open the Canvas whose annotations you want to export first.", "请先打开要导出批注的 Canvas。"));
      return;
    }

    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView);
    const sourcePath = isCanvasViewRuntime(view) ? view.file?.path ?? "" : "";
    const bundle = buildPdfAnnotationMarkdown(readCanvasData(canvas).nodes, sourcePath);
    if (!bundle) {
      new Notice(t("This Canvas has no pinned PDF page annotations to export.", "当前 Canvas 没有可导出的固定 PDF 页面批注。"));
      return;
    }

    const vault = this.plugin.app.vault;
    try {
      const folderPaths = ["Better Canvas", "Better Canvas/PDF Annotations"];
      for (const folderPath of folderPaths) {
        if (!vault.getAbstractFileByPath(folderPath)) await vault.createFolder(folderPath);
      }

      const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
      const basePath = "Better Canvas/PDF Annotations/pdf-annotations-" + timestamp;
      let path = basePath + ".md";
      let suffix = 2;
      while (vault.getAbstractFileByPath(path)) {
        path = basePath + "-" + suffix + ".md";
        suffix++;
      }
      await vault.create(path, bundle.markdown);
      new Notice(t(
        "Exported PDF pages: " + bundle.pageCount + ", text highlights: " + bundle.highlightCount +
          ", freehand strokes: " + bundle.strokeCount + ". File: " + path +
          (bundle.truncated ? " (some data hit safety limits; see the exported file)" : ""),
        "已导出 " + bundle.pageCount + " 个 PDF 页面、" +
          bundle.highlightCount + " 处文字高亮和 " + bundle.strokeCount +
          " 笔手绘批注：" + path + (bundle.truncated ? "（部分数据达到安全上限，详见导出文件）" : "")
      ));
    } catch (error) {
      console.error("Better Canvas PDF annotation export failed:", error);
      new Notice(t(
        `PDF annotation export failed: ${error instanceof Error ? error.message : String(error)}`,
        `PDF 批注导出失败：${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }

  private selectedPdfNode(): { canvas: CanvasRuntime; node: CanvasNodeData } | null {
    const canvas = this.activeCanvas();
    const selection = canvas?.selection;
    if (!canvas || !selection || selection.size !== 1) {
      new Notice(t("Select exactly one pinned PDF page node in the Canvas.", "请在 Canvas 中只选择一个固定 PDF 页面节点。"));
      return null;
    }
    const selected = selection.values().next().value;
    const node = readCanvasData(canvas).nodes.find(item => item.id === selected?.id);
    if (!isPinnedPdf(node)) {
      new Notice(t("Create a pinned PDF page node first (split the PDF into pages or create a paged annotation workspace).", "请先创建固定 PDF 页面节点（拆分 PDF 页面或创建分页批注工作区）。"));
      return null;
    }
    return { canvas, node };
  }

  private toggleForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    const next = !selected.node.bcPdfAnnotating;
    patchNode(selected.canvas, selected.node.id, {
      bcPdfAnnotating: next,
      bcPdfTool: selected.node.bcPdfTool ?? "pen",
      bcPdfColor: selected.node.bcPdfColor ?? "#e53935",
      bcPdfWidth: selected.node.bcPdfWidth ?? 5
    });
    this.refresh();
    new Notice(next
      ? t("PDF annotation mode on. Drag with the mouse or stylus on the page to draw. Run the command again to exit.", "PDF 批注模式已开启。可直接在页面上拖动鼠标/触控笔绘制。再次运行命令退出。")
      : t("PDF annotation mode off.", "PDF 批注模式已关闭。"));
  }

  private setToolForSelection(tool: "pen" | "highlighter" | "eraser", color: string, width: number): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    patchNode(selected.canvas, selected.node.id, {
      bcPdfAnnotating: true,
      bcPdfTool: tool,
      bcPdfColor: color,
      bcPdfWidth: width
    });
    this.refresh();
    const labels = {
      pen: t("pen", "红/蓝笔"),
      highlighter: t("highlighter", "黄色荧光笔"),
      eraser: t("eraser", "橡皮擦")
    };
    new Notice(t("PDF " + labels[tool] + " tool enabled; drag the mouse or stylus to draw.",
      "PDF " + labels[tool] + "已启用；拖动鼠标或触控笔进行操作。"));
  }

  private undoForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    const strokes = readStrokes(selected.node.bcPdfStrokes);
    const highlights = readHighlights(selected.node.bcPdfTextHighlights);
    const lastStroke = strokes[strokes.length - 1];
    const lastHighlight = highlights[highlights.length - 1];
    if (!lastStroke && !lastHighlight) {
      new Notice(t("The selected PDF page has no annotations to undo.", "所选 PDF 页面没有可撤销的批注。"));
      return;
    }
    const undoHighlight = Boolean(lastHighlight) &&
      (!lastStroke || (lastHighlight?.createdAt ?? 0) > (lastStroke?.createdAt ?? 0));
    if (undoHighlight) {
      patchNode(selected.canvas, selected.node.id, { bcPdfTextHighlights: highlights.slice(0, -1) });
      new Notice(t("Undid the last text highlight.", "已撤销最后一处文字高亮。"));
    } else {
      patchNode(selected.canvas, selected.node.id, { bcPdfStrokes: strokes.slice(0, -1) });
      new Notice(t("Undid the last freehand stroke.", "已撤销最后一笔手绘批注。"));
    }
    this.refresh();
  }

  private clearForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    patchNode(selected.canvas, selected.node.id, {
      bcPdfStrokes: [],
      bcPdfTextHighlights: [],
      bcPdfAnnotating: false
    });
    this.refresh();
    new Notice(t("Cleared all freehand strokes and text highlights from the selected PDF page.", "已清除所选 PDF 页面的手绘批注与文字高亮。"));
  }

  private scheduleRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    window.requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.refresh();
    });
  }

  refresh(): void {
    if (!this.plugin?.app?.workspace) return;
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view;
      if (!isCanvasViewRuntime(view)) continue;
      const canvas = view.canvas;
      const root = view.containerEl;
      if (!canvas || !root) continue;

      if (!this.observers.has(root)) {
        const observer = new MutationObserver(() => this.scheduleRefresh());
        observer.observe(root, { subtree: true, childList: true });
        this.observers.set(root, observer);
      }

      const nodes = readCanvasData(canvas).nodes;
      for (const data of nodes) {
        if (!isPinnedPdf(data)) continue;
        const internal = canvas.nodes?.get?.(data.id);
        const nodeElement = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
        if (!(nodeElement instanceof HTMLElement)) continue;
        const target = nodeElement.querySelector<HTMLElement>(".bc-pinned-pdf-embed-container");
        if (!target) continue;
        if (!this.resizeObservers.has(target)) {
          const observer = new ResizeObserver(() => this.scheduleRefresh());
          observer.observe(target);
          this.resizeObservers.set(target, observer);
        }
        this.attachOverlay(canvas, data, target);
      }
    }
  }

  private ensureToolbar(canvas: CanvasRuntime, nodeData: CanvasNodeData, container: HTMLElement): void {
    let toolbar = this.toolbarContainers.get(container);
    if (!toolbar) {
      toolbar = container.ownerDocument.win.createDiv();
      toolbar.className = "bc-pdf-annotation-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", t("PDF page annotation tools", "PDF 页面批注工具"));

      const actions = [
        { id: "toggle", label: t("Annotate", "批注"), title: t("Turn freehand page annotation on or off", "开启或关闭页面手绘批注") },
        { id: "pen-red", label: t("Red pen", "红笔"), title: t("Draw with the red pen", "使用红笔绘制") },
        { id: "pen-blue", label: t("Blue pen", "蓝笔"), title: t("Draw with the blue pen", "使用蓝笔绘制") },
        { id: "highlighter", label: t("Highlight", "荧光"), title: t("Draw with the yellow highlighter", "使用黄色荧光笔") },
        { id: "eraser", label: t("Eraser", "橡皮"), title: t("Erase freehand annotations it touches", "擦除触及的手绘批注") },
        { id: "undo", label: t("Undo", "撤销"), title: t("Undo the most recent stroke or text highlight", "撤销最近一处笔迹或文字高亮") },
        { id: "clear", label: t("Clear", "清空"), title: t("Remove all annotations from this PDF page", "清除此 PDF 页面的全部批注") }
      ];

      for (const action of actions) {
        const button = container.ownerDocument.win.createEl("button");
        button.type = "button";
        button.className = "bc-pdf-annotation-tool";
        button.dataset.action = action.id;
        button.textContent = action.label;
        button.title = action.title;
        button.setAttribute("aria-label", action.title);
        button.addEventListener("pointerdown", event => event.stopPropagation());
        button.addEventListener("mousedown", event => {
          event.preventDefault();
          event.stopPropagation();
        });
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          void this.handleToolbarAction(canvas, nodeData.id, action.id);
        });
        toolbar.appendChild(button);
      }

      container.appendChild(toolbar);
      this.toolbarContainers.set(container, toolbar);
    }

    const current = readCanvasData(canvas).nodes.find(node => node.id === nodeData.id) ?? nodeData;
    const readonly = Boolean(canvas?.wrapperEl?.classList?.contains("bc-readonly"));
    const tool = typeof current.bcPdfTool === "string" ? current.bcPdfTool : "pen";
    const color = typeof current.bcPdfColor === "string" ? current.bcPdfColor : "#e53935";
    const annotating = Boolean(current.bcPdfAnnotating);
    const strokes = Array.isArray(current.bcPdfStrokes) ? current.bcPdfStrokes : [];
    const highlights = Array.isArray(current.bcPdfTextHighlights) ? current.bcPdfTextHighlights : [];
    const hasAnnotations = strokes.length > 0 || highlights.length > 0;

    for (const button of Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button[data-action]"))) {
      const action = button.dataset.action ?? "";
      const active = action === "toggle" ? annotating
        : action === "pen-red" ? annotating && tool === "pen" && color === "#e53935"
        : action === "pen-blue" ? annotating && tool === "pen" && color === "#1e88e5"
        : action === "highlighter" ? annotating && tool === "highlighter"
        : action === "eraser" ? annotating && tool === "eraser"
        : false;
      button.classList.toggle("is-active", active);
      if (["toggle", "pen-red", "pen-blue", "highlighter", "eraser"].includes(action)) {
        button.setAttribute("aria-pressed", String(active));
      }
      button.disabled = readonly || (action === "undo" && !hasAnnotations) || (action === "clear" && !hasAnnotations);
    }
  }

  private async handleToolbarAction(canvas: CanvasRuntime, nodeId: string, action: string): Promise<void> {
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; PDF annotations can't be changed.", "当前 Canvas 处于只读模式，不能修改 PDF 批注。"));
      return;
    }
    const current = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
    if (!isPinnedPdf(current)) return;

    if (action === "toggle") {
      patchNode(canvas, nodeId, {
        bcPdfAnnotating: !current.bcPdfAnnotating,
        bcPdfTool: current.bcPdfTool ?? "pen",
        bcPdfColor: current.bcPdfColor ?? "#e53935",
        bcPdfWidth: current.bcPdfWidth ?? 5
      });
    } else if (action === "pen-red" || action === "pen-blue" || action === "highlighter" || action === "eraser") {
      const settings = action === "pen-blue"
        ? { bcPdfTool: "pen", bcPdfColor: "#1e88e5", bcPdfWidth: 5 }
        : action === "highlighter"
        ? { bcPdfTool: "highlighter", bcPdfColor: "#ffeb3b", bcPdfWidth: 16 }
        : action === "eraser"
        ? { bcPdfTool: "eraser", bcPdfColor: "#ffffff", bcPdfWidth: 22 }
        : { bcPdfTool: "pen", bcPdfColor: "#e53935", bcPdfWidth: 5 };
      patchNode(canvas, nodeId, { ...settings, bcPdfAnnotating: true });
    } else if (action === "undo") {
      const strokes = readStrokes(current.bcPdfStrokes);
      const highlights = readHighlights(current.bcPdfTextHighlights);
      const lastStroke = strokes[strokes.length - 1];
      const lastHighlight = highlights[highlights.length - 1];
      if (!lastStroke && !lastHighlight) return;
      const undoHighlight = Boolean(lastHighlight) &&
        (!lastStroke || (lastHighlight?.createdAt ?? 0) > (lastStroke?.createdAt ?? 0));
      if (undoHighlight) {
        patchNode(canvas, nodeId, { bcPdfTextHighlights: highlights.slice(0, -1) });
      } else {
        patchNode(canvas, nodeId, { bcPdfStrokes: strokes.slice(0, -1) });
      }
    } else if (action === "clear") {
      const sourceView = this.plugin.app.workspace.getLeavesOfType("canvas")
        .map(leaf => leaf.view)
        .find(view => isCanvasViewRuntime(view) && view.canvas === canvas);
      if (!isCanvasViewRuntime(sourceView) || !sourceView.file) return;
      const sourceFile = sourceView.file;
      const sourcePath = sourceFile.path;
      if (!await confirmAction(this.plugin.app, {
        title: t("Clear PDF annotations", "清除 PDF 批注"),
        message: t("Remove all freehand annotations and text highlights from this PDF page? This can't be undone.", "清除此 PDF 页面的所有手绘批注与文字高亮？此操作无法撤销。"),
        confirmLabel: t("Clear", "清空"), destructive: true
      })) return;
      const remainsOpen = this.plugin.app.workspace.getLeavesOfType("canvas")
        .some(leaf => leaf.view === sourceView);
      if (!remainsOpen || sourceView.canvas !== canvas || sourceView.file !== sourceFile ||
          sourceView.file.path !== sourcePath || canvas.readonly || canvas.readOnly ||
          canvas.wrapperEl?.classList.contains("bc-readonly")) return;
      const latest = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
      if (!isPinnedPdf(latest) || latest.file !== current.file || latest.subpath !== current.subpath) return;
      patchNode(canvas, nodeId, {
        bcPdfStrokes: [],
        bcPdfTextHighlights: [],
        bcPdfAnnotating: false
      });
    } else {
      return;
    }
    this.scheduleRefresh();
  }

  private attachOverlay(canvas: CanvasRuntime, nodeData: CanvasNodeData, container: HTMLElement): void {
    this.ensureToolbar(canvas, nodeData, container);
    if (!this.excerptContainers.has(container)) {
      this.excerptContainers.add(container);
      const onCreateExcerpt = (event: Event) => {
        const custom = event as CustomEvent<{
          text?: string;
          action?: "excerpt" | "highlight";
          rects?: PdfRect[];
        }>;
        const selectedText = String(custom.detail?.text ?? "").trim();
        const action = custom.detail?.action === "highlight" ? "highlight" : "excerpt";
        if (!selectedText) {
          new Notice(action === "highlight"
            ? t("Select text on the PDF page first, then click to save a highlight.", "请先在 PDF 页面上选择文字，再点击持久化高亮。")
            : t("Select a passage in the PDF text panel or on the page first, then click to create an excerpt.", "请先在 PDF 文本面板或页面上选择一段文字，再点击创建摘录。"));
          return;
        }
        if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
          new Notice(t("This Canvas is in read-only mode; PDF annotations can't be added.", "当前 Canvas 处于只读模式，不能添加 PDF 批注。"));
          return;
        }
        const latest = readCanvasData(canvas);
        const source = latest.nodes.find(node => node.id === nodeData.id);
        if (!source) {
          new Notice(t("PDF page node not found; can't create the annotation.", "找不到 PDF 页面节点，无法创建批注。"));
          return;
        }

        if (action === "highlight") {
          const rawRects = Array.isArray(custom.detail?.rects) ? custom.detail.rects : [];
          const rects: PdfRect[] = rawRects
            .filter((rect: PdfRect) =>
              Number.isFinite(rect?.x) && Number.isFinite(rect?.y) &&
              Number.isFinite(rect?.width) && Number.isFinite(rect?.height) &&
              rect.width > 0 && rect.height > 0
            )
            .map((rect: PdfRect) => {
              const x = Math.max(0, Math.min(1, rect.x));
              const y = Math.max(0, Math.min(1, rect.y));
              return {
                x,
                y,
                width: Math.max(0, Math.min(1 - x, rect.width)),
                height: Math.max(0, Math.min(1 - y, rect.height))
              };
            })
            .filter((rect: PdfRect) => rect.width > 0 && rect.height > 0);
          if (!rects.length) {
            new Notice(t("Couldn't read the selection position on the page. Select text on the PDF page's text layer; plain text selections in the text panel can only create excerpts.", "没有取得页面上的文字选区位置。请在 PDF 页面文字层上选择文字；文本面板中的纯文本选择只能创建摘录。"));
            return;
          }

          const highlights = readHighlights(source.bcPdfTextHighlights);
          highlights.push({
            text: selectedText.slice(0, 5000),
            rects,
            color: "#ffeb3b",
            opacity: 0.36,
            createdAt: Date.now()
          });
          patchNode(canvas, source.id, { bcPdfTextHighlights: highlights });
          this.refresh();
          new Notice(t("Saved the text highlight to the Canvas. It is stored with the .canvas file and does not modify the original PDF.", "已在 Canvas 中保存文字高亮；它会随 .canvas 文件保存，但不会修改 PDF 原文件。"));
          return;
        }

        const excerptIndex = latest.nodes.filter(node => node.bcPdfExcerptSource === source.id).length;
        const quoted = selectedText.slice(0, 10000).split(/\r?\n/).map(line => "> " + line).join("\n");
        const body = t("PDF excerpt", "PDF 摘录") + "\n\n" + quoted +
          (selectedText.length > 10000 ? "\n\n" + t("(Excerpt truncated to 10,000 characters)", "（摘录已截断至 10,000 个字符）") : "") +
          "\n\n" + t("Notes:", "批注：");
        const note = makeTextNode(
          body,
          source.x + source.width + 70,
          source.y + excerptIndex * 190,
          { width: 340, height: Math.max(180, Math.min(420, Math.ceil(body.length / 42) * 24)) }
        );
        note.bcPdfExcerptSource = source.id;
        insertCanvasNode(canvas, note, source.id);
        new Notice(t("Created a PDF text excerpt node and connected it to its page.", "已创建 PDF 文本摘录节点，并连接到对应页面。"));
      };
      container.addEventListener("better-canvas-pdf-selection", onCreateExcerpt);
      this.plugin.register(() => container.removeEventListener("better-canvas-pdf-selection", onCreateExcerpt));
    }

    let svg = container.querySelector<SVGSVGElement>(":scope > .bc-pdf-annotation-overlay");
    const strokes = readStrokes(nodeData.bcPdfStrokes);
    const textHighlights = readHighlights(nodeData.bcPdfTextHighlights);
    if (strokes.length === 0 && textHighlights.length === 0 && !nodeData.bcPdfAnnotating) {
      svg?.remove();
      return;
    }
    if (!svg) {
      svg = makeSvgElement("svg");
      svg.classList.add("bc-pdf-annotation-overlay");
      svg.setAttribute("viewBox", "0 0 1000 1000");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-label", t("PDF page annotations", "PDF 页面批注"));
      container.appendChild(svg);
      this.installPointerHandlers(canvas, nodeData.id, svg);
    }

    // Align the annotation SVG to the rendered PDF bitmap, not the complete
    // embed container (which also contains the selectable-text panel).
    const pageCanvas = container.querySelector<HTMLCanvasElement>(".bc-pinned-pdf-page");
    if (pageCanvas) {
      svg.classList.add("bc-pdf-annotation-page-aligned");
      svg.setCssStyles({
        left: pageCanvas.offsetLeft + "px",
        top: pageCanvas.offsetTop + "px",
        width: pageCanvas.clientWidth + "px",
        height: pageCanvas.clientHeight + "px"
      });
    }

    const tool = typeof nodeData.bcPdfTool === "string" ? nodeData.bcPdfTool : "pen";
    const color = typeof nodeData.bcPdfColor === "string" ? nodeData.bcPdfColor : "#e53935";
    const width = Number.isFinite(nodeData.bcPdfWidth) ? Number(nodeData.bcPdfWidth) : 5;
    const signature = JSON.stringify({ strokes, textHighlights, drawing: Boolean(nodeData.bcPdfAnnotating), tool, color, width });
    if (svg.dataset.bcSignature === signature) return;
    svg.dataset.bcSignature = signature;
    svg.dataset.drawEnabled = String(Boolean(nodeData.bcPdfAnnotating));
    svg.dataset.tool = tool;
    svg.dataset.color = color;
    svg.dataset.width = String(width);
    svg.replaceChildren();

    for (const highlight of textHighlights) {
      if (!Array.isArray(highlight?.rects)) continue;
      for (const box of highlight.rects) {
        if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) ||
            !Number.isFinite(box.width) || !Number.isFinite(box.height) ||
            box.width <= 0 || box.height <= 0) continue;
        const x = Math.max(0, Math.min(1, box.x));
        const y = Math.max(0, Math.min(1, box.y));
        const rectWidth = Math.max(0, Math.min(1 - x, box.width));
        const rectHeight = Math.max(0, Math.min(1 - y, box.height));
        if (rectWidth <= 0 || rectHeight <= 0) continue;

        const rect = makeSvgElement("rect");
        rect.setAttribute("x", (x * 1000).toFixed(2));
        rect.setAttribute("y", (y * 1000).toFixed(2));
        rect.setAttribute("width", (rectWidth * 1000).toFixed(2));
        rect.setAttribute("height", (rectHeight * 1000).toFixed(2));
        rect.setAttribute("fill", highlight.color || "#ffeb3b");
        rect.setAttribute("fill-opacity", String(Math.max(0.05, Math.min(0.9, highlight.opacity ?? 0.36))));
        rect.setAttribute("rx", "2");
        if (highlight.text) {
          rect.setAttribute("aria-label", t("PDF text highlight: " + highlight.text.slice(0, 120), "PDF 文字高亮：" + highlight.text.slice(0, 120)));
          const title = makeSvgElement("title");
          title.textContent = highlight.text;
          rect.appendChild(title);
        }
        svg.appendChild(rect);
      }
    }
    for (const stroke of strokes) {
      if (!Array.isArray(stroke?.points) || stroke.points.length === 0) continue;
      svg.appendChild(this.createStrokePath(stroke));
    }
  }

  private createStrokePath(stroke: PdfStroke): SVGPathElement {
    const path = makeSvgElement("path");
    path.setAttribute("d", this.pathData(stroke.points));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke.color || "#e53935");
    path.setAttribute("stroke-width", String(stroke.width || 5));
    path.setAttribute("stroke-linecap", stroke.tool === "highlighter" ? "square" : "round");
    path.setAttribute("stroke-linejoin", "round");
    if (stroke.tool === "highlighter") path.setAttribute("stroke-opacity", String(stroke.opacity ?? 0.32));
    else if (typeof stroke.opacity === "number") path.setAttribute("stroke-opacity", String(stroke.opacity));
    path.setAttribute("vector-effect", "non-scaling-stroke");
    return path;
  }

  private pathData(points: PdfPoint[]): string {
    return points.map((point, index) => {
      const x = Math.max(0, Math.min(1, point.x)) * 1000;
      const y = Math.max(0, Math.min(1, point.y)) * 1000;
      return (index === 0 ? "M " : "L ") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ");
  }

  private installPointerHandlers(canvas: CanvasRuntime, nodeId: string, svg: SVGSVGElement): void {
    let active: PdfPoint[] | null = null;
    let preview: SVGPathElement | null = null;
    let pointerId: number | null = null;
    const pointFromEvent = (event: PointerEvent): PdfPoint => {
      const rect = svg.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)))
      };
    };

    svg.addEventListener("pointerdown", event => {
      if (svg.dataset.drawEnabled !== "true" || !event.isPrimary || (event).button > 0) return;
      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      active = [pointFromEvent(event)];
      svg.setPointerCapture?.(pointerId);
      const tool = svg.dataset.tool === "highlighter" ? "highlighter" : svg.dataset.tool === "eraser" ? "eraser" : "pen";
      const color = svg.dataset.color || "#e53935";
      const width = Math.max(1, Math.min(64, Number(svg.dataset.width) || 5));
      const previewStroke: PdfStroke = tool === "eraser"
        ? { points: active, color: "#ffffff", width: 22, opacity: 0.75, tool: "pen" }
        : { points: active, color, width, opacity: tool === "highlighter" ? 0.32 : 1, tool };
      preview = this.createStrokePath(previewStroke);
      preview.classList.add("bc-pdf-annotation-preview");
      svg.appendChild(preview);
    });
    svg.addEventListener("pointermove", event => {
      if (!active || pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      active.push(pointFromEvent(event));
      if (preview) preview.setAttribute("d", this.pathData(active));
    });
    const finish = (event: PointerEvent) => {
      if (!active || pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      active.push(pointFromEvent(event));
      preview?.remove();

      const current = readCanvasData(canvas).nodes.find(node => node.id === nodeId);
      const existing = readStrokes(current?.bcPdfStrokes);
      const tool = svg.dataset.tool === "highlighter" ? "highlighter" : svg.dataset.tool === "eraser" ? "eraser" : "pen";

      if (tool === "eraser") {
        const rect = svg.getBoundingClientRect();
        const tolerance = 22;
        const retained = existing.filter(stroke => !strokeTouchesEraser(
          stroke.points ?? [],
          active!,
          rect.width,
          rect.height,
          tolerance + Math.max(0, Number(stroke.width) || 0) / 2
        ));
        patchNode(canvas, nodeId, { bcPdfStrokes: retained });
      } else {
        const width = Math.max(1, Math.min(64, Number(svg.dataset.width) || 5));
        const completed: PdfStroke = {
          points: active.slice(),
          color: svg.dataset.color || (tool === "highlighter" ? "#ffeb3b" : "#e53935"),
          width,
          tool,
          createdAt: Date.now(),
          ...(tool === "highlighter" ? { opacity: 0.32 } : {})
        };
        patchNode(canvas, nodeId, { bcPdfStrokes: [...existing, completed] });
      }
      active = null;
      preview = null;
      pointerId = null;
      this.scheduleRefresh();
    };
    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);
  }
}
