import { describe, expect, it } from "vitest";
import {
  AUTO_RESIZE_LAYOUT,
  calculateTextNodeLayout,
  estimateTextWidth,
  wrapTextToWidth
} from "./node-auto-resize";

const cjkMeasure = (text: string): number => Array.from(text).length * AUTO_RESIZE_LAYOUT.fontSize;
const textOf = (length: number): string => "字".repeat(length);

describe("fixed text-node auto-resize layout", () => {
  it("keeps a one-character node at the fixed minimum", () => {
    const layout = calculateTextNodeLayout("字", cjkMeasure);
    expect(layout).toEqual({
      width: 80,
      height: 44,
      lines: 1,
      alignment: "center"
    });
  });

  it("sizes short text from its measured width", () => {
    expect(calculateTextNodeLayout(textOf(8), cjkMeasure)).toMatchObject({
      width: 176,
      height: 44,
      lines: 1,
      alignment: "center"
    });
    expect(calculateTextNodeLayout(textOf(9), cjkMeasure)).toMatchObject({
      width: 192,
      height: 44,
      lines: 1,
      alignment: "center"
    });
  });

  it("keeps 24 full-width characters on one centered line", () => {
    expect(calculateTextNodeLayout(textOf(24), cjkMeasure)).toEqual({
      width: 432,
      height: 44,
      lines: 1,
      alignment: "center"
    });
  });

  it("moves to two left-aligned lines at 25 characters", () => {
    expect(calculateTextNodeLayout(textOf(25), cjkMeasure)).toEqual({
      width: 440,
      height: 68,
      lines: 2,
      alignment: "left"
    });
  });

  it("grows by line height and caps the outer height", () => {
    expect(calculateTextNodeLayout(textOf(49), cjkMeasure)).toMatchObject({
      width: 440,
      height: 92,
      lines: 3,
      alignment: "left"
    });
    expect(calculateTextNodeLayout(textOf(73), cjkMeasure)).toMatchObject({
      width: 440,
      height: 116,
      lines: 4,
      alignment: "left"
    });

    const longLayout = calculateTextNodeLayout(textOf(600), cjkMeasure);
    expect(longLayout?.width).toBe(440);
    expect(longLayout?.height).toBe(560);
    expect(longLayout?.alignment).toBe("left");
    expect(longLayout?.lines).toBeGreaterThan(22);
  });

  it("does not resize empty or whitespace-only text", () => {
    expect(calculateTextNodeLayout("", cjkMeasure)).toBeNull();
    expect(calculateTextNodeLayout("  \n\t ", cjkMeasure)).toBeNull();
  });

  it("treats explicit line breaks as left-aligned multi-line text", () => {
    const layout = calculateTextNodeLayout("第一行\n第二行", cjkMeasure);
    expect(layout).toMatchObject({
      width: 96,
      height: 68,
      lines: 2,
      alignment: "left"
    });
  });

  it("measures mixed Latin text with the provided measurer", () => {
    const latinMeasure = (text: string): number => text.length * 8;
    const layout = calculateTextNodeLayout("abcdefghij", latinMeasure);
    expect(layout).toEqual({
      width: 128,
      height: 44,
      lines: 1,
      alignment: "center"
    });
  });

  it("splits an unbreakable word wider than the maximum width", () => {
    const latinMeasure = (text: string): number => text.length * 8;
    const layout = calculateTextNodeLayout("a".repeat(100), latinMeasure);
    expect(layout?.width).toBe(440);
    expect(layout?.alignment).toBe("left");
    expect(layout?.lines).toBe(3);
  });
});

describe("wrapTextToWidth", () => {
  const measure = (text: string): number => text.length * 10;

  it("wraps at spaces and drops the leading space", () => {
    expect(wrapTextToWidth("aa bb cc", 50, measure)).toEqual(["aa bb", "cc"]);
  });

  it("wraps CJK text per character", () => {
    expect(wrapTextToWidth("字字字字", 50, cjkMeasure)).toEqual(["字字字", "字"]);
  });

  it("splits a single oversized unit", () => {
    expect(wrapTextToWidth("aaaaaaaaaaaa", 50, measure)).toEqual(["aaaaa", "aaaaa", "aa"]);
  });
});

describe("estimateTextWidth", () => {
  it("uses a full em for CJK and a narrower advance for Latin", () => {
    expect(estimateTextWidth("中")).toBe(16);
    expect(estimateTextWidth("，")).toBe(16);
    expect(estimateTextWidth("a")).toBeCloseTo(8.8);
    expect(estimateTextWidth(" ")).toBe(4);
  });
});
