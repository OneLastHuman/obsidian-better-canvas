import { describe, expect, it } from "vitest";
import { strokeTouchesEraser } from "./pdf-annotation-geometry";

describe("PDF stroke eraser geometry", () => {
  it("erases a stroke when a sampled point falls within the pixel tolerance", () => {
    expect(strokeTouchesEraser(
      [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      [{ x: 0.5, y: 0.52 }],
      1000, 1000, 25
    )).toBe(true);
  });

  it("detects crossing segments even when no endpoints are near each other", () => {
    expect(strokeTouchesEraser(
      [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }],
      [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }],
      1000, 1000, 2
    )).toBe(true);
  });

  it("does not erase a distant stroke", () => {
    expect(strokeTouchesEraser(
      [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }],
      [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }],
      1000, 1000, 10
    )).toBe(false);
  });

  it("handles single-point strokes and empty input", () => {
    expect(strokeTouchesEraser([{ x: 0.5, y: 0.5 }], [{ x: 0.51, y: 0.5 }], 100, 100, 2)).toBe(true);
    expect(strokeTouchesEraser([], [{ x: 0.5, y: 0.5 }], 100, 100)).toBe(false);
    expect(strokeTouchesEraser([{ x: 0.5, y: 0.5 }], [], 100, 100)).toBe(false);
  });

  it("clamps normalized coordinates and rejects invalid tolerance", () => {
    expect(strokeTouchesEraser([{ x: -1, y: 0.5 }], [{ x: 0, y: 0.5 }], 100, 100, 0)).toBe(true);
    expect(strokeTouchesEraser([{ x: 0.5, y: 0.5 }], [{ x: 0.5, y: 0.5 }], 100, 100, -1)).toBe(false);
  });
});
