import { describe, expect, it } from "vitest";
import { applyScrapbookPreset, resolveCanvasTheme, withCanvasTheme, setCanvasTheme, decorateCanvasTheme } from "./canvas-theme";
import type { CanvasData } from "./canvas";

const sample: CanvasData = {
  custom: { keep: true },
  nodes: [{ id: "a", type: "text", x: 12, y: 24, width: 280, height: 140, text: "Keep me", color: "#ff0000", bcShape: "diamond", styleAttributes: { border: "dashed", custom: "keep" } }],
  edges: [{ id: "e", fromNode: "a", toNode: "a", fromSide: "right", toSide: "left", color: "#123456" }]
};

describe("Canvas themes", () => {
  it("decorates research nodes without content mutations and clears them on theme change", () => {
    let data = withCanvasTheme(sample, "research");
    const nodeEl = { dataset: {} as Record<string, string>, style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      getPropertyValue: (key: string) => properties.get(key) ?? "",
      removeProperty: (key: string) => properties.delete(key)
    } };
    const properties = new Map<string, string>();
    const wrapperEl = { dataset: {} as Record<string, string> };
    const canvas = { getData: () => data, wrapperEl, nodes: new Map([["a", { nodeEl }]]) };
    decorateCanvasTheme(canvas);
    expect(resolveCanvasTheme(data)).toBe("research");
    expect(nodeEl.dataset.bcResearchPreset).toBe("source");
    expect(properties.get("--bc-research-accent")).toBe("#ff0000");
    expect(data.nodes).toBe(sample.nodes);
    data = withCanvasTheme(data, "rounded-map");
    decorateCanvasTheme(canvas);
    expect(nodeEl.dataset.bcResearchPreset).toBeUndefined();
    expect(properties.has("--bc-research-accent")).toBe(false);
    expect(nodeEl.dataset.bcRounded).toBe("true");
    data = withCanvasTheme(data, "research");
    decorateCanvasTheme(canvas);
    expect(nodeEl.dataset.bcRounded).toBeUndefined();
    expect(properties.has("--bc-rounded-clip")).toBe(false);
    expect(nodeEl.dataset.bcResearchPreset).toBe("source");
    data = withCanvasTheme(data, "scrapbook");
    decorateCanvasTheme(canvas);
    expect(nodeEl.dataset.bcResearchPreset).toBeUndefined();
    expect(properties.size).toBe(0);
    expect(nodeEl.dataset.bcPaper).toBe("tape");
  });
  it("falls back safely for old and unknown theme metadata", () => {
    expect(resolveCanvasTheme(sample)).toBe("default");
    expect(resolveCanvasTheme({ ...sample, bcTheme: "future" })).toBe("default");
    expect(resolveCanvasTheme({ ...sample, bcTheme: "scrapbook" })).toBe("scrapbook");
  });

  it("resolves the hand-drawn theme without treating unknown values as themes", () => {
    expect(resolveCanvasTheme({ ...sample, bcTheme: "sketch" })).toBe("sketch");
    expect(withCanvasTheme(sample, "sketch").bcTheme).toBe("sketch");
  });

  it("switches a whole board without rewriting cards, edges or extensions", () => {
    const next = withCanvasTheme(sample, "scrapbook");
    expect(next.bcTheme).toBe("scrapbook");
    expect(next.nodes).toBe(sample.nodes);
    expect(next.edges).toBe(sample.edges);
    expect(next.custom).toEqual({ keep: true });
    expect(sample.bcTheme).toBeUndefined();
    expect(withCanvasTheme(next, "default").bcTheme).toBe("default");
  });

  it("applies paper treatments to the selection without overwriting existing styles", () => {
    const before = structuredClone(sample);
    const next = applyScrapbookPreset(sample, ["a"], "tape");
    expect(next.nodes[0]).toEqual({ ...sample.nodes[0], bcScrapbookPreset: "tape" });
    expect(next.edges).toBe(sample.edges);
    expect(sample).toEqual(before);
    expect(applyScrapbookPreset(sample, ["missing"], "tape")).toEqual(sample);
    expect(applyScrapbookPreset(sample, ["a"], "unknown")).toBe(sample);
  });

  it("persists through native serialization and records reversible history", () => {
    const history: CanvasData[] = [];
    let saved: CanvasData | undefined;
    const canvas = {
      data: sample,
      getData() { return { ...this.data, nodes: sample.nodes, edges: sample.edges }; },
      pushHistory(data: CanvasData) { history.push(structuredClone(data)); },
      requestSave() { saved = this.getData(); }
    };
    expect(setCanvasTheme(canvas, "scrapbook")).toBe(true);
    expect(saved?.bcTheme).toBe("scrapbook");
    expect(history[0].bcTheme).toBeUndefined();
    expect(history[1].bcTheme).toBe("scrapbook");
    canvas.data = history[0];
    expect(resolveCanvasTheme(canvas.getData())).toBe("default");
  });

  it("does not enqueue a duplicate history entry that consumes the first undo", () => {
    let queuedHistory = false;
    const canvas = {
      data: sample,
      getData() { return this.data; },
      requestSave(history = true) { queuedHistory = history; }
    };
    setCanvasTheme(canvas, "scrapbook");
    expect(queuedHistory).toBe(false);
  });

  it("does not change a read-only board or a board already using the theme", () => {
    const canvas = { data: sample, readonly: true, getData: () => sample };
    expect(setCanvasTheme(canvas, "scrapbook")).toBe(false);
    expect(canvas.data).toBe(sample);
    canvas.readonly = false;
    expect(setCanvasTheme(canvas, "default")).toBe(false);
  });

  it("removes theme decorations when returning to an old snapshot", () => {
    let data = { ...sample, bcTheme: "scrapbook" } as CanvasData;
    const wrapperEl = { dataset: {} as Record<string, string> };
    const nodeEl = { dataset: {} as Record<string, string> };
    const canvas = { getData: () => data, wrapperEl, nodes: new Map([["a", { nodeEl }]]) };
    decorateCanvasTheme(canvas);
    expect(wrapperEl.dataset.bcTheme).toBe("scrapbook");
    expect(nodeEl.dataset.bcPaper).toBe("tape");
    expect(nodeEl.dataset.bcPaperBorder).toBe("explicit");
    data = sample;
    decorateCanvasTheme(canvas);
    expect(wrapperEl.dataset.bcTheme).toBeUndefined();
    expect(nodeEl.dataset.bcPaper).toBeUndefined();
    expect(nodeEl.dataset.bcPaperBorder).toBeUndefined();
  });

  it("marks a sketch board and clears the marker when another snapshot is loaded", () => {
    let data = { ...sample, bcTheme: "sketch" } as CanvasData;
    const wrapperEl = {
      dataset: {} as Record<string, string>,
      querySelectorAll: () => [] as any[]
    };
    const canvas = { getData: () => data, wrapperEl, nodes: new Map() };
    decorateCanvasTheme(canvas);
    expect(wrapperEl.dataset.bcTheme).toBe("sketch");
    data = sample;
    decorateCanvasTheme(canvas);
    expect(wrapperEl.dataset.bcTheme).toBeUndefined();
  });
});
