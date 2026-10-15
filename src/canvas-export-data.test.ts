import { describe, expect, it } from "vitest";
import type { CanvasData } from "./canvas";
import { mergeCanvasExportData, viewportExportAppearance } from "./canvas-export-data";

describe("mergeCanvasExportData", () => {
  it("preserves source-only edge attributes while preferring live edits", () => {
    const source: CanvasData = {
      metadata: { pluginData: "preserve" },
      nodes: [
        { id: "a", x: 0, y: 0, width: 100, height: 80, type: "text", text: "old", pluginNodeField: { fromFile: true } },
        { id: "b", x: 200, y: 0, width: 100, height: 80, type: "text", text: "deleted" }
      ],
      edges: [
        {
          id: "ab", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
          fromEnd: "arrow", toEnd: "arrow", label: "source label",
          styleAttributes: { pathfindingMethod: "a-star", arrow: "triangle", color: "#123456" }
        }
      ]
    };
    const live: CanvasData = {
      nodes: [
        { id: "a", x: 12, y: 4, width: 100, height: 80, type: "text", text: "live" }
      ],
      edges: [
        {
          id: "ab", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
          color: "#abcdef",
          toEnd: undefined,
          styleAttributes: { pathfindingMethod: "direct" }
        },
        { id: "new", fromNode: "a", fromSide: "right", toNode: "a", toSide: "left" }
      ]
    };

    const result = mergeCanvasExportData(live, source);

    expect(result.metadata).toEqual({ pluginData: "preserve" });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ x: 12, text: "live", pluginNodeField: { fromFile: true } });
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toMatchObject({
      fromEnd: "arrow",
      toEnd: "arrow",
      label: "source label",
      color: "#abcdef",
      styleAttributes: { pathfindingMethod: "direct", arrow: "triangle", color: "#123456" }
    });
    expect(result.edges[1].id).toBe("new");
  });

  it("does not bring back source nodes or edges removed from the live Canvas", () => {
    const source: CanvasData = {
      nodes: [{ id: "old", x: 0, y: 0, width: 100, height: 80, type: "text", text: "old" }],
      edges: [{ id: "edge", fromNode: "old", fromSide: "right", toNode: "old", toSide: "left" }]
    };
    const live: CanvasData = { nodes: [], edges: [] };

    expect(mergeCanvasExportData(live, source)).toMatchObject({ nodes: [], edges: [] });
  });
});

describe("viewportExportAppearance", () => {
  it("makes an empty background preference transparent", () => {
    expect(viewportExportAppearance()).toEqual({
      style: { background: "transparent", backgroundColor: "transparent" }
    });
    expect(viewportExportAppearance("  ")).toEqual({
      style: { background: "transparent", backgroundColor: "transparent" }
    });
  });

  it("uses a configured export background color", () => {
    expect(viewportExportAppearance("  #abcdef  ")).toEqual({ backgroundColor: "#abcdef" });
  });
});
