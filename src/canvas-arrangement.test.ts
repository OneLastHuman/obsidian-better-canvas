import { describe, expect, it } from "vitest";
import { flipCanvasNodePositions, swapCanvasNodePositions } from "./canvas-arrangement";
import type { CanvasNodeData } from "./canvas";

const nodes: CanvasNodeData[] = [
  { id: "a", type: "text", x: 10, y: 20, width: 100, height: 60, text: "A", extra: { preserve: true } },
  { id: "b", type: "text", x: 180, y: 90, width: 80, height: 100, text: "B" },
  { id: "outside", type: "text", x: 500, y: 500, width: 50, height: 50, text: "Outside" }
];

describe("flipCanvasNodePositions", () => {
  it("mirrors selected nodes horizontally around their combined bounds", () => {
    const result = flipCanvasNodePositions(nodes, ["a", "b"], "horizontal");
    expect(result.find(node => node.id === "a")?.x).toBe(160);
    expect(result.find(node => node.id === "b")?.x).toBe(10);
    expect(result.find(node => node.id === "a")?.y).toBe(20);
    expect(result.find(node => node.id === "outside")?.x).toBe(500);
    expect(result.find(node => node.id === "a")?.extra).toEqual({ preserve: true });
  });

  it("mirrors selected nodes vertically around their combined bounds", () => {
    const result = flipCanvasNodePositions(nodes, ["a", "b"], "vertical");
    expect(result.find(node => node.id === "a")?.y).toBe(130);
    expect(result.find(node => node.id === "b")?.y).toBe(20);
    expect(result.find(node => node.id === "outside")?.y).toBe(500);
  });

  it("leaves one-node or empty selections unchanged", () => {
    expect(flipCanvasNodePositions(nodes, ["a"], "horizontal")).toEqual(nodes);
    expect(flipCanvasNodePositions(nodes, [], "vertical")).toEqual(nodes);
  });
});

describe("swapCanvasNodePositions", () => {
  it("swaps node centers and preserves their own widths and heights", () => {
    const result = swapCanvasNodePositions(nodes, ["a", "b"]);
    expect(result.find(node => node.id === "a")).toMatchObject({
      x: 170, y: 110, width: 100, height: 60
    });
    expect(result.find(node => node.id === "b")).toMatchObject({
      x: 20, y: 0, width: 80, height: 100
    });
    expect(result.find(node => node.id === "outside")?.x).toBe(500);
  });

  it("does nothing unless exactly two nodes are selected", () => {
    expect(swapCanvasNodePositions(nodes, ["a"])).toEqual(nodes);
    expect(swapCanvasNodePositions(nodes, ["a", "b", "outside"])).toEqual(nodes);
  });
});
