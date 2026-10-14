import { describe, expect, it } from "vitest";
import { canvasDataToFullSvg } from "./full-canvas-export";
import type { CanvasData } from "./canvas";

const sample: CanvasData = {
  nodes: [
    { id: "a", type: "text", x: -240, y: 40, width: 180, height: 100, text: "Root & <notes>" },
    { id: "b", type: "text", x: 260, y: 180, width: 220, height: 140, text: "Child", color: "2", styleAttributes: { shape: "diamond" } }
  ],
  edges: [
    { id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }
  ]
};

describe("full content SVG export", () => {
  it("uses the union of node positions rather than a viewport size", () => {
    const result = canvasDataToFullSvg(sample, { margin: 10 });
    expect(result.width).toBe(740);
    expect(result.height).toBe(300);
    expect(result.svg).toContain('viewBox="0 0 740 300"');
    expect(result.svg).toContain("Root &amp; &lt;notes&gt;");
    expect(result.svg).toContain("marker-end=\"url(#bc-arrow)\"");
    expect(result.svg).toContain("<polygon");
  });

  it("embeds a bounded raster image when export data includes a data URL", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "image",
        type: "file",
        file: "assets/demo.png",
        x: 20,
        y: 30,
        width: 240,
        height: 180,
        bcExportImageDataUrl: "data:image/png;base64,AAA="
      }],
      edges: []
    });
    expect(result.svg).toContain('<image');
    expect(result.svg).toContain('href="data:image/png;base64,AAA="');
    expect(result.svg).toContain("demo.png");
  });

  it("supports an optional background and empty canvas", () => {
    const colored = canvasDataToFullSvg(sample, { backgroundColor: "#fff" });
    expect(colored.svg).toContain('fill="#fff"');
    const empty = canvasDataToFullSvg({ nodes: [], edges: [] }, { margin: 0 });
    expect(empty.width).toBe(800);
    expect(empty.height).toBe(600);
  });

  it("rejects impossible export dimensions before allocating an image canvas", () => {
    expect(() => canvasDataToFullSvg({
      nodes: [{ id: "giant", type: "text", x: 0, y: 0, width: 100_000, height: 100, text: "Giant" }],
      edges: []
    })).toThrow(/过大/);
  });
});
