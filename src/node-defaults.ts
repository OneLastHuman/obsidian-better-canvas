import type { CanvasNodeData } from "./canvas";

export type NodeTextAlignment = "left" | "center" | "right";

export const DEFAULT_NODE_WIDTH = 280;
export const DEFAULT_NODE_HEIGHT = 140;
/** Fixed creation size; existing cards and content-driven sizing keep their own geometry. */
export function defaultNodeSize(): { width: number; height: number } {
  return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

export function normalizeDefaultNodeTextAlignment(value: unknown): NodeTextAlignment {
  return value === "center" || value === "right" || value === "left" ? value : "center";
}

/**
 * Apply the configured default to a new text node only when that node has no
 * explicit text alignment of its own. Existing node styles and other
 * node types must remain untouched.
 */
export function applyDefaultNodeTextAlignment(
  node: CanvasNodeData,
  preferredAlignment: unknown
): CanvasNodeData {
  if (node.type !== "text") return node;

  const alignment = normalizeDefaultNodeTextAlignment(preferredAlignment);
  if (alignment === "left") return node;

  const attributes = node.styleAttributes && typeof node.styleAttributes === "object" &&
    !Array.isArray(node.styleAttributes)
    ? node.styleAttributes as Record<string, unknown>
    : {};

  if (typeof node.bcTextAlign === "string" ||
      Object.prototype.hasOwnProperty.call(attributes, "textAlign")) {
    return node;
  }

  return {
    ...node,
    bcTextAlign: alignment,
    styleAttributes: { ...attributes, textAlign: alignment }
  };
}

/**
 * Set defaults for a newly created text card. Explicit per-node choices remain
 * authoritative; auto-resize is enabled only when no preference is stored.
 */
export function applyDefaultNodePreferences(
  node: CanvasNodeData,
  preferredAlignment: unknown
): CanvasNodeData {
  if (node.type !== "text") return node;

  const aligned = applyDefaultNodeTextAlignment(node, preferredAlignment);
  if (typeof node.bcAutoResize === "boolean") return aligned;
  return { ...aligned, bcAutoResize: true };
}
