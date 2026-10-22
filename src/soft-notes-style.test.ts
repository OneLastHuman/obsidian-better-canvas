import { describe, expect, it } from "vitest";
import type { CanvasData } from "./canvas";
import { applySoftNotesPreset, resolveSoftNotesStyle, SOFT_NOTES_PRESETS } from "./soft-notes-style";
import { resolveCanvasTheme, withCanvasTheme } from "./canvas-theme";

const data: CanvasData = {
  bcTheme: "soft-notes", extra: { keep: true },
  nodes: [
    { id: "a", type: "text", x: 5, y: 8, width: 320, height: 240, text: "- [ ] Keep task",
      color: "#123456", bcShape: "diamond", styleAttributes: { custom: "keep" } },
    { id: "b", type: "text", x: 400, y: 8, width: 320, height: 240, text: "# Keep title" },
    { id: "g", type: "group", x: 0, y: 0, width: 800, height: 300, label: "Keep group" },
    { id: "f", type: "file", x: 850, y: 0, width: 100, height: 100, file: "image.png" }
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }]
};

describe("Soft Notes presets", () => {
  it("offers the approved five silhouettes followed by transparent free text", () => {
    expect(SOFT_NOTES_PRESETS.map(item => item.id)).toEqual(["spark", "excerpt", "concept", "action", "question", "free"]);
    expect(new Set(SOFT_NOTES_PRESETS.map(item => item.path)).size).toBe(6);
    expect(resolveCanvasTheme(data)).toBe("soft-notes");
    expect(withCanvasTheme(data, "default").nodes).toBe(data.nodes);
  });

  it.each(SOFT_NOTES_PRESETS)("applies $id in batch without replacing contents or unrelated fields", preset => {
    const before = structuredClone(data);
    const { data: next, updated } = applySoftNotesPreset(data, ["a", "b", "g", "f"], preset.id);
    expect(updated).toBe(2);
    for (const [index, original] of data.nodes.slice(0, 2).entries()) {
      const node = next.nodes[index];
      expect(node).toMatchObject({
        id: original.id, text: original.text, x: original.x, y: original.y,
        width: original.width, height: original.height,
        bcSoftNotesPreset: preset.id, bcBorderStyle: "invisible", bcTextAlign: preset.align
      });
      expect(resolveSoftNotesStyle(node)).toMatchObject({ preset, color: preset.color, align: preset.align });
    }
    expect(next.nodes[0].styleAttributes).toMatchObject({ custom: "keep", border: "invisible", shape: "rectangle" });
    expect(next.nodes[2]).toBe(data.nodes[2]);
    expect(next.nodes[3]).toBe(data.nodes[3]);
    expect(next.edges).toBe(data.edges);
    expect(next.extra).toBe(data.extra);
    expect(data).toEqual(before);
    expect(resolveSoftNotesStyle(JSON.parse(JSON.stringify(next)).nodes[0]).preset.id).toBe(preset.id);
  });

  it("ignores unknown presets, empty selections and missing nodes", () => {
    for (const [ids, id] of [[["a"], "insight"], [[], "spark"], [["missing"], "free"]] as const) {
      expect(applySoftNotesPreset(data, ids, id)).toEqual({ data, updated: 0 });
    }
  });

  it("keeps free text transparent even with a stored colour and rejects unsafe fills", () => {
    expect(resolveSoftNotesStyle({ ...data.nodes[0], bcSoftNotesPreset: "free" }).color).toBe("transparent");
    expect(resolveSoftNotesStyle({ ...data.nodes[0], color: 'url("https://example.test/track")' }).color).toBe("#efd4f7");
    expect(resolveSoftNotesStyle({ ...data.nodes[0], bcSoftNotesPreset: "unknown" }).preset.id).toBe("spark");
  });
});
