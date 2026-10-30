import type { CanvasData, CanvasNodeData } from "./canvas";

export type SoftNotesPresetId = "spark" | "excerpt" | "concept" | "action" | "question" | "free";

export interface SoftNotesPreset {
  id: SoftNotesPresetId;
  label: string;
  use: string;
  color: string;
  align: "left" | "center";
  path: string;
  /** Content safe area in fractions of the node: top, right, bottom, left. */
  inset: readonly [number, number, number, number];
}

/** Shared by live nodes, preset thumbnails and full-canvas export. */
export const SOFT_NOTES_PRESETS: readonly SoftNotesPreset[] = [
  {
    id: "spark", label: "灵感卡", use: "鹅卵石 · 随手记下一个念头", color: "#efd4f7", align: "left",
    path: "M157,15C226,10 280,40 298,91C316,142 284,197 224,216C164,235 83,223 39,185C4,155 6,105 33,68C58,34 105,19 157,15Z",
    inset: [.20, .18, .18, .20]
  },
  {
    id: "excerpt", label: "摘录卡", use: "折角书页 · 保留原话与出处", color: "#bce7f7", align: "left",
    path: "M70,12H215C224,12 228,15 234,21L268,53C274,59 277,65 277,75V204C277,221 267,230 250,230H70C53,230 43,220 43,204V38C43,22 53,12 70,12Z",
    inset: [.22, .21, .12, .21]
  },
  {
    id: "concept", label: "概念卡", use: "胶囊 · 一个完整的知识单元", color: "#d0f3ad", align: "center",
    path: "M88,49H232C276,49 309,77 309,120C309,163 276,191 232,191H88C44,191 11,163 11,120C11,77 44,49 88,49Z",
    inset: [.26, .16, .26, .16]
  },
  {
    id: "action", label: "行动卡", use: "清单页签 · 一项项完成", color: "#fff1a5", align: "left",
    path: "M52,36H92C102,36 108,29 112,23C118,14 124,10 136,10H183C197,10 203,17 208,27C212,34 218,38 230,38H265C292,38 307,55 307,82V185C307,212 292,228 264,228H55C27,228 13,213 13,186V72C13,48 27,36 52,36Z",
    inset: [.25, .14, .12, .14]
  },
  {
    id: "question", label: "问题卡", use: "对话气泡 · 留下一个问题", color: "#ffdbcb", align: "left",
    path: "M60,18H260C290,18 307,35 307,65V136C307,168 291,184 260,184H150C130,184 106,212 75,224C62,229 57,221 67,211C78,201 85,192 84,188C83,184 70,184 60,184C28,184 13,168 13,136V65C13,35 30,18 60,18Z",
    inset: [.13, .13, .27, .13]
  },
  {
    id: "free", label: "自由文字", use: "透明留白 · 中心想法、标题与旁注", color: "transparent", align: "center",
    path: "", inset: [.08, .06, .08, .06]
  }
];

export const SOFT_NOTES_COLORS = [
  { id: "lilac", label: "淡紫", value: "#efd4f7" },
  { id: "sky", label: "天蓝", value: "#bce7f7" },
  { id: "green", label: "嫩绿", value: "#d0f3ad" },
  { id: "yellow", label: "奶黄", value: "#fff1a5" },
  { id: "peach", label: "浅桃", value: "#ffdbcb" }
] as const;

export function softNotesPreset(value: unknown): SoftNotesPreset {
  return SOFT_NOTES_PRESETS.find(preset => preset.id === value) ?? SOFT_NOTES_PRESETS[0];
}

export function resolveSoftNotesStyle(node: CanvasNodeData): {
  preset: SoftNotesPreset; color: string; align: "left" | "center" | "right";
} {
  const preset = softNotesPreset(node.bcSoftNotesPreset);
  const attrs = node.styleAttributes as Record<string, unknown> | undefined;
  const rawAlign = node.bcTextAlign ?? attrs?.textAlign ?? preset.align;
  // Only accept a hex colour, never arbitrary CSS or SVG supplied through JSON.
  const color = preset.id === "free" ? "transparent"
    : typeof node.color === "string" && /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : preset.color;
  return { preset, color, align: rawAlign === "center" || rawAlign === "right" ? rawAlign : "left" };
}

export function applySoftNotesPreset(
  data: CanvasData, ids: readonly string[], presetId: string
): { data: CanvasData; updated: number } {
  const preset = SOFT_NOTES_PRESETS.find(item => item.id === presetId);
  const targets = new Set(ids);
  if (!preset || !targets.size) return { data, updated: 0 };
  let updated = 0;
  const nodes = data.nodes.map(node => {
    if (!targets.has(node.id) || node.type !== "text") return node;
    updated++;
    const attrs = node.styleAttributes && typeof node.styleAttributes === "object" && !Array.isArray(node.styleAttributes)
      ? node.styleAttributes as Record<string, unknown> : {};
    const next: CanvasNodeData = {
      ...node, bcSoftNotesPreset: preset.id, bcShape: "default",
      bcBorderStyle: "invisible", bcTextAlign: preset.align,
      styleAttributes: { ...attrs, shape: "rectangle", border: "invisible", textAlign: preset.align }
    };
    if (preset.id === "free") delete next.color;
    else next.color = preset.color;
    return next;
  });
  return updated ? { data: { ...data, nodes }, updated } : { data, updated };
}

export function softNotesClip(preset: SoftNotesPreset): string {
  return preset.path ? "url(#bc-soft-clip-" + preset.id + ")" : "none";
}

/** SVG object-bounding-box clips keep the same smooth curves at every node size. */
export function ensureSoftNotesGeometry(doc: Document): void {
  if (!doc.body || doc.getElementById("bc-soft-geometry")) return;
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "bc-soft-geometry";
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("bc-soft-geometry");
  const defs = doc.createElementNS(svg.namespaceURI, "defs");
  for (const preset of SOFT_NOTES_PRESETS.filter(item => item.path)) {
    const clip = doc.createElementNS(svg.namespaceURI, "clipPath");
    clip.setAttribute("id", "bc-soft-clip-" + preset.id);
    clip.setAttribute("clipPathUnits", "objectBoundingBox");
    const path = doc.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", preset.path);
    path.setAttribute("transform", "scale(0.003125 0.004166666667)");
    clip.appendChild(path);
    defs.appendChild(clip);
  }
  svg.appendChild(defs);
  doc.body.appendChild(svg);
}

export function clearSoftNotesNode(el: HTMLElement): void {
  if (!el.dataset.bcSoftNotes) return;
  delete el.dataset.bcSoftNotes;
  for (const name of ["clip", "color", "align", "top", "right", "bottom", "left"]) {
    el.style.removeProperty("--bc-soft-" + name);
  }
}

export function decorateSoftNotesNode(el: HTMLElement, node: CanvasNodeData): void {
  if (node.type !== "text") { clearSoftNotesNode(el); return; }
  ensureSoftNotesGeometry(el.ownerDocument);
  const { preset, color, align } = resolveSoftNotesStyle(node);
  el.dataset.bcSoftNotes = preset.id;
  el.style.setProperty("--bc-soft-clip", softNotesClip(preset));
  el.style.setProperty("--bc-soft-color", color);
  el.style.setProperty("--bc-soft-align", align);
  const dimensions = [node.height, node.width, node.height, node.width];
  ["top", "right", "bottom", "left"].forEach((side, index) => {
    // CSS vertical padding percentages resolve against width, so use actual
    // geometry here; decorations are refreshed on the native resize events.
    el.style.setProperty("--bc-soft-" + side, (preset.inset[index] * dimensions[index]) + "px");
  });
}
