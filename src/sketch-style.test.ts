import { describe, expect, it } from "vitest";
import type { CanvasData } from "./canvas";
import {
  applySketchFill,
  applySketchPreset,
  resolveSketchStyle,
  SKETCH_PRESETS,
  sketchPreset
} from "./sketch-style";

const fixture: CanvasData = {
  metadata: { keep: "yes" },
  nodes: [
    {
      id: "a",
      type: "text",
      x: 10,
      y: 20,
      width: 280,
      height: 140,
      text: "Keep content",
      bcShape: "diamond",
      styleAttributes: { custom: "keep" },
      pluginMetadata: { keep: true }
    },
    { id: "b", type: "text", x: 400, y: 20, width: 200, height: 80, text: "Other" },
    { id: "group", type: "group", x: 0, y: 0, width: 800, height: 600, label: "Frame" }
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }]
};

describe("sketch functional presets", () => {
  it("exposes the approved six functions in a stable order", () => {
    expect(SKETCH_PRESETS.map(preset => preset.id)).toEqual([
      "heading", "concept", "action", "decision", "annotation", "risk"
    ]);
    expect(sketchPreset("future")).toBeNull();
  });

  it("applies one whole preset without changing content, geometry, edges or unknown fields", () => {
    const before = structuredClone(fixture);
    const result = applySketchPreset(fixture, ["a"], "decision");
    expect(result.updated).toBe(1);
    expect(result.data.nodes[0]).toMatchObject({
      id: "a", x: 10, y: 20, width: 280, height: 140, text: "Keep content",
      bcSketchPreset: "decision", bcSketchFill: "solid", bcShape: "diamond",
      bcBorderStyle: "solid", bcTextAlign: "center", color: "#e8b75a",
      pluginMetadata: { keep: true },
      styleAttributes: { custom: "keep", shape: "diamond", border: "solid", textAlign: "center" }
    });
    expect(result.data.nodes[1]).toBe(fixture.nodes[1]);
    expect(result.data.nodes[2]).toBe(fixture.nodes[2]);
    expect(result.data.edges).toBe(fixture.edges);
    expect(result.data.metadata).toEqual({ keep: "yes" });
    expect(fixture).toEqual(before);
  });

  it("skips groups and reports no update when nothing is eligible", () => {
    const groupOnly = applySketchPreset(fixture, ["group"], "concept");
    expect(groupOnly.updated).toBe(0);
    expect(groupOnly.data).toBe(fixture);
    expect(applySketchPreset(fixture, ["missing"], "concept").data).toBe(fixture);
    expect(applySketchPreset(fixture, ["a"], "unknown").data).toBe(fixture);
  });

  it("applies a fill without replacing the rest of the preset", () => {
    const result = applySketchFill(fixture, ["a", "b"], "cross-hatch");
    expect(result.updated).toBe(2);
    expect(result.data.nodes[0]).toMatchObject({ bcShape: "diamond", bcSketchFill: "cross-hatch" });
    expect(result.data.nodes[0].bcSketchPreset).toBeUndefined();
    expect(applySketchFill(fixture, ["a"], "invalid").data).toBe(fixture);
  });

  it("resolves explicit node choices after a preset", () => {
    const styled = applySketchPreset(fixture, ["a"], "concept").data.nodes[0];
    const overridden = {
      ...styled,
      bcShape: "square",
      bcSketchFill: "solid",
      color: "#123456",
      bcBorderStyle: "dotted",
      bcTextAlign: "right"
    };
    expect(resolveSketchStyle(overridden)).toMatchObject({
      preset: { id: "concept" },
      shape: "square", fill: "solid", color: "#123456", border: "dotted", align: "right"
    });
  });

  it("falls back to preset geometry when only the preset marker survived", () => {
    expect(resolveSketchStyle({
      id: "a", type: "text", x: 0, y: 0, width: 100, height: 100,
      bcSketchPreset: "risk"
    })).toMatchObject({
      shape: "square", fill: "cross-hatch", color: "#e8798f", border: "dashed", align: "left"
    });
  });
});
