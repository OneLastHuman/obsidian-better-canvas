import type { CanvasNodeData } from "./canvas";

export type NodeTextAlignment = "left" | "center" | "right";

export function normalizeDefaultNodeTextAlignment(value: unknown): NodeTextAlignment {
  return value === "center" || value === "right" || value === "left" ? value : "left";
}

/**
 * Apply the configured default to a new text node only when that node has no
 * explicit text alignment of its own. Existing node/template styles and other
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
