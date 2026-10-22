import type { CanvasData, CanvasNodeData } from "./canvas";
import { resolveCanvasNodeShape, type CanvasNodeStyleSource } from "./canvas-node-style";
import { applyNodeVisualStyle, ROUNDED_MAP_PRESETS } from "./node-visual-style";

export const ROUNDED_MAP_INK = "#34372f";
export const ROUNDED_MAP_PAPER = "#faf9f5";
export const ROUNDED_MAP_STROKE = 4;
export const ROUNDED_MAP_RADIUS = 33;

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

function ringUrl(path: string, width: number, height: number, dash = ""): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path}" fill="none" stroke="white" stroke-width="${ROUNDED_MAP_STROKE}" stroke-linejoin="round" ${dash}/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function roundedMapCss(shape: string, width: number, height: number): Record<string, string> {
  const path = roundedMapPath(shape, width, height);
  if (!path) return {};
  const inset = roundedMapInsets(shape, width, height);
  return {
    "--bc-rounded-clip": `path("${path}")`,
    "--bc-rounded-ring": ringUrl(path, width, height),
    "--bc-rounded-dashed": ringUrl(path, width, height, 'stroke-dasharray="10 6"'),
    "--bc-rounded-dotted": ringUrl(path, width, height, 'stroke-dasharray="1 8" stroke-linecap="round"'),
    "--bc-rounded-padding": `${inset.y}px ${inset.right}px ${inset.bottom}px ${inset.x}px`
  };
}

const CSS_KEYS = ["--bc-rounded-clip", "--bc-rounded-ring", "--bc-rounded-dashed", "--bc-rounded-dotted", "--bc-rounded-padding"];

export function clearRoundedMapNode(el: HTMLElement): void {
  if (!el?.dataset?.bcRounded) return;
  delete el.dataset.bcRounded;
  for (const key of CSS_KEYS) el.style?.removeProperty(key);
}

export function decorateRoundedMapNode(el: HTMLElement, node: CanvasNodeData): void {
  if (node.type === "group") { clearRoundedMapNode(el); return; }
  const css = roundedMapCss(resolveCanvasNodeShape(node as CanvasNodeStyleSource), node.width, node.height);
  if (!Object.keys(css).length) { clearRoundedMapNode(el); return; }
  el.dataset.bcRounded = "true";
  for (const [key, value] of Object.entries(css)) {
    if (el.style?.getPropertyValue(key) !== value) el.style?.setProperty(key, value);
  }
}
