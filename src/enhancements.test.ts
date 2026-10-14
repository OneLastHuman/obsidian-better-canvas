import { describe, expect, it } from "vitest";
import {
  colorIncidentEdges,
  flipIncidentEdges,
  reorderNode,
  styleSelectedEdgeArrow,
  styleSelectedEdgePathfinding,
  styleSelectedEdges
} from "./enhancements";
import type { CanvasData } from "./canvas";

function makeCanvas(data: CanvasData, selected: any[] = []): any {
  return {
    data: JSON.parse(JSON.stringify(data)),
    selection: new Set(selected),
    saved: 0,
    frames: 0,
    getData() {
      return this.data;
    },
    importData(next: CanvasData) {
      this.data = JSON.parse(JSON.stringify(next));
    },
    requestSave() {
      this.saved += 1;
    },
    requestFrame() {
      this.frames += 1;
    }
  };
}

const fixture: CanvasData = {
  nodes: [
    { id: "a", x: 0, y: 0, width: 100, height: 100, type: "text", text: "A" },
    { id: "b", x: 200, y: 0, width: 100, height: 100, type: "text", text: "B" }
  ],
  edges: [
    {
      id: "ab",
      fromNode: "a",
      fromSide: "right",
      toNode: "b",
      toSide: "left",
      fromEnd: "none",
      toEnd: "arrow"
    }
  ]
};

describe("Canvas edge helpers", () => {
  it("flips endpoints, sides, floating settings, and arrow endpoints", () => {
    const canvas = makeCanvas(fixture);
    expect(flipIncidentEdges(canvas, "a")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      fromNode: "b",
      fromSide: "left",
      toNode: "a",
      toSide: "right",
      fromEnd: "arrow",
      toEnd: "none"
    });
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });

  it("stores edge color using standard and plugin-compatible properties", () => {
    const canvas = makeCanvas(fixture);
    expect(colorIncidentEdges(canvas, "b", "#123456")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({ color: "#123456", bcColor: "#123456" });
  });

  it("serializes selected edge line styles into JSON Canvas styleAttributes", () => {
    const canvas = makeCanvas(fixture, [{ id: "ab" }]);
    expect(styleSelectedEdges(canvas, "#654321", "dotted")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      color: "#654321",
      bcColor: "#654321",
      bcPathStyle: "dotted",
      styleAttributes: { path: "dotted" }
    });
  });

  it("stores selected edge pathfinding in standard styleAttributes", () => {
    const canvas = makeCanvas(fixture, [{ id: "ab" }]);
    expect(styleSelectedEdgePathfinding(canvas, "a-star")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      bcPathfindingMethod: "a-star",
      styleAttributes: { pathfindingMethod: "a-star" }
    });
    expect(styleSelectedEdgePathfinding(canvas, "bezier")).toBe(1);
    expect(canvas.data.edges[0].styleAttributes).not.toHaveProperty("pathfindingMethod");
  });

  it("maps custom arrow names to JSON Canvas schema names", () => {
    const canvas = makeCanvas(fixture, [{ id: "ab" }]);
    expect(styleSelectedEdgeArrow(canvas, "half-triangle")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      bcArrowStyle: "half-triangle",
      styleAttributes: { arrow: "halved-triangle" }
    });
  });

  it("moves a node in z-order without altering edge references", () => {
    const canvas = makeCanvas(fixture);
    expect(reorderNode(canvas, "a", true)).toBe(true);
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["b", "a"]);
    expect(canvas.data.edges).toEqual(fixture.edges);
  });
});
