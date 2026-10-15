import { describe, expect, it } from "vitest";
import { createNodeExpansionEdge, cloneCanvasNodeInDirection } from "./canvas-clone";

const source = {
  id: "source",
  type: "text" as const,
  x: 100,
  y: 200,
  width: 160,
  height: 90,
  text: "**Original** note",
  color: "4",
  styleAttributes: { shape: "diamond", border: "dashed", custom: { keep: true } },
  bcCustomClass: "highlighted",
  unknownExtension: { value: 7 }
};

describe("cloneCanvasNodeInDirection", () => {
  it.each([
    ["left", -80, 200],
    ["right", 360, 200],
    ["up", 100, 90],
    ["down", 100, 310]
  ] as const)("clones %s with correct placement", (direction, x, y) => {
    const clone = cloneCanvasNodeInDirection(source, direction, 20, "clone");
    expect(clone).toMatchObject({ id: "clone", x, y, width: 160, height: 90, text: source.text });
    expect(clone.styleAttributes).toEqual(source.styleAttributes);
    expect(clone.unknownExtension).toEqual({ value: 7 });
  });

  it("deep-clones nested extension data so later edits cannot mutate the source", () => {
    const clone = cloneCanvasNodeInDirection(source, "right", 20, "clone");
    clone.styleAttributes.custom.keep = false;
    expect(source.styleAttributes.custom.keep).toBe(true);
  });

  it("normalizes invalid spacing to zero and keeps negative spacing from overlapping", () => {
    expect(cloneCanvasNodeInDirection(source, "right", -10, "clone").x).toBe(260);
    expect(cloneCanvasNodeInDirection(source, "right", Number.NaN, "clone").x).toBe(260);
  });
});

describe("createNodeExpansionEdge", () => {
  it.each([
    ["left", "left", "right"],
    ["right", "right", "left"],
    ["up", "top", "bottom"],
    ["down", "bottom", "top"]
  ] as const)("orients a %s expansion edge", (direction, fromSide, toSide) => {
    expect(createNodeExpansionEdge("source", "clone", "edge", direction)).toEqual({
      id: "edge", fromNode: "source", fromSide, toNode: "clone", toSide
    });
  });
});
