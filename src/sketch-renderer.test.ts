import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "./canvas";
import { renderSketchNodeSvg, sketchPresetPreviewSvg, sketchSeed } from "./sketch-renderer";
import { SKETCH_PRESETS } from "./sketch-style";

function node(preset: string, id = "node-" + preset): CanvasNodeData {
  return {
    id, type: "text", x: 0, y: 0, width: 240, height: 120,
    text: "内容", bcSketchPreset: preset
  };
}

describe("sketch renderer", () => {
  it("produces deterministic, non-empty markup for every functional preset", () => {
    for (const preset of SKETCH_PRESETS) {
      const first = renderSketchNodeSvg(node(preset.id), { ink: "#262520" });
      const second = renderSketchNodeSvg(node(preset.id), { ink: "#262520" });
      expect(first).toBe(second);
      if (preset.id === "annotation") {
        // Plain text has no frame or fill; the node itself remains visible.
        expect(first).toBe("");
        continue;
      }
      expect(first).toContain("<path");
      expect(first).not.toContain("NaN");
      expect(first).not.toContain("undefined");
    }
  });

  it("uses different geometry and fills for different functions", () => {
    const concept = renderSketchNodeSvg(node("concept"), { ink: "#000" });
    const decision = renderSketchNodeSvg(node("decision"), { ink: "#000" });
    const heading = renderSketchNodeSvg(node("heading"), { ink: "#000" });
    expect(concept).not.toBe(decision);
    expect(concept).toContain("opacity=\"0.58\"");
    expect(heading).not.toContain("hachure");
    expect(heading.length).toBeLessThan(decision.length);
  });

  it("gives the same node a stable seed while differentiating neighbours", () => {
    expect(sketchSeed("alpha")).toBe(sketchSeed("alpha"));
    expect(sketchSeed("alpha")).not.toBe(sketchSeed("beta"));
  });

  it("renders dashed group frames without a fill", () => {
    const markup = renderSketchNodeSvg({
      id: "g", type: "group", x: 0, y: 0, width: 600, height: 400
    }, { ink: "#333" });
    expect(markup).toContain("path");
    expect(markup).not.toContain("fill=\"#");
    expect(markup).toContain("opacity=\"0.55\"");
  });

  it("supports a compact preview for the style panel", () => {
    const svg = sketchPresetPreviewSvg("action");
    expect(svg).toContain("viewBox=\"0 0 116 48\"");
    expect(svg).toContain("<path");
  });
});
