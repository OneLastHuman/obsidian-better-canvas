import { describe, expect, it } from "vitest";
import {
  calculateTextNodeDimensions,
  DEFAULT_AUTO_RESIZE_TEST_SETTINGS,
  normalizeAutoResizeTestSettings
} from "./node-auto-resize";

describe("experimental text auto-resize parameters", () => {
  it("uses the current sizing baseline for short text", () => {
    expect(calculateTextNodeDimensions("计划书")).toEqual({ width: 74, height: 68 });
  });

  it("estimates width from the longest line and height from line wrapping", () => {
    expect(calculateTextNodeDimensions("ABCDEFGHIJ")).toEqual({ width: 124, height: 68 });
    expect(calculateTextNodeDimensions("one\ntwo\nthree")).toEqual({ width: 88, height: 116 });
  });

  it("respects the configured width and height caps", () => {
    const settings = normalizeAutoResizeTestSettings({
      ...DEFAULT_AUTO_RESIZE_TEST_SETTINGS,
      maxWidth: 100,
      maxHeight: 80
    });
    expect(calculateTextNodeDimensions("x".repeat(100), settings)).toEqual({ width: 100, height: 80 });
  });

  it("normalizes invalid values and keeps maximums at least as large as minimums", () => {
    const settings = normalizeAutoResizeTestSettings({
      minWidth: 1500,
      maxWidth: 200,
      minHeight: 1800,
      maxHeight: 300,
      charWidthFactor: -5,
      widthPadding: 5000,
      lineHeight: Number.NaN,
      heightPadding: -1
    });
    expect(settings.minWidth).toBe(1200);
    expect(settings.maxWidth).toBe(1200);
    expect(settings.minHeight).toBe(1800);
    expect(settings.maxHeight).toBe(1800);
    expect(settings.charWidthFactor).toBe(0.1);
    expect(settings.widthPadding).toBe(1000);
    expect(settings.lineHeight).toBe(DEFAULT_AUTO_RESIZE_TEST_SETTINGS.lineHeight);
    expect(settings.heightPadding).toBe(0);
  });

  it("returns safe baseline values when the saved object is missing", () => {
    expect(normalizeAutoResizeTestSettings(undefined)).toEqual(DEFAULT_AUTO_RESIZE_TEST_SETTINGS);
  });
});
