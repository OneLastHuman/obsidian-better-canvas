import type { CanvasData, CanvasNodeData } from "./canvas";
import { resolveCanvasNodeShape, type CanvasNodeStyleSource } from "./canvas-node-style";
import { applyNodeVisualStyle, ROUNDED_MAP_PRESETS } from "./node-visual-style";

export const ROUNDED_MAP_INK = "#34372f";
export const ROUNDED_MAP_PAPER = "#faf9f5";
export const ROUNDED_MAP_STROKE = 4;
export const ROUNDED_MAP_RADIUS = 33;
/** Distance from the card edge to the selection halo, in CSS pixels. */
export const ROUNDED_MAP_SELECTION_GAP = 3;
/** Visible thickness of the selection halo. */
export const ROUNDED_MAP_SELECTION_THICKNESS = 2;

export function applyRoundedMapPreset(data: CanvasData, ids: readonly string[], presetId: string) {
  const preset = ROUNDED_MAP_PRESETS.find(item => item.id === presetId);
  if (!preset) return { data, updated: 0 };
  const targets = new Set(ids);
  return applyNodeVisualStyle(data, data.nodes
    .filter(node => targets.has(node.id) && node.type !== "group")
    .map(node => node.id), preset.style);
}

type Point = [number, number];
const n = (value: number): number => Math.round(value * 1000) / 1000;

function roundedPolygon(points: Point[], radius: number): string {
  const corners = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const before = Math.hypot(previous[0] - point[0], previous[1] - point[1]);
    const after = Math.hypot(next[0] - point[0], next[1] - point[1]);
    const distance = Math.min(radius, before / 3, after / 3);
    const toward = (other: Point, length: number): Point => [
      n(point[0] + (other[0] - point[0]) * distance / length),
      n(point[1] + (other[1] - point[1]) * distance / length)
    ];
    return { point, start: toward(previous, before), end: toward(next, after) };
  });
  return "M " + corners[0].start.join(" ") + corners.map((corner, index) =>
    " Q " + corner.point.join(" ") + " " + corner.end.join(" ") +
    " L " + corners[(index + 1) % corners.length].start.join(" ")
  ).join("") + " Z";
}

/** One path definition for live CSS clipping/rings, panel thumbnails and export. */
export function roundedMapPath(shape: string, width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 8 || height < 8) return null;
  const left = 2, top = 2, right = width - 2, bottom = height - 2;
  const w = right - left, h = bottom - top;
  const radius = Math.min(ROUNDED_MAP_RADIUS, w / 4, h / 4);
  const point = (x: number, y: number): Point => [n(left + x * w), n(top + y * h)];
  switch (shape) {
    case "default": case "square": case "pill": case "terminal": {
      const r = shape === "square" ? 0 : shape === "pill" || shape === "terminal" ? Math.min(w, h) / 2 : radius;
      return `M ${left + r} ${top} H ${right - r} Q ${right} ${top} ${right} ${top + r} V ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} H ${left + r} Q ${left} ${bottom} ${left} ${bottom - r} V ${top + r} Q ${left} ${top} ${left + r} ${top} Z`;
    }
    case "diamond": case "decision":
      return roundedPolygon([point(.5, 0), point(1, .5), point(.5, 1), point(0, .5)], radius * .55);
    case "right-arrow":
      return roundedPolygon([point(0, .2), point(.68, .2), point(.68, 0), point(1, .5),
        point(.68, 1), point(.68, .8), point(0, .8)], radius * .5);
    case "parallelogram": case "input-output":
      return roundedPolygon([point(.14, 0), point(1, 0), point(.86, 1), point(0, 1)], radius * .7);
    case "document":
      // Matching tangents join the wave to both vertical sides without a crease.
      return `M ${left + radius} ${top} H ${right - radius} Q ${right} ${top} ${right} ${top + radius}
        V ${n(top + h * .72)}
        C ${point(1, .84).join(" ")} ${point(.96, .86).join(" ")} ${point(.9, .82).join(" ")}
        C ${point(.84, .78).join(" ")} ${point(.16, .93).join(" ")} ${point(.1, .9).join(" ")}
        C ${point(.04, .87).join(" ")} ${point(0, .86).join(" ")} ${point(0, .76).join(" ")}
        V ${top + radius} Q ${left} ${top} ${left + radius} ${top} Z`.replace(/\s+/g, " ");
    default: return null;
  }
}

/** Rectangular content insets keep short labels clear of the shaped edges. */
export function roundedMapInsets(shape: string, width: number, height: number) {
  if (shape === "diamond" || shape === "decision") return { x: width * .26, y: height * .27, right: width * .26, bottom: height * .27 };
  if (shape === "right-arrow") return { x: width * .08, y: height * .25, right: width * .3, bottom: height * .25 };
  if (shape === "parallelogram" || shape === "input-output") return { x: width * .17, y: 16, right: width * .17, bottom: 16 };
  if (shape === "document") return { x: 24, y: 18, right: 24, bottom: height * .22 };
  return { x: Math.min(width * .16, 28), y: 18, right: Math.min(width * .16, 28), bottom: 18 };
}

function ringUrl(path: string, width: number, height: number, options: { dash?: string; stroke?: number } = {}): string {
  const stroke = options.stroke ?? ROUNDED_MAP_STROKE;
  // `none` keeps the mask in step with the element box even for the single
  // frame where a native drag has resized the node but this ring has not been
  // regenerated yet. Without it the SVG letterboxes and the outline visibly
  // detaches from the clipped face mid-drag.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="white" stroke-width="${stroke}" stroke-linejoin="round" ${options.dash ?? ""}/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Selection halo, matching what Obsidian does with
 * `box-shadow: 0 0 0 2px var(--color-accent)`: a ring at a fixed pixel
 * distance from the card, following its outline at every size.
 *
 * `box-shadow` can only follow `border-radius`, so a shaped card needs the
 * ring painted from its own path. Stroking that path expands it by a constant
 * distance on straight edges, diagonals and corners alike, which keeps the gap
 * identical for every preset. The previous `transform: scale(1.045)` scaled
 * the gap with the node, so the ring drifted away while resizing.
 *
 * The gap is measured from the card's painted edge: the ink border is stroked
 * 4px wide around the path, so it already extends `STROKE / 2` past it.
 */
function selectionUrl(path: string, width: number, height: number): string {
  const edge = ROUNDED_MAP_STROKE / 2;
  const inner = edge + ROUNDED_MAP_SELECTION_GAP;
  const outer = inner + ROUNDED_MAP_SELECTION_THICKNESS;
  const boxWidth = width + outer * 2;
  const boxHeight = height + outer * 2;
  // A white stroke sets the ring's outer bound and a black stroke inside the
  // SVG luminance mask clears the gap and the card interior.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}" viewBox="${-outer} ${-outer} ${boxWidth} ${boxHeight}" preserveAspectRatio="none">`
    + `<mask id="ring" maskUnits="userSpaceOnUse" x="${-outer}" y="${-outer}" width="${boxWidth}" height="${boxHeight}">`
    + `<path d="${path}" fill="white" stroke="white" stroke-width="${outer * 2}" stroke-linejoin="round"/>`
    + `<path d="${path}" fill="black" stroke="black" stroke-width="${inner * 2}" stroke-linejoin="round"/>`
    + `</mask>`
    + `<rect x="${-outer}" y="${-outer}" width="${boxWidth}" height="${boxHeight}" fill="white" mask="url(#ring)"/>`
    + `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function roundedMapCss(shape: string, width: number, height: number): Record<string, string> {
  const path = roundedMapPath(shape, width, height);
  if (!path) return {};
  const inset = roundedMapInsets(shape, width, height);
  const haloOutset = ROUNDED_MAP_STROKE / 2 + ROUNDED_MAP_SELECTION_GAP + ROUNDED_MAP_SELECTION_THICKNESS;
  return {
    "--bc-rounded-clip": `path("${path}")`,
    "--bc-rounded-ring": ringUrl(path, width, height),
    "--bc-rounded-dashed": ringUrl(path, width, height, { dash: 'stroke-dasharray="10 6"' }),
    "--bc-rounded-dotted": ringUrl(path, width, height, { dash: 'stroke-dasharray="1 8" stroke-linecap="round"' }),
    "--bc-rounded-selection": selectionUrl(path, width, height),
    "--bc-rounded-selection-inset": `${haloOutset}px`,
    "--bc-rounded-padding": `${inset.y}px ${inset.right}px ${inset.bottom}px ${inset.x}px`
  };
}

const CSS_KEYS = ["--bc-rounded-clip", "--bc-rounded-ring", "--bc-rounded-dashed", "--bc-rounded-dotted",
  "--bc-rounded-selection", "--bc-rounded-selection-inset", "--bc-rounded-padding"];

interface RoundedMapLive {
  observer: ResizeObserver;
  elements: Set<HTMLElement>;
}

/** One live observer per document: native drags resize nodes every frame. */
const liveRegistries = new Map<Document, RoundedMapLive>();

function liveRegistry(doc: Document | undefined): RoundedMapLive | null {
  if (!doc) return null;
  const existing = liveRegistries.get(doc);
  if (existing) return existing;
  const Observer = (doc.defaultView as any)?.ResizeObserver;
  if (typeof Observer !== "function") return null;
  const registry: RoundedMapLive = {
    observer: new Observer((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) refreshRoundedMapGeometry(entry.target as HTMLElement);
    }),
    elements: new Set()
  };
  liveRegistries.set(doc, registry);
  return registry;
}

function detachRoundedMapGeometry(el: HTMLElement | undefined): void {
  if (!el) return;
  const registry = liveRegistries.get(el.ownerDocument);
  if (!registry) return;
  registry.observer.unobserve(el);
  registry.elements.delete(el);
}

/**
 * Re-derive the size-dependent clip, ring and safe area from the element's
 * current box. Called on every native resize frame so the face, outline and
 * text padding never lag behind the pointer.
 */
export function refreshRoundedMapGeometry(el: HTMLElement): boolean {
  if (!el?.dataset?.bcRounded || !el.style) return false;
  const shape = el.dataset.bcRoundedShape || "default";
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const css = roundedMapCss(shape, width, height);
  if (!Object.keys(css).length) return false;
  let changed = false;
  for (const [key, value] of Object.entries(css)) {
    if (el.style.getPropertyValue(key) === value) continue;
    el.style.setProperty(key, value);
    changed = true;
  }
  // Auto-resize nodes use the shared safe-area variable instead of the theme
  // padding; keep it in step while the user drags the node itself.
  if (el.dataset.bcAutoShape === "true") {
    const inset = roundedMapInsets(shape, width, height);
    const padding = `${inset.y}px ${inset.right}px ${inset.bottom}px ${inset.x}px`;
    if (el.style.getPropertyValue("--bc-auto-content-padding") !== padding) {
      el.style.setProperty("--bc-auto-content-padding", padding);
      changed = true;
    }
  }
  return changed;
}

function attachRoundedMapGeometry(el: HTMLElement, shape: string): void {
  el.dataset.bcRoundedShape = shape;
  const registry = liveRegistry(el.ownerDocument);
  if (!registry) return;
  registry.elements.add(el);
  registry.observer.observe(el);
}

/** Forget nodes the Canvas culled, re-rendered or stopped painting. */
export function pruneRoundedMapGeometry(doc: Document | undefined): void {
  if (!doc) return;
  const registry = liveRegistries.get(doc);
  if (!registry) return;
  for (const el of registry.elements) {
    if (typeof el.isConnected === "boolean" && !el.isConnected) detachRoundedMapGeometry(el);
  }
}

export function stopRoundedMapGeometry(): void {
  for (const registry of liveRegistries.values()) registry.observer.disconnect();
  liveRegistries.clear();
}

export function clearRoundedMapNode(el: HTMLElement): void {
  if (!el?.dataset?.bcRounded) return;
  detachRoundedMapGeometry(el);
  delete el.dataset.bcRounded;
  delete el.dataset.bcRoundedShape;
  for (const key of CSS_KEYS) el.style?.removeProperty(key);
}

export function decorateRoundedMapNode(el: HTMLElement, node: CanvasNodeData): void {
  if (node.type === "group") { clearRoundedMapNode(el); return; }
  const shape = resolveCanvasNodeShape(node as CanvasNodeStyleSource);
  const css = roundedMapCss(shape, node.width, node.height);
  if (!Object.keys(css).length) { clearRoundedMapNode(el); return; }
  el.dataset.bcRounded = "true";
  for (const [key, value] of Object.entries(css)) {
    if (el.style?.getPropertyValue(key) !== value) el.style?.setProperty(key, value);
  }
  attachRoundedMapGeometry(el, shape);
}
