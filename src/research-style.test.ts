import { describe, expect, it } from "vitest";
import type { CanvasData } from "./canvas";
import {
  applyResearchPreset, applyResearchIntensity, researchPreset, researchColor,
  researchFill, researchIntensity, RESEARCH_PRESETS
} from "./research-style";

const data: CanvasData = {
  bcTheme: "research", extension: { keep: true },
  nodes: [
    { id: "a", type: "text", x: 10, y: 20, width: 300, height: 250, text: "# 原文\n\n> 引文\n\n**正文**", styleAttributes: { custom: "keep", shape: "diamond" }, bcSketchPreset: "risk" },
    { id: "b", type: "text", x: 400, y: 20, width: 300, height: 250, text: "没有标题的材料" },
    { id: "g", type: "group", x: 0, y: 0, width: 800, height: 500, label: "资料" }
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }]
};

describe("paper research styles", () => {
  it.each(RESEARCH_PRESETS)("applies $id without rewriting content, bounds, edges or unknown fields", preset => {
    const before = structuredClone(data);
    const result = applyResearchPreset(data, ["a", "b", "g", "missing", "a"], preset.id);
    expect(result.updated).toBe(2);
    expect(result.data.nodes[2]).toBe(data.nodes[2]);
    expect(result.data.edges).toBe(data.edges);
    expect(result.data.extension).toBe(data.extension);
    result.data.nodes.slice(0, 2).forEach((node, index) => {
      expect(node).toMatchObject({
        text: data.nodes[index].text, x: data.nodes[index].x, y: 20, width: 300, height: 250,
        bcResearchPreset: preset.id, color: preset.color, bcShape: preset.shape, bcBorderStyle: preset.border
      });
    });
    expect(result.data.nodes[0]).toMatchObject({ bcSketchPreset: "risk", styleAttributes: { custom: "keep" } });
    expect(data).toEqual(before);
  });

  it("keeps exactly six presets and safely defaults malformed metadata", () => {
    expect(RESEARCH_PRESETS.map(preset => preset.id)).toEqual(["source", "quote", "annotation", "argument", "question", "section"]);
    expect(researchPreset("index").id).toBe("source");
    expect(researchPreset({})).toBe(RESEARCH_PRESETS[0]);
    expect(researchIntensity("40")).toBe(26);
    expect(applyResearchPreset(data, ["a"], "unknown").data).toBe(data);
    expect(applyResearchPreset(data, [], "quote").updated).toBe(0);
    expect(applyResearchPreset(data, ["g"], "quote").data).toBe(data);
  });

  it("changes only intensity and rejects invalid values", () => {
    const result = applyResearchIntensity(data, ["a", "g"], 40);
    expect(result.updated).toBe(1);
    expect(result.data.nodes[0]).toEqual({ ...data.nodes[0], bcResearchIntensity: 40 });
    expect(result.data.nodes[1]).toBe(data.nodes[1]);
    expect(applyResearchIntensity(data, ["a"], NaN).data).toBe(data);
    expect(applyResearchIntensity(data, ["a"], 100).data).toBe(data);
  });

  it("resolves safe native/custom inks and shares paper fills with export", () => {
    expect(researchColor({ ...data.nodes[0], color: "5" })).toBe("#416879");
    expect(researchColor({ ...data.nodes[0], color: "#abc" })).toBe("#aabbcc");
    expect(researchColor({ ...data.nodes[0], color: 'url("https://example.com")' })).toBe("#a84e34");
    const quote = { ...data.nodes[0], bcResearchPreset: "quote" };
    expect(researchFill({ ...quote, bcResearchIntensity: 15 })).not.toBe(researchFill({ ...quote, bcResearchIntensity: 40 }));
    expect(researchFill({ ...quote, bcResearchPreset: "section" })).toBe("none");
    expect(researchFill(data.nodes[0])).toBe("#fffdf7");
  });
});
