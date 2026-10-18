import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "./canvas";
import {
  applyDefaultNodePreferences,
  applyDefaultNodeTextAlignment,
  configuredDefaultNodeSize,
  normalizeDefaultNodeHeight,
  normalizeDefaultNodeWidth,
  normalizeDefaultNodeTextAlignment
} from "./node-defaults";

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

  it("centers new text cards and enables content-driven sizing by default", () => {
    const node = textNode();
    expect(applyDefaultNodePreferences(node, undefined)).toMatchObject({
      bcTextAlign: "center",
      bcAutoResize: true,
      styleAttributes: { textAlign: "center" }
    });
  });

  it("preserves an explicit auto-resize preference", () => {
    const node = textNode({ bcAutoResize: false });
    expect(applyDefaultNodePreferences(node, undefined)).toMatchObject({
      bcTextAlign: "center",
      bcAutoResize: false
    });
  });

  it("does not add auto-resize metadata to non-text nodes", () => {
    const node = textNode({ type: "file", file: "notes/example.md" });
    expect(applyDefaultNodePreferences(node, undefined)).toBe(node);
  });

  it("normalizes unsupported setting values to left alignment", () => {
    expect(normalizeDefaultNodeTextAlignment("justify")).toBe("center");
    expect(normalizeDefaultNodeTextAlignment(undefined)).toBe("center");
  });
});

describe("default node size settings", () => {
  it("keeps configured widths within the settings range", () => {
    expect(normalizeDefaultNodeWidth(400)).toBe(400);
    expect(normalizeDefaultNodeWidth(50)).toBe(120);
    expect(normalizeDefaultNodeWidth(9999)).toBe(1200);
    expect(normalizeDefaultNodeWidth(undefined)).toBe(280);
    expect(normalizeDefaultNodeWidth("abc")).toBe(280);
  });

  it("keeps configured heights within the settings range", () => {
    expect(normalizeDefaultNodeHeight(220)).toBe(220);
    expect(normalizeDefaultNodeHeight(10)).toBe(40);
    expect(normalizeDefaultNodeHeight(9999)).toBe(1000);
    expect(normalizeDefaultNodeHeight(undefined)).toBe(140);
    expect(normalizeDefaultNodeHeight("abc")).toBe(140);
  });

  it("reads the configured default size with safe fallbacks", () => {
    expect(configuredDefaultNodeSize({ defaultNodeWidth: 320, defaultNodeHeight: 180 }))
      .toEqual({ width: 320, height: 180 });
    expect(configuredDefaultNodeSize({})).toEqual({ width: 280, height: 140 });
    expect(configuredDefaultNodeSize(null)).toEqual({ width: 280, height: 140 });
    expect(configuredDefaultNodeSize(undefined)).toEqual({ width: 280, height: 140 });
    expect(configuredDefaultNodeSize({ defaultNodeWidth: 40, defaultNodeHeight: 5 }))
      .toEqual({ width: 120, height: 40 });
  });
});
