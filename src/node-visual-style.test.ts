import { describe, expect, it } from "vitest";
import { applyNodeVisualStyle, DEFAULT_NODE_VISUAL_STYLE, NODE_STYLE_PRESETS } from "./node-visual-style";
import type { CanvasData } from "./canvas";

const fixture: CanvasData = {
  metadata: { preserved: true },
  nodes: [
    {
      id: "node-1",
      type: "text",
      x: 10,
      y: 20,
      width: 280,
      height: 120,
      text: "Keep this content",
      color: "#000000",
      styleAttributes: { shape: "diamond", border: "dotted", custom: "keep" },
      pluginMetadata: { keep: true }
    },
    { id: "node-2", type: "text", x: 400, y: 20, width: 280, height: 120, text: "Untouched" }
  ],
  edges: [{ id: "edge-1", fromNode: "node-1", toNode: "node-2", fromSide: "right", toSide: "left" }]
};

describe("applyNodeVisualStyle", () => {
  it("applies a full preset to the target node and preserves unrelated data", () => {
    const preset = NODE_STYLE_PRESETS.flow;
    const result = applyNodeVisualStyle(fixture, ["node-1"], {
      color: preset.color, shape: preset.shape, border: preset.border, align: preset.align
    });
    expect(result.updated).toBe(1);
    expect(result.data.nodes[0]).toMatchObject({
      text: "Keep this content", x: 10, y: 20, width: 280, height: 120,
      color: "#34d399", bcShape: "pill", bcBorderStyle: "solid", bcTextAlign: "center",
      pluginMetadata: { keep: true },
      styleAttributes: { shape: "pill", border: "solid", textAlign: "center", custom: "keep" }
    });
    expect(result.data.nodes[1]).toEqual(fixture.nodes[1]);
    expect(result.data.edges).toEqual(fixture.edges);
    expect(result.data.metadata).toEqual({ preserved: true });
  });

  it("resets the documented appearance baseline without changing node content", () => {
    const result = applyNodeVisualStyle(fixture, ["node-1"], DEFAULT_NODE_VISUAL_STYLE);
    expect(result.data.nodes[0]).toMatchObject({
      text: "Keep this content", bcShape: "default", bcBorderStyle: "solid",
      bcTextAlign: "left", color: "#94a3b8"
    });
    expect((result.data.nodes[0].styleAttributes as Record<string, unknown>).custom).toBe("keep");
  });

  it("does not report or rewrite missing targets", () => {
    const result = applyNodeVisualStyle(fixture, ["missing"], { shape: "pill" });
    expect(result.updated).toBe(0);
    expect(result.data).toBe(fixture);
  });

  it("returns original data for an empty patch", () => {
    const result = applyNodeVisualStyle(fixture, ["node-1"], {});
    expect(result.updated).toBe(0);
    expect(result.data).toBe(fixture);
  });
});
