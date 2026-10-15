export interface CanvasNodeStyleSource {
  bcShape?: unknown;
  bcBorderStyle?: unknown;
  styleAttributes?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Explicit Better Canvas settings take priority; raw JSON Canvas style attributes are fallbacks. */
export function resolveCanvasNodeShape(node: CanvasNodeStyleSource): string {
  const attributes = record(node.styleAttributes);
  const rawShape = typeof node.bcShape === "string"
    ? node.bcShape
    : typeof attributes.shape === "string"
      ? attributes.shape
      : "default";
  return rawShape === "rectangle" ? "default" : rawShape;
}

export function resolveCanvasNodeBorder(node: CanvasNodeStyleSource): string {
  const attributes = record(node.styleAttributes);
  if (typeof node.bcBorderStyle === "string") return node.bcBorderStyle;
  return typeof attributes.border === "string" ? attributes.border : "solid";
}
