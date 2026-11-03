import { t } from "./i18n";
import type { CanvasData, CanvasNodeData } from "./canvas";

export type NodeVisualStyle = {
  color: string;
  shape: string;
  border: string;
  align: string;
};

export type NodeVisualStylePatch = {
  color?: string | null;
  shape?: string;
  border?: string;
  align?: string;
};

/**
 * Style panel option lists. `label` is the accessible name and hover tooltip
 * only: the panel renders shapes, borders, alignments and presets as previews
 * or icons, so no option name is printed inside the panel.
 */
export const NODE_STYLE_COLORS = [
  { id: "red", label: t("Red", "红色"), value: "#e8798f" },
  { id: "orange", label: t("Orange", "橙色"), value: "#f59e72" },
  { id: "amber", label: t("Amber", "琥珀色"), value: "#e8b75a" },
  { id: "yellow", label: t("Yellow", "黄色"), value: "#d4c75b" },
  { id: "lime", label: t("Lime", "青柠色"), value: "#a3be6c" },
  { id: "green", label: t("Green", "绿色"), value: "#78b58c" },
  { id: "emerald", label: t("Emerald", "翠绿色"), value: "#65b9a7" },
  { id: "teal", label: t("Teal", "蓝绿色"), value: "#62b8bd" },
  { id: "cyan", label: t("Cyan", "青色"), value: "#66bdd1" },
  { id: "sky", label: t("Sky blue", "天蓝色"), value: "#72b4e8" },
  { id: "blue", label: t("Blue", "蓝色"), value: "#719cf4" },
  { id: "indigo", label: t("Indigo", "靛蓝色"), value: "#8a92ed" },
  { id: "violet", label: t("Violet", "紫罗兰色"), value: "#a58bea" },
  { id: "purple", label: t("Purple", "紫色"), value: "#b28ad7" },
  { id: "fuchsia", label: t("Fuchsia", "洋红色"), value: "#d18bd0" },
  { id: "pink", label: t("Pink", "粉色"), value: "#e58eb4" },
  { id: "rose", label: t("Rose", "玫红色"), value: "#dc8298" },
  { id: "brown", label: t("Brown", "棕色"), value: "#b08968" },
  { id: "slate", label: t("Slate", "石板灰"), value: "#8b9bb4" },
  { id: "gray", label: t("Gray", "灰色"), value: "#89919d" }
] as const;

export const NODE_STYLE_SHAPES = [
  { id: "default", label: t("Rounded rectangle", "圆角矩形") },
  { id: "square", label: t("Rectangle", "矩形") },
  { id: "pill", label: t("Pill", "胶囊形") },
  { id: "diamond", label: t("Diamond", "菱形") },
  { id: "right-arrow", label: t("Flow arrow", "流转箭头") },
  { id: "parallelogram", label: t("Input / output", "输入 / 输出") },
  { id: "circle", label: t("Circle", "圆形") },
  { id: "ellipse", label: t("Ellipse", "椭圆形") },
  { id: "hexagon", label: t("Hexagon", "六边形") },
  { id: "document", label: t("Document", "文档") },
  { id: "database", label: t("Database", "数据库") }
] as const;

/**
 * Border choices render as icon glyphs in a segmented control, matching the
 * alignment control: a row of miniature outline strokes reads faster than
 * five boxed samples and keeps the row one line tall.
 */
export const NODE_STYLE_BORDERS = [
  { id: "solid", label: t("Solid", "实线"), icon: "border-solid" },
  { id: "dashed", label: t("Dashed", "虚线"), icon: "border-dashed" },
  { id: "dotted", label: t("Dotted", "点线"), icon: "border-dotted" },
  { id: "double", label: t("Double", "双线"), icon: "border-double" },
  { id: "invisible", label: t("No border", "无边框"), icon: "border-none" }
] as const;

export const NODE_STYLE_ALIGNMENTS = [
  { id: "left", label: t("Align left", "左对齐"), icon: "align-left" },
  { id: "center", label: t("Align center", "居中"), icon: "align-center" },
  { id: "right", label: t("Align right", "右对齐"), icon: "align-right" }
] as const;

export type NodeStylePreset = {
  id: string;
  label: string;
  style: NodeVisualStyle;
};

export const ROUNDED_MAP_PRESETS: readonly (NodeStylePreset & { sample: string })[] = [
  { id: "terminal", label: t("Start / end · theme", "起止 / 主题"), sample: t("Start planning", "开始筹备"), style: { color: "#f3dc83", shape: "pill", border: "solid", align: "center" } },
  { id: "process", label: t("Step / task", "步骤 / 任务"), sample: t("Plan the event", "安排活动"), style: { color: "#c8dff3", shape: "default", border: "solid", align: "center" } },
  { id: "decision", label: t("Decision / branch", "判断 / 分支"), sample: t("Headcount OK?", "人数合适？"), style: { color: "#f8dec1", shape: "diamond", border: "solid", align: "center" } },
  { id: "direction", label: t("Flow / next stage", "流转 / 下一阶段"), sample: t("Move to discussion", "进入交流"), style: { color: "#d9e7b5", shape: "right-arrow", border: "solid", align: "center" } },
  { id: "io", label: t("Input / output", "输入 / 输出"), sample: t("Collect sign-ups", "收集报名"), style: { color: "#c5e4dd", shape: "parallelogram", border: "solid", align: "center" } },
  { id: "document", label: t("Document / output", "文档 / 产出"), sample: t("Discussion notes", "讨论纪要"), style: { color: "#fffef8", shape: "document", border: "solid", align: "left" } }
];

/**
 * Presets are the panel's primary affordance: one click sets colour, shape,
 * border and alignment together. The list is ordered by how often a canvas
 * reaches for it — everyday cards first, annotations and structure last.
 */
export const NODE_STYLE_PRESET_LIST: readonly NodeStylePreset[] = [
  { id: "flow", label: t("Flow", "流程"), style: { color: "#65b9a7", shape: "pill", border: "solid", align: "center" } },
  { id: "focus", label: t("Key point", "重点"), style: { color: "#a58bea", shape: "default", border: "solid", align: "center" } },
  { id: "warning", label: t("Warning", "警示"), style: { color: "#e8b75a", shape: "default", border: "dashed", align: "left" } },
  { id: "note", label: t("Sticky note", "便签"), style: { color: "#d4c75b", shape: "square", border: "invisible", align: "left" } },
  { id: "question", label: t("Question", "疑问"), style: { color: "#72b4e8", shape: "diamond", border: "solid", align: "center" } },
  { id: "idea", label: t("Idea", "灵感"), style: { color: "#e58eb4", shape: "circle", border: "solid", align: "center" } },
  { id: "data", label: t("Data", "数据"), style: { color: "#62b8bd", shape: "database", border: "solid", align: "left" } },
  { id: "doc", label: t("Document", "文档"), style: { color: "#8b9bb4", shape: "document", border: "solid", align: "left" } },
  { id: "group", label: t("Group", "分组"), style: { color: "#89919d", shape: "hexagon", border: "dotted", align: "center" } }
] as const;

export const NODE_STYLE_PRESETS: Record<string, NodeVisualStyle> = Object.fromEntries(
  NODE_STYLE_PRESET_LIST.map(preset => [preset.id, preset.style])
);

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Apply one logical style update without changing content, geometry, edges, or unrelated fields. */
export function applyNodeVisualStyle(
  data: CanvasData,
  nodeIds: readonly string[],
  patch: NodeVisualStylePatch
): { data: CanvasData; updated: number } {
  const targetIds = new Set(nodeIds);
  if (targetIds.size === 0) return { data, updated: 0 };

  let updated = 0;
  const nodes: CanvasNodeData[] = data.nodes.map(node => {
    if (!targetIds.has(node.id)) return node;
    const next: CanvasNodeData = { ...node };
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(patch, "color")) {
      if (patch.color === null) delete next.color;
      else if (typeof patch.color === "string") next.color = patch.color;
      changed = true;
    }
    if (typeof patch.shape === "string") {
      next.bcShape = patch.shape;
      changed = true;
    }
    if (typeof patch.border === "string") {
      next.bcBorderStyle = patch.border;
      changed = true;
    }
    if (typeof patch.align === "string") {
      next.bcTextAlign = patch.align;
      changed = true;
    }
    if (!changed) return node;

    const styleAttributes = { ...asRecord(next.styleAttributes) };
    if (typeof patch.shape === "string") {
      if (patch.shape === "default") delete styleAttributes.shape;
      else styleAttributes.shape = patch.shape === "square" ? "rectangle" : patch.shape;
    }
    if (typeof patch.border === "string") styleAttributes.border = patch.border;
    if (typeof patch.align === "string") styleAttributes.textAlign = patch.align;
    if (Object.keys(styleAttributes).length > 0 || next.styleAttributes !== undefined) {
      next.styleAttributes = styleAttributes;
    }

    updated += 1;
    return next;
  });

  if (updated === 0) return { data, updated: 0 };
  return { data: { ...data, nodes }, updated };
}

/** Reset baseline: muted slate, rounded rectangle, solid border, centered text. */
export const DEFAULT_NODE_VISUAL_STYLE: NodeVisualStyle = {
  color: "#64748b",
  shape: "default",
  border: "solid",
  align: "center"
};
