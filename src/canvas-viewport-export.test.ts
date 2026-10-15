import { describe, expect, it } from "vitest";
import { shouldIncludeViewportSvgNode } from "./canvas-viewport-export";

function node(tagName: string, classes: string[] = []): HTMLElement {
  return {
    tagName,
    classList: { contains: (name: string) => classes.includes(name) }
  } as unknown as HTMLElement;
}

describe("viewport SVG export filter", () => {
  it("excludes active and executable embedded content", () => {
    expect(shouldIncludeViewportSvgNode(node("IFRAME"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("SCRIPT"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("OBJECT"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("EMBED"))).toBe(false);
  });

  it("excludes Canvas controls and Better Canvas card toolbars", () => {
    for (const className of [
      "canvas-control-item",
      "canvas-controls",
      "canvas-control",
      "bc-card-toolbar",
      "bc-card-action"
    ]) {
      expect(shouldIncludeViewportSvgNode(node("DIV", [className]))).toBe(false);
    }
  });

  it("keeps ordinary Canvas nodes and their text content eligible for export", () => {
    expect(shouldIncludeViewportSvgNode(node("DIV", ["canvas-node"]))).toBe(true);
    expect(shouldIncludeViewportSvgNode(node("SPAN", ["markdown-preview-view"]))).toBe(true);
  });
});
