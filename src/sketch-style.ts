import type { CanvasData, CanvasNodeData } from "./canvas";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape, type CanvasNodeStyleSource } from "./canvas-node-style";

export type SketchPresetId = "heading" | "concept" | "action" | "decision" | "annotation" | "risk";
export type SketchFill = "none" | "solid" | "hachure" | "cross-hatch";

export interface SketchPresetStyle {
  shape: string;
  fill: SketchFill;
  color: string;
  border: string;
  align: "left" | "center" | "right";
  fontSize: number;
}

export interface SketchPreset {
  id: SketchPresetId;
  label: string;
  use: string;
  sample: string;
  style: SketchPresetStyle;
}

/**
 * Six functional presets built from the visual vocabulary Excalidraw exposes:
 * shape, fill style, stroke style, alignment and a restrained accent colour.
 * They are Better Canvas combinations, not Excalidraw's own preset names.
 */
export const SKETCH_PRESETS: readonly SketchPreset[] = [
  {
    id: "heading", label: "章节标题", use: "组织阅读顺序", sample: "项目启动",
    style: { shape: "square", fill: "none", color: "#d9b64a", border: "invisible", align: "left", fontSize: 30 }
  },
  {
    id: "concept", label: "核心概念", use: "聚焦讨论对象", sample: "用户需求",
    style: { shape: "ellipse", fill: "hachure", color: "#719cf4", border: "solid", align: "center", fontSize: 24 }
  },
  {
    id: "action", label: "行动步骤", use: "表达具体动作", sample: "访谈用户",
    style: { shape: "square", fill: "hachure", color: "#78b58c", border: "solid", align: "center", fontSize: 24 }
  },
  {
    id: "decision", label: "判断分支", use: "提出分支条件", sample: "验证通过？",
    style: { shape: "diamond", fill: "solid", color: "#e8b75a", border: "solid", align: "center", fontSize: 22 }
  },
  {
    id: "annotation", label: "旁注说明", use: "补充背景信息", sample: "补充说明",
    style: { shape: "square", fill: "none", color: "#89919d", border: "invisible", align: "left", fontSize: 20 }
  },
  {
    id: "risk", label: "风险提醒", use: "标记待确认事项", sample: "需要确认",
    style: { shape: "square", fill: "cross-hatch", color: "#e8798f", border: "dashed", align: "left", fontSize: 24 }
  }
] as const;

export const SKETCH_COLORS = [
  { id: "blue", label: "雾蓝", value: "#719cf4" },
  { id: "green", label: "浅绿", value: "#78b58c" },
  { id: "amber", label: "浅黄", value: "#e8b75a" },
  { id: "rose", label: "浅粉", value: "#e8798f" },
  { id: "teal", label: "青绿", value: "#65b9a7" },
  { id: "slate", label: "石板灰", value: "#89919d" }
] as const;

export const SKETCH_FILLS: ReadonlyArray<{ id: SketchFill; label: string }> = [
  { id: "none", label: "留白" },
  { id: "solid", label: "淡彩" },
  { id: "hachure", label: "排线" },
  { id: "cross-hatch", label: "交叉排线" }
];

export interface ResolvedSketchStyle {
  preset: SketchPreset | null;
  shape: string;
  fill: SketchFill;
  color: string;
  border: string;
  align: "left" | "center" | "right";
  fontSize: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function sketchPreset(value: unknown): SketchPreset | null {
  return SKETCH_PRESETS.find(preset => preset.id === value) ?? null;
}

export function sketchFill(value: unknown): SketchFill | null {
  return SKETCH_FILLS.some(fill => fill.id === value) ? value as SketchFill : null;
}

export function resolveSketchStyle(node: CanvasNodeData): ResolvedSketchStyle {
  const attrs = record(node.styleAttributes);
  const preset = sketchPreset(node.bcSketchPreset);
  const explicitShape = typeof node.bcShape === "string" || typeof attrs.shape === "string";
  const explicitBorder = typeof node.bcBorderStyle === "string" || typeof attrs.border === "string";
  const explicitAlign = typeof node.bcTextAlign === "string" || typeof attrs.textAlign === "string";
  const explicitColor = typeof node.color === "string" && node.color.trim().length > 0;
  const explicitFill = sketchFill(node.bcSketchFill);
  const shape = explicitShape ? resolveCanvasNodeShape(node as CanvasNodeStyleSource) : preset?.style.shape ?? "default";
  const border = explicitBorder ? resolveCanvasNodeBorder(node as CanvasNodeStyleSource) : preset?.style.border ?? "solid";
  const alignRaw = explicitAlign
    ? node.bcTextAlign ?? attrs.textAlign
    : preset?.style.align ?? "left";
  const align = alignRaw === "center" || alignRaw === "right" ? alignRaw : "left";
  return {
    preset,
    shape: shape === "rectangle" ? "square" : shape,
    fill: explicitFill ?? preset?.style.fill ?? "none",
    color: explicitColor ? String(node.color) : preset?.style.color ?? "#89919d",
    border,
    align,
    fontSize: preset?.style.fontSize ?? 20
  };
}

function styleAttributesFor(preset: SketchPreset): Record<string, unknown> {
  return {
    shape: preset.style.shape === "square" ? "rectangle" : preset.style.shape,
    border: preset.style.border,
    textAlign: preset.style.align
  };
}

/** Apply a whole functional preset to eligible nodes, preserving content and unknown fields. */
export function applySketchPreset(
  data: CanvasData,
  ids: readonly string[],
  presetId: string
): { data: CanvasData; updated: number } {
  const preset = sketchPreset(presetId);
  const targets = new Set(ids);
  if (!preset || targets.size === 0) return { data, updated: 0 };
  let updated = 0;
  const nodes = data.nodes.map(node => {
    if (!targets.has(node.id) || node.type === "group") return node;
    updated += 1;
    return {
      ...node,
      bcSketchPreset: preset.id,
      bcSketchFill: preset.style.fill,
      bcShape: preset.style.shape,
      bcBorderStyle: preset.style.border,
      bcTextAlign: preset.style.align,
      color: preset.style.color,
      styleAttributes: { ...record(node.styleAttributes), ...styleAttributesFor(preset) }
    };
  });
  return updated === 0 ? { data, updated } : { data: { ...data, nodes }, updated };
}

/** Change only the sketch fill treatment, leaving shape, colour, text and edges intact. */
export function applySketchFill(
  data: CanvasData,
  ids: readonly string[],
  fill: string
): { data: CanvasData; updated: number } {
  const nextFill = sketchFill(fill);
  const targets = new Set(ids);
  if (!nextFill || targets.size === 0) return { data, updated: 0 };
  let updated = 0;
  const nodes = data.nodes.map(node => {
    if (!targets.has(node.id) || node.type === "group") return node;
    updated += 1;
    return { ...node, bcSketchFill: nextFill };
  });
  return updated === 0 ? { data, updated } : { data: { ...data, nodes }, updated };
}

export function isSketchFill(value: unknown): value is SketchFill {
  return sketchFill(value) !== null;
}
