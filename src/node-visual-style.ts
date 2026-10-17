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
  { id: "red", label: "红色", value: "#ef4444" },
  { id: "orange", label: "橙色", value: "#f97316" },
  { id: "amber", label: "琥珀色", value: "#fbbf24" },
  { id: "yellow", label: "黄色", value: "#eab308" },
  { id: "lime", label: "青柠色", value: "#84cc16" },
  { id: "green", label: "绿色", value: "#22c55e" },
  { id: "emerald", label: "翠绿色", value: "#10b981" },
  { id: "teal", label: "蓝绿色", value: "#14b8a6" },
  { id: "cyan", label: "青色", value: "#06b6d4" },
  { id: "sky", label: "天蓝色", value: "#0ea5e9" },
  { id: "blue", label: "蓝色", value: "#3b82f6" },
  { id: "indigo", label: "靛蓝色", value: "#6366f1" },
  { id: "violet", label: "紫罗兰色", value: "#8b5cf6" },
  { id: "purple", label: "紫色", value: "#a855f7" },
  { id: "fuchsia", label: "洋红色", value: "#d946ef" },
  { id: "pink", label: "粉色", value: "#ec4899" },
  { id: "rose", label: "玫红色", value: "#f43f5e" },
  { id: "brown", label: "棕色", value: "#a16207" },
  { id: "slate", label: "石板灰", value: "#94a3b8" },
  { id: "gray", label: "灰色", value: "#6b7280" }
] as const;

export const NODE_STYLE_SHAPES = [
  { id: "default", label: "圆角矩形" },
  { id: "square", label: "矩形" },
  { id: "pill", label: "胶囊形" },
  { id: "diamond", label: "菱形" },
  { id: "circle", label: "圆形" },
  { id: "hexagon", label: "六边形" },
  { id: "document", label: "文档" },
  { id: "database", label: "数据库" }
] as const;

export const NODE_STYLE_BORDERS = [
  { id: "solid", label: "实线" },
  { id: "dashed", label: "虚线" },
  { id: "dotted", label: "点线" },
  { id: "double", label: "双线" },
  { id: "invisible", label: "无边框" }
] as const;

export const NODE_STYLE_ALIGNMENTS = [
  { id: "left", label: "左对齐", icon: "align-left" },
  { id: "center", label: "居中", icon: "align-center" },
  { id: "right", label: "右对齐", icon: "align-right" }
] as const;

export const NODE_STYLE_PRESETS: Record<string, NodeVisualStyle> = {
  flow: { color: "#34d399", shape: "pill", border: "solid", align: "center" },
  focus: { color: "#a78bfa", shape: "default", border: "solid", align: "left" },
  warning: { color: "#fbbf24", shape: "default", border: "dashed", align: "left" }
};

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

    const styleAttributes = asRecord(next.styleAttributes);
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

/** The documented reset baseline: Slate, rounded rectangle, solid border, left aligned. */
export const DEFAULT_NODE_VISUAL_STYLE: NodeVisualStyle = {
  color: "#94a3b8",
  shape: "default",
  border: "solid",
  align: "left"
};
