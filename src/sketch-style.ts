import { t } from "./i18n";
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
    id: "heading", label: t("Section heading", "章节标题"), use: t("Organize the reading order", "组织阅读顺序"), sample: t("Kick-off", "项目启动"),
    style: { shape: "square", fill: "none", color: "#d9b64a", border: "invisible", align: "left", fontSize: 30 }
  },
  {
    id: "concept", label: t("Core concept", "核心概念"), use: t("Focus the discussion", "聚焦讨论对象"), sample: t("User needs", "用户需求"),
    style: { shape: "ellipse", fill: "hachure", color: "#719cf4", border: "solid", align: "center", fontSize: 24 }
  },
  {
    id: "action", label: t("Action step", "行动步骤"), use: t("Name a concrete action", "表达具体动作"), sample: t("Interview users", "访谈用户"),
    style: { shape: "square", fill: "hachure", color: "#78b58c", border: "solid", align: "center", fontSize: 24 }
  },
  {
    id: "decision", label: t("Decision branch", "判断分支"), use: t("State the branch condition", "提出分支条件"), sample: t("Validated?", "验证通过？"),
    style: { shape: "diamond", fill: "solid", color: "#e8b75a", border: "solid", align: "center", fontSize: 22 }
  },
  {
    id: "annotation", label: t("Side note", "旁注说明"), use: t("Add background", "补充背景信息"), sample: t("For context", "补充说明"),
    style: { shape: "square", fill: "none", color: "#89919d", border: "invisible", align: "left", fontSize: 20 }
  },
  {
    id: "risk", label: t("Risk flag", "风险提醒"), use: t("Mark items to confirm", "标记待确认事项"), sample: t("Needs confirmation", "需要确认"),
    style: { shape: "square", fill: "cross-hatch", color: "#e8798f", border: "dashed", align: "left", fontSize: 24 }
  }
] as const;

export const SKETCH_COLORS = [
  { id: "blue", label: t("Misty blue", "雾蓝"), value: "#719cf4" },
  { id: "green", label: t("Light green", "浅绿"), value: "#78b58c" },
  { id: "amber", label: t("Light yellow", "浅黄"), value: "#e8b75a" },
  { id: "rose", label: t("Light pink", "浅粉"), value: "#e8798f" },
  { id: "teal", label: t("Teal green", "青绿"), value: "#65b9a7" },
  { id: "slate", label: t("Slate", "石板灰"), value: "#89919d" }
] as const;

export const SKETCH_FILLS: ReadonlyArray<{ id: SketchFill; label: string }> = [
  { id: "none", label: t("None", "留白") },
  { id: "solid", label: t("Solid", "淡彩") },
  { id: "hachure", label: t("Hachure", "排线") },
  { id: "cross-hatch", label: t("Cross-hatch", "交叉排线") }
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
