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
  { id: "red", label: "红色", value: "#e8798f" },
  { id: "orange", label: "橙色", value: "#f59e72" },
  { id: "amber", label: "琥珀色", value: "#e8b75a" },
  { id: "yellow", label: "黄色", value: "#d4c75b" },
  { id: "lime", label: "青柠色", value: "#a3be6c" },
  { id: "green", label: "绿色", value: "#78b58c" },
  { id: "emerald", label: "翠绿色", value: "#65b9a7" },
  { id: "teal", label: "蓝绿色", value: "#62b8bd" },
  { id: "cyan", label: "青色", value: "#66bdd1" },
  { id: "sky", label: "天蓝色", value: "#72b4e8" },
  { id: "blue", label: "蓝色", value: "#719cf4" },
  { id: "indigo", label: "靛蓝色", value: "#8a92ed" },
  { id: "violet", label: "紫罗兰色", value: "#a58bea" },
  { id: "purple", label: "紫色", value: "#b28ad7" },
  { id: "fuchsia", label: "洋红色", value: "#d18bd0" },
  { id: "pink", label: "粉色", value: "#e58eb4" },
  { id: "rose", label: "玫红色", value: "#dc8298" },
  { id: "brown", label: "棕色", value: "#b08968" },
  { id: "slate", label: "石板灰", value: "#8b9bb4" },
  { id: "gray", label: "灰色", value: "#89919d" }
] as const;

export const NODE_STYLE_SHAPES = [
  { id: "default", label: "圆角矩形" },
  { id: "square", label: "矩形" },
  { id: "pill", label: "胶囊形" },
  { id: "diamond", label: "菱形" },
  { id: "right-arrow", label: "流转箭头" },
  { id: "parallelogram", label: "输入 / 输出" },
  { id: "circle", label: "圆形" },
  { id: "ellipse", label: "椭圆形" },
  { id: "hexagon", label: "六边形" },
  { id: "document", label: "文档" },
  { id: "database", label: "数据库" }
] as const;

/**
 * Border choices render as icon glyphs in a segmented control, matching the
 * alignment control: a row of miniature outline strokes reads faster than
 * five boxed samples and keeps the row one line tall.
 */
export const NODE_STYLE_BORDERS = [
  { id: "solid", label: "实线", icon: "border-solid" },
  { id: "dashed", label: "虚线", icon: "border-dashed" },
  { id: "dotted", label: "点线", icon: "border-dotted" },
  { id: "double", label: "双线", icon: "border-double" },
  { id: "invisible", label: "无边框", icon: "border-none" }
] as const;

export const NODE_STYLE_ALIGNMENTS = [
  { id: "left", label: "左对齐", icon: "align-left" },
  { id: "center", label: "居中", icon: "align-center" },
  { id: "right", label: "右对齐", icon: "align-right" }
] as const;

export type NodeStylePreset = {
  id: string;
  label: string;
  style: NodeVisualStyle;
};

export const ROUNDED_MAP_PRESETS: readonly (NodeStylePreset & { sample: string })[] = [
  { id: "terminal", label: "起止 / 主题", sample: "开始筹备", style: { color: "#f3dc83", shape: "pill", border: "solid", align: "center" } },
  { id: "process", label: "步骤 / 任务", sample: "安排活动", style: { color: "#c8dff3", shape: "default", border: "solid", align: "center" } },
  { id: "decision", label: "判断 / 分支", sample: "人数合适？", style: { color: "#f8dec1", shape: "diamond", border: "solid", align: "center" } },
  { id: "direction", label: "流转 / 下一阶段", sample: "进入交流", style: { color: "#d9e7b5", shape: "right-arrow", border: "solid", align: "center" } },
  { id: "io", label: "输入 / 输出", sample: "收集报名", style: { color: "#c5e4dd", shape: "parallelogram", border: "solid", align: "center" } },
  { id: "document", label: "文档 / 产出", sample: "讨论纪要", style: { color: "#fffef8", shape: "document", border: "solid", align: "left" } }
];

/**
 * Presets are the panel's primary affordance: one click sets colour, shape,
 * border and alignment together. The list is ordered by how often a canvas
 * reaches for it — everyday cards first, annotations and structure last.
 */
export const NODE_STYLE_PRESET_LIST: readonly NodeStylePreset[] = [
  { id: "flow", label: "流程", style: { color: "#65b9a7", shape: "pill", border: "solid", align: "center" } },
  { id: "focus", label: "重点", style: { color: "#a58bea", shape: "default", border: "solid", align: "center" } },
  { id: "warning", label: "警示", style: { color: "#e8b75a", shape: "default", border: "dashed", align: "left" } },
  { id: "note", label: "便签", style: { color: "#d4c75b", shape: "square", border: "invisible", align: "left" } },
  { id: "question", label: "疑问", style: { color: "#72b4e8", shape: "diamond", border: "solid", align: "center" } },
  { id: "idea", label: "灵感", style: { color: "#e58eb4", shape: "circle", border: "solid", align: "center" } },
  { id: "data", label: "数据", style: { color: "#62b8bd", shape: "database", border: "solid", align: "left" } },
  { id: "doc", label: "文档", style: { color: "#8b9bb4", shape: "document", border: "solid", align: "left" } },
  { id: "group", label: "分组", style: { color: "#89919d", shape: "hexagon", border: "dotted", align: "center" } }
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
