import { describe, expect, it } from "vitest";
import { decorateAutoResizeInsets, fitContentDimension, textShapeInsets } from "./node-rendered-layout";
import { roundedMapInsets } from "./rounded-map-style";
import { softNotesPreset } from "./soft-notes-style";

describe("fitting rendered content inside theme insets", () => {
  it("preserves the original default-card dimensions and caps", () => {
    expect(fitContentDimension(128, 80, 440, () => 48)).toBe(176);
    expect(fitContentDimension(384, 80, 440, () => 48)).toBe(432);
    expect(fitContentDimension(400, 80, 440, () => 48)).toBe(440);
    expect(fitContentDimension(24, 44, 560, () => 20)).toBe(44);
    expect(fitContentDimension(600, 44, 560, () => 20)).toBe(560);
  });

  it("reserves the rounded theme's padding instead of fitting inside the old box", () => {
    const width = fitContentDimension(128, 80, 440, value => {
      const inset = roundedMapInsets("default", value, 44);
      return inset.x + inset.right + 14;
    });
    expect(width).toBe(198);
    expect(fitContentDimension(24, 44, 560, () => 38)).toBe(62);
  });

  it("solves proportional shape padding using the final size", () => {
    for (const presetId of ["spark", "excerpt", "concept", "action", "question", "free"]) {
      const { inset } = softNotesPreset(presetId);
      const overhead = (height: number) => height * (inset[0] + inset[2]) + 2;
      const height = fitContentDimension(48, 44, 560, overhead);
      expect(height - overhead(height)).toBeGreaterThanOrEqual(48);
      expect(height - 1 - overhead(height - 1)).toBeLessThan(48);
    }
  });

  it("keeps long content scrollable at the maximum height, even inside a diamond", () => {
    const height = fitContentDimension(1000, 44, 560, value => value * .54 + 2);
    expect(height).toBe(560);
  });

  it("keeps a diamond's text rectangle inside its clip after switching away from Rounded Map", () => {
    const node = { id: "diamond", type: "text", text: "label", bcShape: "diamond", bcAutoResize: true, x: 0, y: 0, width: 440, height: 300 };
    for (const theme of ["default", "sketch", "scrapbook", "research"] as const) {
      const inset = textShapeInsets(theme, node, node.width, node.height)!;
      const cornerDistance = (node.width / 2 - inset.left) / (node.width / 2) +
        (node.height / 2 - inset.top) / (node.height / 2);
      expect(cornerDistance).toBeLessThan(1);
    }
    expect(textShapeInsets("default", { ...node, bcAutoResize: false }, 440, 300)).toBeNull();
  });

  it("synchronizes the auto-resize marker even when a rectangle has no shape inset", () => {
    const element = { dataset: {} } as HTMLElement;
    const node = { id: "a", type: "text", text: "label", bcAutoResize: true, x: 0, y: 0, width: 176, height: 44 };
    for (const restored of [
      { ...node, bcAutoResize: false },
      { ...node, bcAutoResize: undefined },
      { ...node, type: "file" }
    ]) {
      decorateAutoResizeInsets(element, node, "default");
      expect(element.dataset.bcAutoResize).toBe("true");
      expect(element.dataset.bcAutoShape).toBeUndefined();
      decorateAutoResizeInsets(element, restored, "default");
      expect(element.dataset.bcAutoResize).toBeUndefined();
    }
  });

  it("clears the previous theme's safe area when returning to a rectangle or disabling auto-resize", () => {
    const values = new Map<string, string>();
    const element = {
      dataset: {} as Record<string, string>,
      style: {
        getPropertyValue: (key: string) => values.get(key),
        setProperty: (key: string, value: string) => values.set(key, value),
        removeProperty: (key: string) => values.delete(key)
      }
    } as unknown as HTMLElement;
    const node = { id: "a", type: "text", text: "label", bcAutoResize: true, x: 0, y: 0, width: 176, height: 44 };
    decorateAutoResizeInsets(element, node, "soft-notes");
    expect(element.dataset.bcAutoResize).toBe("true");
    expect(element.dataset.bcAutoShape).toBe("true");
    decorateAutoResizeInsets(element, node, "default");
    expect(element.dataset.bcAutoResize).toBe("true");
    expect(element.dataset.bcAutoShape).toBeUndefined();
    expect(values.size).toBe(0);
    decorateAutoResizeInsets(element, node, "rounded-map");
    decorateAutoResizeInsets(element, { ...node, bcAutoResize: false }, "rounded-map");
    expect(element.dataset.bcAutoResize).toBeUndefined();
    expect(element.dataset.bcAutoShape).toBeUndefined();
    expect(values.size).toBe(0);
  });
});
