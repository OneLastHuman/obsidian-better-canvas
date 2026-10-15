import { describe, expect, it } from "vitest";
import {
  createId,
  descendantsOf,
  insertCanvasNode,
  layoutTree,
  makeTextNode,
  readCanvasData,
  removeCanvasNode,
  selectedNodeIds,
  type CanvasData
} from "./canvas";

function makeCanvas(data: CanvasData = { nodes: [], edges: [] }): any {
  return {
    data: JSON.parse(JSON.stringify(data)),
    saved: 0,
    frames: 0,
    selection: new Set(),
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

describe("Canvas data helpers", () => {
  it("normalizes absent canvas data without throwing", () => {
    expect(readCanvasData({})).toEqual({ nodes: [], edges: [] });
    expect(readCanvasData({ getData: () => ({ nodes: [{ id: "a" }] }) })).toEqual({
      nodes: [{ id: "a" }],
      edges: []
    });
  });

  it("creates JSON Canvas-compatible hexadecimal IDs", () => {
    const id = createId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("removes a live node and all incident edges through the Canvas node API", () => {
    const data: CanvasData = {
      nodes: [
        { id: "source", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Source" },
        { id: "placeholder", x: 200, y: 0, width: 100, height: 100, type: "text", text: "" }
      ],
      edges: [
        { id: "to-placeholder", fromNode: "source", fromSide: "right", toNode: "placeholder", toSide: "left" },
        { id: "unrelated", fromNode: "source", fromSide: "bottom", toNode: "source", toSide: "top" }
      ]
    };
    const canvas = makeCanvas(data);
    const liveNode = { id: "placeholder" };
    canvas.nodes = new Map([["placeholder", liveNode]]);
    canvas.removeNode = (node: any) => {
      canvas.data.nodes = canvas.data.nodes.filter((item: any) => item.id !== node.id);
      canvas.data.edges = canvas.data.edges.filter((edge: any) => edge.fromNode !== node.id && edge.toNode !== node.id);
      canvas.nodes.delete(node.id);
    };

    expect(removeCanvasNode(canvas, "placeholder")).toBe(true);
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["source"]);
    expect(canvas.data.edges.map((edge: any) => edge.id)).toEqual(["unrelated"]);
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });

  it("uses setData when the live node API is unavailable", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "source", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Source" },
        { id: "placeholder", x: 200, y: 0, width: 100, height: 100, type: "text", text: "" }
      ],
      edges: [{ id: "incident", fromNode: "source", fromSide: "right", toNode: "placeholder", toSide: "left" }]
    });
    canvas.setData = (next: CanvasData) => { canvas.data = JSON.parse(JSON.stringify(next)); };

    expect(removeCanvasNode(canvas, "placeholder")).toBe(true);
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["source"]);
    expect(canvas.data.edges).toEqual([]);
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });

  it("removes incident edges if the node API leaves them behind", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "source", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Source" },
        { id: "placeholder", x: 200, y: 0, width: 100, height: 100, type: "text", text: "" }
      ],
      edges: [
        { id: "incident", fromNode: "source", fromSide: "right", toNode: "placeholder", toSide: "left" },
        { id: "unrelated", fromNode: "source", fromSide: "bottom", toNode: "source", toSide: "top" }
      ]
    });
    const liveNode = { id: "placeholder" };
    canvas.nodes = new Map([["placeholder", liveNode]]);
    canvas.removeNode = (node: any) => {
      // Simulate a node API that only removes the node object.
      canvas.data.nodes = canvas.data.nodes.filter((item: any) => item.id !== node.id);
      canvas.nodes.delete(node.id);
    };
    canvas.setData = (next: CanvasData) => {
      canvas.data = JSON.parse(JSON.stringify(next));
    };

    expect(removeCanvasNode(canvas, "placeholder")).toBe(true);
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["source"]);
    expect(canvas.data.edges.map((edge: any) => edge.id)).toEqual(["unrelated"]);
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });

  it("returns false when importData silently refuses to delete a node", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "source", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Source" },
        { id: "placeholder", x: 200, y: 0, width: 100, height: 100, type: "text", text: "" }
      ],
      edges: [{ id: "incident", fromNode: "source", fromSide: "right", toNode: "placeholder", toSide: "left" }]
    });
    canvas.importData = (next: CanvasData) => {
      const originalIds = new Set(canvas.data.nodes.map((node: any) => node.id));
      canvas.data = {
        ...next,
        nodes: [
          ...canvas.data.nodes,
          ...next.nodes.filter(node => !originalIds.has(node.id))
        ]
      };
    };

    expect(removeCanvasNode(canvas, "placeholder")).toBe(false);
    expect(canvas.data.nodes.some((node: any) => node.id === "placeholder")).toBe(true);
    expect(canvas.saved).toBe(0);
    expect(canvas.frames).toBe(0);
  });

  it("collects unique selected node IDs", () => {
    const canvas = makeCanvas();
    canvas.selection = new Set([{ id: "a" }, { id: "b" }, { id: "a" }, { getData: () => ({ id: "c" }) }]);
    expect(selectedNodeIds(canvas)).toEqual(["a", "b", "c"]);
  });

  it("inserts a node and attaches a correctly oriented edge", () => {
    const root = { id: "root", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Root" };
    const canvas = makeCanvas({ nodes: [root], edges: [] });
    const child = makeTextNode("Child", 220, 0, { width: 100, height: 100 });
    insertCanvasNode(canvas, child, "root");

    expect(canvas.data.nodes).toHaveLength(2);
    expect(canvas.data.edges).toHaveLength(1);
    expect(canvas.data.edges[0]).toMatchObject({
      fromNode: "root",
      fromSide: "right",
      toNode: child.id,
      toSide: "left"
    });
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });

  it("finds descendants without looping forever on cycles", () => {
    const canvas = makeCanvas({
      nodes: ["a", "b", "c"].map(id => ({ id, x: 0, y: 0, width: 100, height: 100, type: "text", text: id })),
      edges: [
        { id: "ab", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" },
        { id: "bc", fromNode: "b", fromSide: "right", toNode: "c", toSide: "left" },
        { id: "ca", fromNode: "c", fromSide: "left", toNode: "a", toSide: "right" }
      ]
    });
    expect(descendantsOf(canvas, "a").sort()).toEqual(["a", "b", "c"]);
  });

  it("lays out a tree in the requested direction while preserving graph data", () => {
    const nodes = [
      { id: "root", x: 0, y: 0, width: 100, height: 100, type: "text", text: "Root" },
      { id: "left", x: 10, y: 20, width: 100, height: 100, type: "text", text: "Left" },
      { id: "right", x: 10, y: 140, width: 100, height: 100, type: "text", text: "Right" },
      { id: "leaf", x: 20, y: 30, width: 100, height: 100, type: "text", text: "Leaf" }
    ];
    const edges = [
      { id: "e1", fromNode: "root", fromSide: "right", toNode: "left", toSide: "left" },
      { id: "e2", fromNode: "root", fromSide: "right", toNode: "right", toSide: "left" },
      { id: "e3", fromNode: "left", fromSide: "right", toNode: "leaf", toSide: "left" }
    ];
    const canvas = makeCanvas({ nodes, edges });
    const placed = layoutTree(canvas, "root", "LR", 80, 40);

    expect(placed).toBe(4);
    expect(canvas.data.nodes.find((node: any) => node.id === "root")?.x).toBe(0);
    expect(canvas.data.nodes.find((node: any) => node.id === "left")?.x).toBeGreaterThan(0);
    expect(canvas.data.nodes.find((node: any) => node.id === "leaf")?.x).toBeGreaterThan(
      canvas.data.nodes.find((node: any) => node.id === "left")?.x ?? 0
    );
    expect(canvas.data.edges).toEqual(edges);
    expect(canvas.saved).toBe(1);
    expect(canvas.frames).toBe(1);
  });
});
