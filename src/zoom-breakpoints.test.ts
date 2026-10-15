import { describe, expect, it } from "vitest";
import { canvasZoomToScale, isZoomBreakpointHidden } from "./zoom-breakpoints";

describe("canvasZoomToScale", () => {
  it("converts Obsidian's log2 zoom to a linear scale ratio", () => {
    expect(canvasZoomToScale(0)).toBe(1);
    expect(canvasZoomToScale(1)).toBe(2);
    expect(canvasZoomToScale(-1)).toBe(0.5);
    expect(canvasZoomToScale(Math.log2(0.606))).toBeCloseTo(0.606, 10);
    expect(canvasZoomToScale(Math.log2(1.837))).toBeCloseTo(1.837, 10);
  });

  it("rejects non-finite zoom and scales that underflow or overflow", () => {
    expect(canvasZoomToScale(Number.NaN)).toBeUndefined();
    expect(canvasZoomToScale(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(canvasZoomToScale(Number.NEGATIVE_INFINITY)).toBeUndefined();
    expect(canvasZoomToScale(1024)).toBeUndefined();
    expect(canvasZoomToScale(-1075)).toBeUndefined();
    expect(canvasZoomToScale("0")).toBeUndefined();
  });
});

describe("isZoomBreakpointHidden", () => {
  it("compares the linear scale to the threshold, not the log2 zoom", () => {
    const breakpoint = 0.6;
    expect(isZoomBreakpointHidden(1, breakpoint)).toBe(false);
    expect(isZoomBreakpointHidden(0.606, breakpoint)).toBe(false);
    expect(isZoomBreakpointHidden(1.837, breakpoint)).toBe(false);
    expect(isZoomBreakpointHidden(0.348, breakpoint)).toBe(true);
  });

  it("treats equality as hidden and accepts CSS-configured numeric thresholds", () => {
    expect(isZoomBreakpointHidden(0.6, 0.6)).toBe(true);
    expect(isZoomBreakpointHidden(0.59, 0.6)).toBe(true);
    expect(isZoomBreakpointHidden(0.61, 0.6)).toBe(false);
  });

  it("does not guess when scale or breakpoint is invalid", () => {
    expect(isZoomBreakpointHidden(Number.NaN, 0.6)).toBeUndefined();
    expect(isZoomBreakpointHidden(0, 0.6)).toBeUndefined();
    expect(isZoomBreakpointHidden(Number.POSITIVE_INFINITY, 0.6)).toBeUndefined();
    expect(isZoomBreakpointHidden(1, Number.NaN)).toBeUndefined();
    expect(isZoomBreakpointHidden(1, Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(isZoomBreakpointHidden(1, "0.6")).toBeUndefined();
  });
});
