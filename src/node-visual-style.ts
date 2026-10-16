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

export const NODE_STYLE_COLORS = [
  { id: "lavender", label: "Lavender", value: "#a78bfa" },
  { id: "blue", label: "Blue", value: "#60a5fa" },
  { id: "amber", label: "Amber", value: "#fbbf24" },
  { id: "green", label: "Green", value: "#34d399" },
  { id: "rose", label: "Rose", value: "#fb7185" },
  { id: "slate", label: "Slate", value: "#94a3b8" }
] as const;

export const NODE_STYLE_SHAPES = [
  { id: "default", label: "Rounded rectangle" },
  { id: "square", label: "Rectangle" },
  { id: "pill", label: "Pill" },
  { id: "diamond", label: "Diamond" },
  { id: "circle", label: "Circle" },
  { id: "hexagon", label: "Hexagon" },
  { id: "document", label: "Document" },
  { id: "database", label: "Database" }
] as const;

export const NODE_STYLE_BORDERS = [
  { id: "solid", label: "Solid" },
  { id: "dashed", label: "Dashed" },
  { id: "dotted", label: "Dotted" },
  { id: "double", label: "Double" },
  { id: "invisible", label: "None" }
] as const;

export const NODE_STYLE_ALIGNMENTS = [
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
  { id: "right", label: "Right" }
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
