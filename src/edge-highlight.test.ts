import { describe, expect, it } from "vitest";
import { connectedEdgeIds, selectedCanvasNodeIds } from "./edge-highlight";

const edges = [
  { id: "ab", fromNode: "a", toNode: "b" },
  { id: "bc", fromNode: "b", toNode: "c" },
  { id: "cd", fromNode: "c", toNode: "d" },
  { id: "aa", fromNode: "a", toNode: "a" }
];

describe("connected Canvas edge highlighting", () => {
  it("returns every incident edge for a selected node, including incoming and outgoing", () => {
    expect([...connectedEdgeIds(edges, ["b"])]).toEqual(["ab", "bc"]);
  });

  it("covers the union of edges touching multiple selected nodes without duplicates", () => {
    expect([...connectedEdgeIds(edges, ["a", "b"])]).toEqual(["ab", "bc", "aa"]);
  });

  it("clears the highlight when selection is empty and ignores invalid IDs", () => {
    expect(connectedEdgeIds(edges, [])).toEqual(new Set());
    expect(connectedEdgeIds(edges, ["missing"])).toEqual(new Set());
    expect(connectedEdgeIds(edges, [""])).toEqual(new Set());
  });

  it("does not require or mutate a canvas data object", () => {
    const before = JSON.stringify(edges);
    connectedEdgeIds(edges, ["c"]);
    expect(JSON.stringify(edges)).toBe(before);
  });

  it("extracts selected node IDs only, deduplicating and filtering non-node selection", () => {
    const canvas = {
      selection: new Set([
        { id: "node-a" },
        { id: "edge-a" },
        { node: { id: "node-b" } },
        { getData: () => ({ id: "node-a" }) },
        { id: "unrelated" }
      ])
    };
    expect(selectedCanvasNodeIds(canvas, ["node-a", "node-b"])).toEqual(["node-a", "node-b"]);
  });

  it("fails closed for Canvas objects without an iterable selection", () => {
    expect(selectedCanvasNodeIds(null)).toEqual([]);
    expect(selectedCanvasNodeIds({})).toEqual([]);
    expect(selectedCanvasNodeIds({ selection: {} })).toEqual([]);
  });
});
