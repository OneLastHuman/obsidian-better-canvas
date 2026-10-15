import { ItemView, Notice } from "obsidian";
import { insertCanvasNode, makeTextNode, readCanvasData } from "./canvas";
import { patchNode } from "./enhancements";
import { strokeTouchesEraser } from "./pdf-annotation-geometry";
import { buildPdfAnnotationMarkdown } from "./pdf-annotation-export";

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

function isPinnedPdf(node: any): boolean {
  return node?.type === "file" &&
    typeof node.file === "string" &&
    node.file.toLowerCase().endsWith(".pdf") &&
    typeof node.subpath === "string" &&
    node.subpath.includes("pinned=true");
}

function makeSvgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

/**
 * Adds a transparent SVG drawing layer over pinned PDF page nodes. Stroke
 * points are stored in the Canvas JSON under bcPdfStrokes, not in an external
 * database, so annotations remain portable with the .canvas file.
 */
export class PdfAnnotationManager {
  private plugin: any;
  private observers = new Map<HTMLElement, MutationObserver>();
  private resizeObservers = new Map<HTMLElement, ResizeObserver>();
  private excerptContainers = new WeakSet<HTMLElement>();
  private toolbarContainers = new Map<HTMLElement, HTMLDivElement>();
  private refreshQueued = false;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  start(): void {
    this.plugin.addCommand({
      id: "bc-toggle-pdf-annotation",
      name: "Better Canvas: 切换固定 PDF 页面批注模式",
      callback: () => this.toggleForSelection()
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-pen",
      name: "Better Canvas: PDF 红笔批注",
      callback: () => this.setToolForSelection("pen", "#e53935", 5)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-blue-pen",
      name: "Better Canvas: PDF 蓝笔批注",
      callback: () => this.setToolForSelection("pen", "#1e88e5", 5)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-highlighter",
      name: "Better Canvas: PDF 黄色荧光笔",
      callback: () => this.setToolForSelection("highlighter", "#ffeb3b", 16)
    });
    this.plugin.addCommand({
      id: "bc-enable-pdf-eraser",
      name: "Better Canvas: PDF 批注橡皮擦",
      callback: () => this.setToolForSelection("eraser", "#ffffff", 22)
    });
    this.plugin.addCommand({
      id: "bc-undo-pdf-annotation",
      name: "Better Canvas: 撤销最后一笔 PDF 批注",
      callback: () => this.undoForSelection()
    });
    this.plugin.addCommand({
      id: "bc-clear-pdf-annotations",
      name: "Better Canvas: 清除所选 PDF 页面的批注",
      callback: () => this.clearForSelection()
    });
    this.plugin.addCommand({
      id: "bc-export-pdf-annotation-bundle",
      name: "Better Canvas: 导出当前 Canvas 的 PDF 批注为 Markdown",
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

  private activeCanvas(): any | null {
    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView) as any;
    return view?.getViewType?.() === "canvas" ? view.canvas ?? null : null;
  }

  private async exportAnnotationsForActiveCanvas(): Promise<void> {
    const canvas = this.activeCanvas();
    if (!canvas) {
      new Notice("请先打开要导出批注的 Canvas。");
      return;
    }

    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView) as any;
    const sourcePath = typeof view?.file?.path === "string" ? view.file.path : "";
    const bundle = buildPdfAnnotationMarkdown(readCanvasData(canvas).nodes, sourcePath);
    if (!bundle) {
      new Notice("当前 Canvas 没有可导出的固定 PDF 页面批注。");
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
      new Notice("已导出 " + bundle.pageCount + " 个 PDF 页面、" +
        bundle.highlightCount + " 处文字高亮和 " + bundle.strokeCount +
        " 笔手绘批注：" + path + (bundle.truncated ? "（部分数据达到安全上限，详见导出文件）" : ""));
    } catch (error) {
      console.error("Better Canvas PDF annotation export failed:", error);
      new Notice("PDF 批注导出失败：" + (error instanceof Error ? error.message : String(error)));
    }
  }

  private selectedPdfNode(): { canvas: any; node: any } | null {
    const canvas = this.activeCanvas();
    const selection = canvas?.selection;
    if (!canvas || !selection || selection.size !== 1) {
      new Notice("请在 Canvas 中只选择一个固定 PDF 页面节点。");
      return null;
    }
    const selected = selection.values().next().value;
    const node = readCanvasData(canvas).nodes.find((item: any) => item.id === selected?.id);
    if (!isPinnedPdf(node)) {
      new Notice("请先创建固定 PDF 页面节点（拆分 PDF 页面或创建分页批注工作区）。");
      return null;
    }
    return { canvas, node };
  }

  private toggleForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    const next = !Boolean(selected.node.bcPdfAnnotating);
    patchNode(selected.canvas, selected.node.id, {
      bcPdfAnnotating: next,
      bcPdfTool: selected.node.bcPdfTool ?? "pen",
      bcPdfColor: selected.node.bcPdfColor ?? "#e53935",
      bcPdfWidth: selected.node.bcPdfWidth ?? 5
    });
    this.refresh();
    new Notice(next
      ? "PDF 批注模式已开启。可直接在页面上拖动鼠标/触控笔绘制。再次运行命令退出。"
      : "PDF 批注模式已关闭。");
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
    const labels = { pen: "红/蓝笔", highlighter: "黄色荧光笔", eraser: "橡皮擦" };
    new Notice("PDF " + labels[tool] + "已启用；拖动鼠标或触控笔进行操作。");
  }

  private undoForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    const strokes = Array.isArray(selected.node.bcPdfStrokes) ? selected.node.bcPdfStrokes as PdfStroke[] : [];
    const highlights = Array.isArray(selected.node.bcPdfTextHighlights)
      ? selected.node.bcPdfTextHighlights as PdfTextHighlight[]
      : [];
    const lastStroke = strokes[strokes.length - 1];
    const lastHighlight = highlights[highlights.length - 1];
    if (!lastStroke && !lastHighlight) {
      new Notice("所选 PDF 页面没有可撤销的批注。");
      return;
    }
    const undoHighlight = Boolean(lastHighlight) &&
      (!lastStroke || (lastHighlight?.createdAt ?? 0) > (lastStroke?.createdAt ?? 0));
    if (undoHighlight) {
      patchNode(selected.canvas, selected.node.id, { bcPdfTextHighlights: highlights.slice(0, -1) });
      new Notice("已撤销最后一处文字高亮。");
    } else {
      patchNode(selected.canvas, selected.node.id, { bcPdfStrokes: strokes.slice(0, -1) });
      new Notice("已撤销最后一笔手绘批注。");
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
    new Notice("已清除所选 PDF 页面的手绘批注与文字高亮。");
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
      const view = leaf.view as any;
      const canvas = view?.canvas;
      const root = view?.containerEl as HTMLElement | undefined;
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
        const target = nodeElement.querySelector(".bc-pinned-pdf-embed-container") as HTMLElement | null;
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

  private ensureToolbar(canvas: any, nodeData: any, container: HTMLElement): void {
    let toolbar = this.toolbarContainers.get(container);
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "bc-pdf-annotation-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "PDF 页面批注工具");

      const actions = [
        { id: "toggle", label: "批注", title: "开启或关闭页面手绘批注" },
        { id: "pen-red", label: "红笔", title: "使用红笔绘制" },
        { id: "pen-blue", label: "蓝笔", title: "使用蓝笔绘制" },
        { id: "highlighter", label: "荧光", title: "使用黄色荧光笔" },
        { id: "eraser", label: "橡皮", title: "擦除触及的手绘批注" },
        { id: "undo", label: "撤销", title: "撤销最近一处笔迹或文字高亮" },
        { id: "clear", label: "清空", title: "清除此 PDF 页面的全部批注" }
      ];

      for (const action of actions) {
        const button = document.createElement("button");
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
          this.handleToolbarAction(canvas, nodeData.id, action.id);
        });
        toolbar.appendChild(button);
      }

      container.appendChild(toolbar);
      this.toolbarContainers.set(container, toolbar);
    }

    const current = readCanvasData(canvas).nodes.find((node: any) => node.id === nodeData.id) ?? nodeData;
    const readonly = Boolean(canvas?.wrapperEl?.classList?.contains("bc-readonly"));
    const tool = String(current.bcPdfTool ?? "pen");
    const color = String(current.bcPdfColor ?? "#e53935");
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

  private handleToolbarAction(canvas: any, nodeId: string, action: string): void {
    if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式，不能修改 PDF 批注。");
      return;
    }
    const current = readCanvasData(canvas).nodes.find((node: any) => node.id === nodeId) as any;
    if (!isPinnedPdf(current)) return;

    if (action === "toggle") {
      patchNode(canvas, nodeId, {
        bcPdfAnnotating: !Boolean(current.bcPdfAnnotating),
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
      const strokes = Array.isArray(current.bcPdfStrokes) ? current.bcPdfStrokes as PdfStroke[] : [];
      const highlights = Array.isArray(current.bcPdfTextHighlights)
        ? current.bcPdfTextHighlights as PdfTextHighlight[]
        : [];
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
      if (typeof window.confirm === "function" &&
          !window.confirm("清除此 PDF 页面的所有手绘批注与文字高亮？此操作无法撤销。")) return;
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

  private attachOverlay(canvas: any, nodeData: any, container: HTMLElement): void {
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
            ? "请先在 PDF 页面上选择文字，再点击持久化高亮。"
            : "请先在 PDF 文本面板或页面上选择一段文字，再点击创建摘录。");
          return;
        }
        if (canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
          new Notice("当前 Canvas 处于只读模式，不能添加 PDF 批注。");
          return;
        }
        const latest = readCanvasData(canvas);
        const source = latest.nodes.find((node: any) => node.id === nodeData.id);
        if (!source) {
          new Notice("找不到 PDF 页面节点，无法创建批注。");
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
            new Notice("没有取得页面上的文字选区位置。请在 PDF 页面文字层上选择文字；文本面板中的纯文本选择只能创建摘录。");
            return;
          }

          const highlights = Array.isArray(source.bcPdfTextHighlights)
            ? source.bcPdfTextHighlights as PdfTextHighlight[]
            : [];
          highlights.push({
            text: selectedText.slice(0, 5000),
            rects,
            color: "#ffeb3b",
            opacity: 0.36,
            createdAt: Date.now()
          });
          patchNode(canvas, source.id, { bcPdfTextHighlights: highlights });
          this.refresh();
          new Notice("已在 Canvas 中保存文字高亮；它会随 .canvas 文件保存，但不会修改 PDF 原文件。");
          return;
        }

        const excerptIndex = latest.nodes.filter((node: any) => node.bcPdfExcerptSource === source.id).length;
        const quoted = selectedText.slice(0, 10000).split(/\r?\n/).map(line => "> " + line).join("\n");
        const body = "PDF 摘录\n\n" + quoted + (selectedText.length > 10000 ? "\n\n（摘录已截断至 10,000 个字符）" : "") + "\n\n批注：";
        const note = makeTextNode(
          body,
          source.x + source.width + 70,
          source.y + excerptIndex * 190,
          { width: 340, height: Math.max(180, Math.min(420, Math.ceil(body.length / 42) * 24)) }
        );
        (note as any).bcPdfExcerptSource = source.id;
        insertCanvasNode(canvas, note, source.id);
        new Notice("已创建 PDF 文本摘录节点，并连接到对应页面。");
      };
      container.addEventListener("better-canvas-pdf-selection", onCreateExcerpt as EventListener);
      this.plugin.register(() => container.removeEventListener("better-canvas-pdf-selection", onCreateExcerpt as EventListener));
    }

    let svg = container.querySelector(":scope > .bc-pdf-annotation-overlay") as SVGSVGElement | null;
    const strokes = Array.isArray(nodeData.bcPdfStrokes) ? nodeData.bcPdfStrokes as PdfStroke[] : [];
    const textHighlights = Array.isArray(nodeData.bcPdfTextHighlights)
      ? nodeData.bcPdfTextHighlights as PdfTextHighlight[]
      : [];
    if (strokes.length === 0 && textHighlights.length === 0 && !nodeData.bcPdfAnnotating) {
      svg?.remove();
      return;
    }
    if (!svg) {
      svg = makeSvgElement("svg");
      svg.classList.add("bc-pdf-annotation-overlay");
      svg.setAttribute("viewBox", "0 0 1000 1000");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("aria-label", "PDF page annotations");
      container.appendChild(svg);
      this.installPointerHandlers(canvas, nodeData.id, svg);
    }

    // Align the annotation SVG to the rendered PDF bitmap, not the complete
    // embed container (which also contains the selectable-text panel).
    const pageCanvas = container.querySelector(".bc-pinned-pdf-page") as HTMLCanvasElement | null;
    if (pageCanvas) {
      svg.style.inset = "auto";
      svg.style.left = pageCanvas.offsetLeft + "px";
      svg.style.top = pageCanvas.offsetTop + "px";
      svg.style.width = pageCanvas.clientWidth + "px";
      svg.style.height = pageCanvas.clientHeight + "px";
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
          rect.setAttribute("aria-label", "PDF text highlight: " + highlight.text.slice(0, 120));
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

  private installPointerHandlers(canvas: any, nodeId: string, svg: SVGSVGElement): void {
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
      if (svg.dataset.drawEnabled !== "true" || !event.isPrimary || (event as PointerEvent).button > 0) return;
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

      const current = readCanvasData(canvas).nodes.find((node: any) => node.id === nodeId) as any;
      const existing = Array.isArray(current?.bcPdfStrokes) ? current.bcPdfStrokes as PdfStroke[] : [];
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
