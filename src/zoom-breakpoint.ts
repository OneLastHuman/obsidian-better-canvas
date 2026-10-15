/**
 * Obsidian's Canvas zoom field is log2(scale), not the user-facing linear scale.
 * Returns undefined for invalid or non-representable zoom values.
 */
export function canvasScaleFromLogZoom(value: unknown): number | undefined {
  const zoom = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(zoom)) return undefined;
  const scale = Math.pow(2, zoom);
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

/**
 * A node is hidden only when the current linear scale is strictly below its
 * threshold. At an exact threshold the node remains visible.
 */
export function isBelowZoomBreakpoint(scale: unknown, breakpoint: unknown): boolean {
  const current = typeof scale === "number" ? scale : Number(scale);
  const threshold = typeof breakpoint === "number" ? breakpoint : Number(breakpoint);
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(threshold)) return false;
  return current < threshold;
}
