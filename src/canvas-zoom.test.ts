import { describe, expect, it } from "vitest";
import { zoomCanvasToFit } from "./canvas-zoom";

describe("zoomCanvasToFit", () => {
  it("zooms with all nodes selected and restores the prior selection afterward", () => {
    const a = { id: "a" }, b = { id: "b" }, edge = { id: "edge" };
    const selection = new Set<any>([edge]);
    let zoomSelection: string[] = [];
    let frameRequested = false;
    const canvas = {
      nodes: new Map([["a", a], ["b", b]]),
      selection,
      deselectAll() { selection.clear(); },
      select(element: any) { selection.add(element); },
      zoomToSelection() { zoomSelection = [...selection].map(item => item.id); },
      requestFrame() { frameRequested = true; }
    };

    expect(zoomCanvasToFit(canvas)).toBe(2);
    expect(zoomSelection).toEqual(["a", "b"]);
    expect([...selection]).toEqual([edge]);
    expect(frameRequested).toBe(true);
  });

  it("does not zoom an empty Canvas or a host without native zoom support", () => {
    const empty = {
      nodes: new Map(),
      selection: new Set(),
      select() {},
      zoomToSelection() { throw new Error("should not zoom"); }
    };
    expect(zoomCanvasToFit(empty)).toBe(0);
    expect(zoomCanvasToFit({ nodes: new Map(), select() {} })).toBe(0);
  });

  it("restores the prior selection even when native zoom throws", () => {
    const a = { id: "a" }, edge = { id: "edge" };
    const selection = new Set<any>([edge]);
    const canvas = {
      nodes: new Map([["a", a]]),
      selection,
      deselectAll() { selection.clear(); },
      select(item: any) { selection.add(item); },
      zoomToSelection() { throw new Error("zoom failed"); }
    };
    expect(() => zoomCanvasToFit(canvas)).toThrow("zoom failed");
    expect([...selection]).toEqual([edge]);
  });
});
