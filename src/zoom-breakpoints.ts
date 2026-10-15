/**
 * Obsidian Canvas exposes its zoom transform as log2(scale), not a linear
 * percentage. User-facing node breakpoints and --variable-breakpoint values
 * are expressed as linear scale ratios (1 means 100%, 0.6 means 60%).
 */
export function canvasZoomToScale(zoom: unknown): number | undefined {
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return undefined;
  const scale = 2 ** zoom;
  return Number.isFinite(scale) && scale > 0 ? scale : undefined;
}

/**
 * Return whether content should be hidden at a linear zoom scale. Undefined
 * means the runtime scale or configured breakpoint is invalid, so callers
 * should remove stale hidden state rather than guessing.
 */
export function isZoomBreakpointHidden(
  scale: unknown,
  breakpoint: unknown
): boolean | undefined {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return undefined;
  if (typeof breakpoint !== "number" || !Number.isFinite(breakpoint)) return undefined;
  return scale <= breakpoint;
}
