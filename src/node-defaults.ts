import type { CanvasNodeData } from "./canvas";

export type NodeTextAlignment = "left" | "center" | "right";

export const DEFAULT_NODE_WIDTH = 280;
export const DEFAULT_NODE_HEIGHT = 140;
export const MIN_NODE_WIDTH = 120;
export const MAX_NODE_WIDTH = 1200;
export const MIN_NODE_HEIGHT = 40;
export const MAX_NODE_HEIGHT = 1000;

/** Clamp a configured default node width into the settings range. */
export function normalizeDefaultNodeWidth(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_NODE_WIDTH;
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, number));
}

/** Clamp a configured default node height into the settings range. */
export function normalizeDefaultNodeHeight(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_NODE_HEIGHT;
  return Math.min(MAX_NODE_HEIGHT, Math.max(MIN_NODE_HEIGHT, number));
}

/** Read the configured default text-node size with safe fallbacks. */
export function configuredDefaultNodeSize(settings: unknown): { width: number; height: number } {
  const record = settings !== null && typeof settings === "object"
    ? settings as Record<string, unknown>
    : {};
  return {
    width: normalizeDefaultNodeWidth(record.defaultNodeWidth),
    height: normalizeDefaultNodeHeight(record.defaultNodeHeight)
  };
}

export function normalizeDefaultNodeTextAlignment(value: unknown): NodeTextAlignment {
  return value === "center" || value === "right" || value === "left" ? value : "center";
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
