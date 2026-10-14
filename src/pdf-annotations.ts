import { Notice } from "obsidian";
import { readCanvasData } from "./canvas";
import { patchNode } from "./enhancements";

interface PdfPoint {
  x: number;
  y: number;
}

interface PdfStroke {
  points: PdfPoint[];
  color: string;
  width: number;
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
      id: "bc-clear-pdf-annotations",
      name: "Better Canvas: 清除所选 PDF 页面的批注",
      callback: () => this.clearForSelection()
    });
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.plugin.app.workspace.onLayoutReady(() => this.refresh());
    this.plugin.register(() => this.stop());
  }

  stop(): void {
    for (const observer of this.observers.values()) observer.disconnect();
    this.observers.clear();
  }

  private activeCanvas(): any | null {
    const view = this.plugin.app.workspace.getActiveViewOfType((require("obsidian") as any).ItemView) as any;
    return view?.getViewType?.() === "canvas" ? view.canvas ?? null : null;
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
    patchNode(selected.canvas, selected.node.id, { bcPdfAnnotating: next });
    this.refresh();
    new Notice(next
      ? "PDF 批注模式已开启。可直接在页面上拖动鼠标/触控笔绘制。再次运行命令退出。"
      : "PDF 批注模式已关闭。");
  }

  private clearForSelection(): void {
    const selected = this.selectedPdfNode();
    if (!selected) return;
    patchNode(selected.canvas, selected.node.id, { bcPdfStrokes: [], bcPdfAnnotating: false });
    this.refresh();
    new Notice("已清除所选 PDF 页面的手绘批注。");
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
        this.attachOverlay(canvas, data, target);
      }
    }
  }

  private attachOverlay(canvas: any, nodeData: any, container: HTMLElement): void {
    let svg = container.querySelector(":scope > .bc-pdf-annotation-overlay") as SVGSVGElement | null;
    if (!Array.isArray(nodeData.bcPdfStrokes) && !nodeData.bcPdfAnnotating) {
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

    const strokes = Array.isArray(nodeData.bcPdfStrokes) ? nodeData.bcPdfStrokes as PdfStroke[] : [];
    const signature = JSON.stringify({ strokes, drawing: Boolean(nodeData.bcPdfAnnotating) });
    if (svg.dataset.bcSignature === signature) return;
    svg.dataset.bcSignature = signature;
    svg.dataset.drawEnabled = String(Boolean(nodeData.bcPdfAnnotating));
    svg.replaceChildren();
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
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
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
      preview = this.createStrokePath({ points: active, color: "#e53935", width: 5 });
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
      const completed: PdfStroke = { points: active.slice(), color: "#e53935", width: 5 };
      preview?.remove();
      const strokes = readCanvasData(canvas).nodes.find((node: any) => node.id === nodeId) as any;
      const existing = Array.isArray(strokes?.bcPdfStrokes) ? strokes.bcPdfStrokes as PdfStroke[] : [];
      patchNode(canvas, nodeId, { bcPdfStrokes: [...existing, completed] });
      active = null;
      preview = null;
      pointerId = null;
      this.scheduleRefresh();
    };
    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);
  }
}
