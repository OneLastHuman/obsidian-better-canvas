import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "./canvas";
import { applyDefaultNodeTextAlignment, normalizeDefaultNodeTextAlignment } from "./node-defaults";

function textNode(overrides: Record<string, unknown> = {}): CanvasNodeData {
  return {
    id: "node-1",
    type: "text",
    x: 0,
    y: 0,
    width: 280,
    height: 140,
    text: "Example",
    ...overrides
  } as CanvasNodeData;
}

describe("default text alignment for new Canvas nodes", () => {
  it.each(["center", "right"] as const)("applies %s to a text node without explicit alignment", alignment => {
    const node = textNode({ styleAttributes: { shape: "diamond" }, customField: "preserved" });

    expect(applyDefaultNodeTextAlignment(node, alignment)).toMatchObject({
      bcTextAlign: alignment,
      styleAttributes: { shape: "diamond", textAlign: alignment },
      customField: "preserved"
    });
  });

  it("preserves an alignment already stored in styleAttributes", () => {
    const node = textNode({ styleAttributes: { textAlign: "right", border: "dotted" } });

    expect(applyDefaultNodeTextAlignment(node, "center")).toBe(node);
  });

  it("preserves the Better Canvas alignment field when present", () => {
    const node = textNode({ bcTextAlign: "left", styleAttributes: { border: "dashed" } });

    expect(applyDefaultNodeTextAlignment(node, "center")).toBe(node);
  });

  it("does not affect non-text nodes", () => {
    const node = textNode({ type: "file", file: "notes/example.md" });

    expect(applyDefaultNodeTextAlignment(node, "center")).toBe(node);
  });

  it("keeps the existing left-aligned default without adding redundant style data", () => {
    const node = textNode();

    expect(applyDefaultNodeTextAlignment(node, "left")).toBe(node);
  });

  it("normalizes unsupported setting values to left alignment", () => {
    expect(normalizeDefaultNodeTextAlignment("justify")).toBe("left");
    expect(normalizeDefaultNodeTextAlignment(undefined)).toBe("left");
  });
});
