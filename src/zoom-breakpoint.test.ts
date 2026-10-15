import { describe, expect, it } from "vitest";
import { canvasScaleFromLogZoom, isBelowZoomBreakpoint } from "./zoom-breakpoint";

describe("Canvas zoom breakpoint scale conversion", () => {
  it("converts Obsidian's log2 zoom value back to linear scale", () => {
    expect(canvasScaleFromLogZoom(0)).toBe(1);
    expect(canvasScaleFromLogZoom(1)).toBe(2);
    expect(canvasScaleFromLogZoom(-4)).toBe(0.0625);
    expect(canvasScaleFromLogZoom(Math.log2(0.606))).toBeCloseTo(0.606, 6);
    expect(canvasScaleFromLogZoom(Math.log2(1.837))).toBeCloseTo(1.837, 6);
  });

  it("rejects non-finite or non-representable zoom values", () => {
    expect(canvasScaleFromLogZoom(Number.NaN)).toBeUndefined();
    expect(canvasScaleFromLogZoom(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(canvasScaleFromLogZoom(2048)).toBeUndefined();
    expect(canvasScaleFromLogZoom(-2048)).toBeUndefined();
  });

  it("uses linear thresholds and leaves the exact threshold visible", () => {
    expect(isBelowZoomBreakpoint(0.599, 0.6)).toBe(true);
    expect(isBelowZoomBreakpoint(0.6, 0.6)).toBe(false);
    expect(isBelowZoomBreakpoint(1, 0.6)).toBe(false);
    expect(isBelowZoomBreakpoint(1.51, 0.6)).toBe(false);
  });

  it("does not hide content for invalid scale inputs", () => {
    expect(isBelowZoomBreakpoint(undefined, 0.6)).toBe(false);
    expect(isBelowZoomBreakpoint(Number.NaN, 0.6)).toBe(false);
    expect(isBelowZoomBreakpoint(1, Number.NaN)).toBe(false);
  });
});
