import { describe, expect, it } from "vitest";
import { computeMindMapLayout, type MindMapLayoutNode, type MindMapLayoutEdge } from "./mindmap-layout";

function node(id: string, x = 0, y = 0, width = 100, height = 60): MindMapLayoutNode {
  return { id, x, y, width, height };
}

function edge(fromNode: string, toNode: string): MindMapLayoutEdge {
  return { fromNode, toNode };
}

function overlapping(a: MindMapLayoutNode, b: MindMapLayoutNode, pa: { x: number; y: number }, pb: { x: number; y: number }): boolean {
  return pa.x < pb.x + b.width && pa.x + a.width > pb.x &&
    pa.y < pb.y + b.height && pa.y + a.height > pb.y;
}

describe("mind-map layered graph layout", () => {
  it("keeps the root anchored and places variable-size LR layers without overlap", () => {
    const nodes = [
      node("root", 40, 70, 180, 100),
      node("a", 0, 0, 120, 50),
      node("b", 0, 0, 80, 90),
      node("c", 0, 0, 200, 45),
      node("d", 0, 0, 130, 70)
    ];
    const positions = computeMindMapLayout(nodes, [
      edge("root", "a"), edge("root", "b"), edge("a", "c"), edge("b", "d")
    ], "root", "LR", 30, 20);

    expect(positions.get("root")).toEqual({ x: 40, y: 70 });
    expect(positions.get("a")?.x).toBe(250);
    expect(positions.get("b")?.x).toBe(250);
    expect(positions.get("c")?.x).toBeGreaterThan(positions.get("a")!.x + 120);
    expect(positions.get("d")?.x).toBeGreaterThan(positions.get("b")!.x + 80);

    const reachable = nodes.filter(n => positions.has(n.id));
    for (let i = 0; i < reachable.length; i += 1) {
      for (let j = i + 1; j < reachable.length; j += 1) {
        expect(overlapping(reachable[i], reachable[j], positions.get(reachable[i].id)!, positions.get(reachable[j].id)!))
          .toBe(false);
      }
    }
  });

  it("supports RL, TB and BT directions with a configurable primary-axis gap", () => {
    const nodes = [node("root", 500, 300, 100, 80), node("child", 0, 0, 160, 90)];
    const edges = [edge("root", "child")];
    const rl = computeMindMapLayout(nodes, edges, "root", "RL", 25, 15);
    const tb = computeMindMapLayout(nodes, edges, "root", "TB", 25, 15);
    const bt = computeMindMapLayout(nodes, edges, "root", "BT", 25, 15);

    expect(rl.get("child")!.x + 160).toBe(475);
    expect(tb.get("child")!.y).toBe(395);
    expect(bt.get("child")!.y + 90).toBe(275);
    expect(tb.get("root")).toEqual({ x: 500, y: 300 });
    expect(bt.get("root")).toEqual({ x: 500, y: 300 });
  });

  it("places a shared descendant only once in the shallowest reachable layer", () => {
    const nodes = [node("root"), node("a"), node("b"), node("shared"), node("tail")];
    const positions = computeMindMapLayout(nodes, [
      edge("root", "a"), edge("root", "b"),
      edge("a", "shared"), edge("b", "shared"), edge("shared", "tail")
    ], "root", "LR");

    expect([...positions.keys()].sort()).toEqual(["a", "b", "root", "shared", "tail"]);
    expect(positions.get("shared")!.x).toBeGreaterThan(positions.get("a")!.x);
    expect(positions.get("tail")!.x).toBeGreaterThan(positions.get("shared")!.x);
  });

  it("terminates on cycles and excludes disconnected nodes", () => {
    const nodes = [node("root", 10, 20), node("a"), node("b"), node("child"), node("isolated", 999, 888)];
    const positions = computeMindMapLayout(nodes, [
      edge("root", "a"), edge("a", "b"), edge("b", "root"), edge("b", "child"), edge("missing", "child")
    ], "root", "TB");

    expect([...positions.keys()].sort()).toEqual(["a", "b", "child", "root"]);
    expect(positions.get("root")).toEqual({ x: 10, y: 20 });
    expect(positions.has("isolated")).toBe(false);
  });

  it("uses stable ordering and reduces crossings in a two-layer crossing graph", () => {
    const nodes = [node("root"), node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("root", "a"), edge("root", "b"), edge("a", "d"), edge("b", "c")];
    const first = computeMindMapLayout(nodes, edges, "root", "LR");
    const second = computeMindMapLayout(nodes, edges, "root", "LR");

    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(first.get("a")!.y).toBeLessThan(first.get("b")!.y);
    expect(first.get("d")!.y).toBeLessThan(first.get("c")!.y);
  });

  it("returns no positions for an unknown root and preserves empty layouts", () => {
    expect(computeMindMapLayout([node("a")], [], "missing", "LR")).toEqual(new Map());
    expect(computeMindMapLayout([], [], "missing", "LR")).toEqual(new Map());
  });

  it("clamps negative spacing and handles invalid dimensions without NaN coordinates", () => {
    const nodes = [
      node("root", 1, 2, -100, Number.NaN),
      node("child", 0, 0, Number.POSITIVE_INFINITY, 0)
    ];
    const positions = computeMindMapLayout(nodes, [edge("root", "child")], "root", "LR", -10, -1);
    expect(positions.get("root")).toEqual({ x: 1, y: 2 });
    expect(Number.isFinite(positions.get("child")!.x)).toBe(true);
    expect(Number.isFinite(positions.get("child")!.y)).toBe(true);
    expect(positions.get("child")!.x).toBe(281);
  });
});
