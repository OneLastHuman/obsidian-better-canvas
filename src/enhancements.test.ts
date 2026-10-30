import { describe, expect, it, vi } from "vitest";
import {
  bestFloatingSide,
  routePointsForMethod,
  colorIncidentEdges,
  selectAllCanvasEdges,
  decorateCanvas,
  flipIncidentEdges,
  normalizeNodeShape,
  reorderNode,
  styleSelectedEdgeArrow,
  styleSelectedEdgePathfinding,
  styleSelectedEdges,
  toggleGroupCollapse
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

describe("Canvas edge route calculation", () => {
  const start = { x: 100, y: 40 };
  const end = { x: 220, y: 220 };

  it("returns a direct route without extra waypoints", () => {
    expect(routePointsForMethod("direct", start, end, "right", "left")).toEqual([start, end]);
  });

  it("creates orthogonal waypoints for square routes", () => {
    expect(routePointsForMethod("square", start, end, "right", "left")).toEqual([
      start, { x: 160, y: 40 }, { x: 160, y: 220 }, end
    ]);
  });

  it("routes around blocking node boxes for A-star paths", () => {
    const points = routePointsForMethod(
      "a-star",
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      "right",
      "left",
      [{ minX: 140, minY: 30, maxX: 240, maxY: 170 }]
    );
    expect(points.length).toBeGreaterThan(4);
    expect(points.some(point => point.y < 18 || point.y > 182)).toBe(true);
  });
});

describe("flowchart shape normalization", () => {
  it("maps common aliases to interoperable JSON Canvas shapes", () => {
    expect(normalizeNodeShape(" terminal ")).toBe("pill");
    expect(normalizeNodeShape("process")).toBe("rectangle");
    expect(normalizeNodeShape("decision")).toBe("diamond");
    expect(normalizeNodeShape("input-output")).toBe("parallelogram");
    expect(normalizeNodeShape("reference")).toBe("circle");
    expect(normalizeNodeShape("predefined-process")).toBe("predefined-process");
  });

  it("rejects unsupported shapes", () => {
    expect(normalizeNodeShape("unknown-shape")).toBeUndefined();
    expect(normalizeNodeShape("")).toBeUndefined();
  });
});

describe("selectAllCanvasEdges", () => {
  it("selects every live edge after clearing the prior selection", () => {
    const selected: any[] = [{ id: "old-selection" }];
    const edgeA = { id: "a" };
    const edgeB = { id: "b" };
    let deselected = false;
    const canvas = {
      edges: new Map([["a", edgeA], ["b", edgeB]]),
      deselectAll: () => { deselected = true; selected.length = 0; },
      select: (edge: any) => { selected.push(edge); }
    };

    expect(selectAllCanvasEdges(canvas)).toBe(2);
    expect(deselected).toBe(true);
    expect(selected).toEqual([edgeA, edgeB]);
  });

  it("returns zero without changing selection when no edges can be selected", () => {
    const canvas = { edges: new Map(), select: () => undefined, deselectAll: () => { throw new Error("should not clear"); } };
    expect(selectAllCanvasEdges(canvas)).toBe(0);
    expect(selectAllCanvasEdges({ edges: new Map() })).toBe(0);
  });
});

describe("Canvas node decoration", () => {
  it("preserves the native border for nodes with the default border style", () => {
    class FakeHTMLElement {
      dataset: Record<string, string> = {};
      style: Record<string, string> = {};
      setCssStyles(styles: Record<string, string>): void {
        Object.assign(this.style, styles);
      }
      querySelectorAll(): any[] {
        return [];
      }
    }

    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    try {
      const element = new FakeHTMLElement();
      const canvas = {
        getData: () => ({
          nodes: [{ id: "a", x: 0, y: 0, width: 100, height: 100, type: "text" }],
          edges: []
        }),
        nodes: new Map([["a", { nodeEl: element }]]),
        edges: new Map()
      };

      decorateCanvas(canvas);

      expect(element.dataset.bcBorder).toBe("solid");
      expect(element.style.borderStyle).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

describe("floating edge side selection", () => {
  const box = { minX: 0, minY: 0, maxX: 100, maxY: 80 };

  it("chooses the side facing the other node", () => {
    expect(bestFloatingSide(box, { x: 300, y: 40 })).toBe("right");
    expect(bestFloatingSide(box, { x: -100, y: 40 })).toBe("left");
    expect(bestFloatingSide(box, { x: 50, y: 200 })).toBe("bottom");
    expect(bestFloatingSide(box, { x: 50, y: -100 })).toBe("top");
  });

  it("merges background floating-side updates into the current history entry", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "a", type: "text", text: "A", bcAutoResize: true, x: 0, y: 0, width: 80, height: 44 },
        { id: "b", type: "text", text: "B", x: 360, y: 200, width: 280, height: 140 }
      ],
      edges: [{ id: "ab", fromNode: "a", toNode: "b", fromSide: "bottom", toSide: "top", fromFloating: true }]
    });
    canvas.history = { current: 0, data: [JSON.parse(JSON.stringify(canvas.data))] };
    canvas.requestSave = vi.fn();
    vi.stubGlobal("HTMLElement", class {});
    vi.stubGlobal("SVGElement", class {});
    try {
      decorateCanvas(canvas, false);
      expect(canvas.data.edges[0].fromSide).toBe("right");
      expect(canvas.requestSave).toHaveBeenCalledExactlyOnceWith(false);
      expect(canvas.history.data).toHaveLength(1);
      expect(canvas.history.data[0].edges[0].fromSide).toBe("right");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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
      fromEnd: "arrow",
      toEnd: "arrow",
      styleAttributes: { arrow: "halved-triangle" }
    });

    expect(styleSelectedEdgeArrow(canvas, "none")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      bcArrowStyle: "none",
      fromEnd: "none",
      toEnd: "none"
    });

    expect(styleSelectedEdgeArrow(canvas, "diamond")).toBe(1);
    expect(canvas.data.edges[0]).toMatchObject({
      bcArrowStyle: "diamond",
      fromEnd: "arrow",
      toEnd: "arrow"
    });
  });

  it("moves a node in z-order without altering edge references", () => {
    const canvas = makeCanvas(fixture);
    expect(reorderNode(canvas, "a", true)).toBe(true);
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["b", "a"]);
    expect(canvas.data.edges).toEqual(fixture.edges);
  });
});

describe("collapsible Canvas groups", () => {
  it("hides contained nodes and their edges, then restores geometry and boundary edges", () => {
    const data: CanvasData = {
      nodes: [
        { id: "group", x: 100, y: 50, width: 320, height: 220, type: "group", label: "Research" } as any,
        { id: "inside", x: 130, y: 90, width: 110, height: 80, type: "text", text: "Inside" },
        { id: "outside", x: 520, y: 100, width: 110, height: 80, type: "text", text: "Outside" }
      ],
      edges: [
        { id: "inside-outside", fromNode: "inside", fromSide: "right", toNode: "outside", toSide: "left" },
        { id: "group-outside", fromNode: "group", fromSide: "right", toNode: "outside", toSide: "left" }
      ]
    };
    const canvas = makeCanvas(data);

    expect(toggleGroupCollapse(canvas, "group")).toBe("collapsed");
    expect(canvas.data.nodes.map((node: any) => node.id)).toEqual(["group", "outside"]);
    expect(canvas.data.edges.map((edge: any) => edge.id)).toEqual(["group-outside"]);
    expect(canvas.data.nodes[0]).toMatchObject({
      bcCollapsed: true,
      bcCollapsedNodes: [{ id: "inside", x: 30, y: 40 }]
    });
    expect(canvas.data.nodes[0].bcCollapsedEdges).toEqual([data.edges[0]]);

    expect(toggleGroupCollapse(canvas, "group")).toBe("expanded");
    expect(canvas.data.nodes.find((node: any) => node.id === "inside")).toMatchObject({
      x: 130,
      y: 90,
      text: "Inside"
    });
    expect(canvas.data.edges.map((edge: any) => edge.id).sort()).toEqual(["group-outside", "inside-outside"]);
    expect(canvas.data.nodes.find((node: any) => node.id === "group")).not.toHaveProperty("bcCollapsedNodes");
  });

  it("reports an empty group without changing or saving the Canvas", () => {
    const data: CanvasData = {
      nodes: [
        { id: "group", x: 0, y: 0, width: 300, height: 220, type: "group", label: "Empty" } as any
      ],
      edges: []
    };
    const canvas = makeCanvas(data);
    const before = JSON.stringify(canvas.data);

    expect(toggleGroupCollapse(canvas, "group")).toBe("empty");
    expect(JSON.stringify(canvas.data)).toBe(before);
    expect(canvas.saved).toBe(0);
    expect(canvas.frames).toBe(0);
  });

  it("does not restore a hidden edge after its outside endpoint is deleted", () => {
    const data: CanvasData = {
      nodes: [
        { id: "group", x: 0, y: 0, width: 300, height: 220, type: "group" } as any,
        { id: "inside", x: 30, y: 40, width: 100, height: 80, type: "text", text: "Inside" },
        { id: "outside", x: 500, y: 50, width: 100, height: 80, type: "text", text: "Outside" }
      ],
      edges: [
        { id: "cross-boundary", fromNode: "inside", fromSide: "right", toNode: "outside", toSide: "left" }
      ]
    };
    const canvas = makeCanvas(data);

    expect(toggleGroupCollapse(canvas, "group")).toBe("collapsed");
    canvas.data.nodes = canvas.data.nodes.filter((node: any) => node.id !== "outside");
    expect(toggleGroupCollapse(canvas, "group")).toBe("expanded");
    expect(canvas.data.nodes.map((node: any) => node.id).sort()).toEqual(["group", "inside"]);
    expect(canvas.data.edges).toEqual([]);
  });

  it("preserves a collapsed nested group when its outer group is collapsed", () => {
    const data: CanvasData = {
      nodes: [
        { id: "outer", x: 0, y: 0, width: 500, height: 400, type: "group" } as any,
        { id: "inner", x: 30, y: 30, width: 220, height: 180, type: "group", bcCollapsed: true,
          bcCollapsedNodes: [{ id: "hidden", x: 15, y: 15, width: 60, height: 40, type: "text", text: "Nested" }],
          bcCollapsedEdges: [] } as any,
        { id: "visible", x: 300, y: 80, width: 100, height: 80, type: "text", text: "Visible" }
      ],
      edges: [{ id: "inner-visible", fromNode: "inner", fromSide: "right", toNode: "visible", toSide: "left" }]
    };
    const canvas = makeCanvas(data);

    expect(toggleGroupCollapse(canvas, "outer")).toBe("collapsed");
    expect(toggleGroupCollapse(canvas, "outer")).toBe("expanded");
    const restoredInner = canvas.data.nodes.find((node: any) => node.id === "inner");
    expect(restoredInner).toMatchObject({
      bcCollapsed: true,
      bcCollapsedNodes: [{ id: "hidden", text: "Nested" }]
    });
    expect(canvas.data.nodes.find((node: any) => node.id === "visible")).toBeTruthy();
    expect(canvas.data.edges).toEqual(data.edges);
  });
});
