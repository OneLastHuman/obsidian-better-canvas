import { RoughGenerator } from "roughjs/bin/generator.js";
import { readCanvasData, type CanvasNodeData } from "./canvas";
import { resolveSketchStyle } from "./sketch-style";

export const SKETCH_EDGE_FILTER_ID = "bc-sketch-wobble";
export const SKETCH_FRAME_CLASS = "bc-sketch-frame";
export const SKETCH_DEFS_CLASS = "bc-sketch-defs";

const generator = new RoughGenerator();

export interface SketchNodeSvgOptions {
  /** Ink colour. DOM decoration uses currentColor so light/dark themes follow the host. */
  ink?: string;
  fillOpacity?: number;
}

function number(value: unknown, fallback: number): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

/** Stable per-node seed: a resize redraws the same wobble instead of shimmering. */
export function sketchSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

function roundedRectPath(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const w = width;
  const h = height;
  return [
    "M", r, 0,
    "L", w - r, 0,
    "Q", w, 0, w, r,
    "L", w, h - r,
    "Q", w, h, w - r, h,
    "L", r, h,
    "Q", 0, h, 0, h - r,
    "L", 0, r,
    "Q", 0, 0, r, 0,
    "Z"
  ].join(" ");
}

function shapePath(shape: string, width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  switch (shape) {
    case "pill":
      return roundedRectPath(w, h, Math.min(w, h) / 2);
    case "diamond":
    case "decision":
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
    case "hexagon":
      return `M ${w * 0.25} 0 L ${w * 0.75} 0 L ${w} ${h / 2} L ${w * 0.75} ${h} L ${w * 0.25} ${h} L 0 ${h / 2} Z`;
    case "document":
      return `M 0 0 L ${w} 0 L ${w} ${h * 0.9} C ${w * 0.82} ${h} ${w * 0.68} ${h * 0.82} ${w * 0.5} ${h * 0.92} C ${w * 0.32} ${h} ${w * 0.18} ${h * 0.82} 0 ${h * 0.9} Z`;
    case "database": {
      const ry = Math.min(h * 0.12, 16);
      return `M 0 ${ry} C 0 ${-ry} ${w} ${-ry} ${w} ${ry} L ${w} ${h - ry} C ${w} ${h + ry} 0 ${h + ry} 0 ${h - ry} Z`;
    }
    default:
      return roundedRectPath(w, h, shape === "square" ? 3 : 8);
  }
}

function fillMarkup(node: CanvasNodeData, width: number, height: number, style: ReturnType<typeof resolveSketchStyle>, options: SketchNodeSvgOptions): string {
  if (style.fill === "none") return "";
  const seed = sketchSeed(node.id + ":fill");
  const base = {
    seed,
    stroke: "none",
    fill: style.color,
    fillStyle: style.fill === "cross-hatch" ? "cross-hatch" : style.fill === "hachure" ? "hachure" : "solid",
    fillWeight: style.fill === "solid" ? 1 : 0.8,
    hachureGap: 9,
    hachureAngle: -48,
    roughness: 1.2,
    bowing: 0.6,
    disableMultiStroke: true
  };
  const drawable = style.shape === "ellipse" || style.shape === "circle"
    ? generator.ellipse(width / 2, height / 2, width - 4, height - 4, base)
    : generator.path(shapePath(style.shape, width, height), base);
  return `<g opacity="${options.fillOpacity ?? (style.fill === "solid" ? 0.24 : 0.58)}">${pathsToMarkup(drawable)}</g>`;
}

function pathsToMarkup(drawable: ReturnType<RoughGenerator["line"]>): string {
  return generator.toPaths(drawable).map(path =>
    `<path d="${path.d}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" ` +
    `fill="${path.fill ?? "none"}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join("");
}

function outlineMarkup(node: CanvasNodeData, width: number, height: number, style: ReturnType<typeof resolveSketchStyle>, ink: string): string {
  if (style.border === "invisible" || node.type === "group" && style.border === "invisible") return "";
  const seed = sketchSeed(node.id + ":outline");
  const dash = style.border === "dashed" ? [8, 6] : style.border === "dotted" ? [1.5, 5] : undefined;
  const base = {
    seed,
    stroke: ink,
    strokeWidth: node.type === "group" ? 1.2 : 1.8,
    roughness: style.preset?.id === "risk" ? 1.9 : 1.55,
    bowing: 1.35,
    strokeLineDash: dash,
    fill: "none",
    disableMultiStroke: false
  };
  const drawable = style.shape === "ellipse" || style.shape === "circle"
    ? generator.ellipse(width / 2, height / 2, width - 3, height - 3, base)
    : generator.path(shapePath(style.shape, width, height), base);
  return `<g opacity="${node.type === "group" ? 0.55 : 1}">${pathsToMarkup(drawable)}</g>`;
}

function ornamentMarkup(node: CanvasNodeData, width: number, height: number, style: ReturnType<typeof resolveSketchStyle>, ink: string): string {
  if (style.preset?.id !== "heading") return "";
  const seed = sketchSeed(node.id + ":rule");
  const length = Math.min(Math.max(72, width - 32), 220);
  const y = height - 11;
  const drawable = generator.line(16, y, 16 + length, y + 1.5, {
    seed,
    stroke: style.color,
    strokeWidth: 3,
    roughness: 1.3,
    bowing: 1,
    disableMultiStroke: true
  });
  return pathsToMarkup(drawable);
}

/** SVG markup in node-local coordinates (0,0 to width,height). */
export function renderSketchNodeSvg(node: CanvasNodeData, options: SketchNodeSvgOptions = {}): string {
  const width = Math.max(1, number(node.width, 280));
  const height = Math.max(1, number(node.height, 140));
  const style = resolveSketchStyle(node);
  const ink = options.ink ?? "currentColor";
  if (node.type === "group") {
    const groupStyle = { ...style, fill: "none" as const, border: "dashed" };
    return outlineMarkup(node, width, height, groupStyle, ink);
  }
  return [
    fillMarkup(node, width, height, style, options),
    outlineMarkup(node, width, height, style, ink),
    ornamentMarkup(node, width, height, style, ink)
  ].join("");
}

/** A small inline preview used by the style panel. */
export function sketchPresetPreviewSvg(presetId: string, width = 116, height = 48): string {
  const node: CanvasNodeData = {
    id: "preview-" + presetId,
    type: "text",
    x: 0, y: 0, width, height,
    text: "",
    bcSketchPreset: presetId
  };
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">${renderSketchNodeSvg(node, { ink: "currentColor", fillOpacity: 0.7 })}</svg>`;
}

export function sketchEdgeFilterDefs(id = SKETCH_EDGE_FILTER_ID): string {
  return `<svg class="${SKETCH_DEFS_CLASS}" width="0" height="0" aria-hidden="true" focusable="false">` +
    `<defs><filter id="${id}" x="-8%" y="-20%" width="116%" height="140%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="7" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="0.75" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter></defs></svg>`;
}

function nodeElement(canvas: any, nodeId: string): HTMLElement | null {
  if (typeof HTMLElement === "undefined") return null;
  const node = canvas?.nodes?.get?.(nodeId);
  const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
  if (!(element instanceof HTMLElement)) return null;
  return element;
}

function nodeContainer(element: HTMLElement): HTMLElement | null {
  if (typeof HTMLElement === "undefined") return null;
  if (element.classList.contains("canvas-node-container")) return element;
  const container = element.querySelector?.(".canvas-node-container");
  return container instanceof HTMLElement ? container : null;
}

function nodeSignature(node: CanvasNodeData): string {
  const style = resolveSketchStyle(node);
  return [node.width, node.height, style.shape, style.fill, style.color, style.border, style.align, style.preset?.id ?? ""].join("|");
}

/** Parse generated SVG markup without trusting it as HTML. */
function parseSvgMarkup(doc: Document, markup: string): Element | null {
  const trimmed = markup.trim();
  if (!trimmed) return null;
  const source = trimmed.startsWith("<svg")
    ? trimmed
    : '<svg xmlns="http://www.w3.org/2000/svg">' + trimmed + "</svg>";
  const Parser = doc.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) return null;
  return doc.importNode(root, true);
}

function appendSvgMarkup(target: Element, markup: string): boolean {
  const root = parseSvgMarkup(target.ownerDocument, markup);
  if (!root) return false;
  for (const child of Array.from(root.childNodes)) target.appendChild(child);
  return true;
}

/**
 * Layer the hand-drawn outline over native Canvas nodes. The SVG is
 * pointer-events:none and the node's rectangular interaction model is unchanged.
 */
export function decorateSketchCanvas(canvas: any): void {
  const data = readCanvasData(canvas);
  const wrapper = canvas?.wrapperEl;
  if (typeof document === "undefined") return;
  if (wrapper?.querySelector && !wrapper.querySelector("." + SKETCH_DEFS_CLASS)) {
    const defs = parseSvgMarkup(wrapper.ownerDocument, sketchEdgeFilterDefs());
    if (defs && typeof wrapper.appendChild === "function") wrapper.appendChild(defs);
  }
  for (const item of data.nodes) {
    const element = nodeElement(canvas, item.id);
    const container = element ? nodeContainer(element) : null;
    if (!element || !container?.dataset || typeof container.insertBefore !== "function") continue;
    const style = resolveSketchStyle(item);
    element.dataset.bcSketch = style.preset?.id ?? "free";
    element.dataset.bcSketchFill = style.fill;
    element.dataset.bcSketchColor = style.color;
    if (style.preset) element.dataset.bcSketchPreset = style.preset.id;
    else delete element.dataset.bcSketchPreset;

    const signature = nodeSignature(item);
    const existing = container.querySelector?.("svg." + SKETCH_FRAME_CLASS);
    if (existing instanceof SVGElement && existing.dataset.signature === signature) continue;
    existing?.remove();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", SKETCH_FRAME_CLASS);
    svg.setAttribute("viewBox", `0 0 ${Math.max(1, number(item.width, 280))} ${Math.max(1, number(item.height, 140))}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.dataset.signature = signature;
    appendSvgMarkup(svg, renderSketchNodeSvg(item, { ink: "currentColor" }));
    container.insertBefore(svg, container.firstChild);
  }
}

/** Remove every overlay and data attribute added by the sketch theme. */
export function clearSketchCanvas(canvas: any): void {
  const wrapper = canvas?.wrapperEl;
  for (const svg of wrapper?.querySelectorAll?.("svg." + SKETCH_FRAME_CLASS) ?? []) svg.remove?.();
  for (const defs of wrapper?.querySelectorAll?.("." + SKETCH_DEFS_CLASS) ?? []) defs.remove?.();
  for (const element of wrapper?.querySelectorAll?.("[data-bc-sketch]") ?? []) {
    if (!element.dataset) continue;
    delete element.dataset.bcSketch;
    delete element.dataset.bcSketchPreset;
    delete element.dataset.bcSketchFill;
    delete element.dataset.bcSketchColor;
  }
}
