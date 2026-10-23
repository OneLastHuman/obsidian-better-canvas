import { describe, expect, it } from "vitest";
import { applyScrapbookPreset, resolveCanvasTheme, withCanvasTheme, setCanvasTheme, decorateCanvasTheme, mergeAutoResizeIntoCurrentHistory, mergeFloatingSidesIntoCurrentHistory } from "./canvas-theme";
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

describe("automatic layout in Canvas style history", () => {
  function historyCanvas(initialData: CanvasData = sample) {
    const initial = structuredClone(initialData);
    initial.nodes[0].bcAutoResize = true;
    return {
      data: structuredClone(initial),
      history: { data: [initial], current: 0 },
      getData() { return structuredClone(this.data); },
      requestSave() {},
      pushHistory(data: CanvasData) {
        this.history.data.splice(this.history.current + 1, Infinity, structuredClone(data));
        this.history.current = this.history.data.length - 1;
      },
      undo() {
        this.history.current--;
        this.data = structuredClone(this.history.data[this.history.current]);
      },
      redo() {
        this.history.current++;
        this.data = structuredClone(this.history.data[this.history.current]);
      }
    };
  }

  it("undoes two theme changes in two steps after each automatic layout", () => {
    const canvas = historyCanvas();
    setCanvasTheme(canvas, "rounded-map");
    Object.assign(canvas.data.nodes[0], {
      width: 198, height: 62, bcTextAlign: "center",
      styleAttributes: { border: "dashed", custom: "keep", textAlign: "center" }
    });
    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(true);
    setCanvasTheme(canvas, "research");
    Object.assign(canvas.data.nodes[0], {
      width: 260, height: 120, bcTextAlign: "left",
      styleAttributes: { border: "dashed", custom: "keep", textAlign: "left" }
    });
    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(true);

    expect(canvas.history.data).toHaveLength(3);
    canvas.undo();
    expect(resolveCanvasTheme(canvas.data)).toBe("rounded-map");
    expect(canvas.data.nodes[0]).toMatchObject({ width: 198, height: 62, bcTextAlign: "center" });
    canvas.undo();
    expect(resolveCanvasTheme(canvas.data)).toBe("default");
    canvas.redo();
    canvas.redo();
    expect(resolveCanvasTheme(canvas.data)).toBe("research");
    expect(canvas.data.nodes[0]).toMatchObject({ width: 260, height: 120, bcTextAlign: "left" });
  });

  it.each(["Keep me", ""])("keeps one theme change to one undo step when native serialization reorders %j", text => {
    const canvas = historyCanvas();
    canvas.data.nodes[0].text = text;
    canvas.history.data[0].nodes[0].text = text;
    canvas.getData = () => ({
      ...structuredClone(canvas.data),
      nodes: canvas.data.nodes.map(({ x, y, width, height, ...content }) => ({
        ...structuredClone(content), x, y, width, height
      }))
    });

    expect(setCanvasTheme(canvas, "rounded-map")).toBe(true);
    expect(canvas.history.data).toHaveLength(2);
    expect(canvas.history.current).toBe(1);
    canvas.undo();
    expect(resolveCanvasTheme(canvas.data)).toBe("default");
    expect(canvas.data.nodes[0].text).toBe(text);
  });

  it.each([
    ["text", { text: "A pending text edit" }],
    ["shape", { bcShape: "pill" }],
    ["style attributes", { styleAttributes: { border: "solid", custom: "keep", textAlign: "center" } }]
  ])("does not merge a layout based on pending %s into an older undo state", (_name, edit) => {
    const canvas = historyCanvas();
    setCanvasTheme(canvas, "rounded-map");
    const before = structuredClone(canvas.history);
    Object.assign(canvas.data.nodes[0], edit, { width: 198, height: 62, bcTextAlign: "center" });

    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(false);
    expect(canvas.history).toEqual(before);
  });

  it("does not merge a layout into a different theme's undo state", () => {
    const canvas = historyCanvas();
    const before = structuredClone(canvas.history);
    canvas.data.bcTheme = "research";
    Object.assign(canvas.data.nodes[0], { width: 198, height: 62 });

    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(false);
    expect(canvas.history).toEqual(before);
  });

  it("accepts identical style inputs serialized in a different order", () => {
    const canvas = historyCanvas();
    Object.assign(canvas.data.nodes[0], {
      width: 198, height: 62, bcTextAlign: "center",
      styleAttributes: { custom: "keep", textAlign: "center", border: "dashed" }
    });

    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(true);
    expect(canvas.history.data[0].nodes[0]).toMatchObject({
      width: 198, height: 62, styleAttributes: { border: "dashed", custom: "keep", textAlign: "center" }
    });
  });

  it("preserves redo and pending changes outside the resized node", () => {
    const canvas = historyCanvas();
    setCanvasTheme(canvas, "rounded-map");
    setCanvasTheme(canvas, "research");
    canvas.undo();
    const previous = canvas.history.data[0];
    const redo = canvas.history.data[2];
    canvas.data.custom = { keep: false, pending: true };
    canvas.data.nodes.push({ id: "pending", type: "text", text: "Not saved yet", x: 0, y: 0, width: 100, height: 100 });
    Object.assign(canvas.data.nodes[0], {
      width: 198, height: 62, bcTextAlign: "center",
      styleAttributes: { border: "dashed", custom: "keep", textAlign: "center" }
    });
    let pendingSaveCancelled = false;
    Object.assign(canvas, { requestPushHistory: { cancel() { pendingSaveCancelled = true; } } });

    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(true);
    expect(canvas.history.current).toBe(1);
    expect(canvas.history.data).toHaveLength(3);
    expect(canvas.history.data[0]).toBe(previous);
    expect(canvas.history.data[2]).toBe(redo);
    expect(canvas.history.data[1].custom).toEqual({ keep: true });
    expect(canvas.history.data[1].nodes).toHaveLength(1);
    expect(canvas.history.data[1].edges).toEqual(sample.edges);
    expect(pendingSaveCancelled).toBe(false);
    expect(canvas.data.nodes).toHaveLength(2);
    canvas.redo();
    expect(resolveCanvasTheme(canvas.data)).toBe("research");
  });

  function floatingHistoryCanvas() {
    return historyCanvas({
      custom: { keep: true },
      nodes: [
        { id: "a", type: "text", text: "A", x: 0, y: 0, width: 280, height: 140 },
        { id: "b", type: "text", text: "B", x: 360, y: 200, width: 280, height: 140 }
      ],
      edges: [{
        id: "floating", fromNode: "a", toNode: "b", fromSide: "bottom", toSide: "top",
        fromFloating: true, toFloating: true, label: "Keep label", custom: { keep: true }
      }]
    });
  }

  it("keeps derived floating sides in the same undo step as automatic node geometry", () => {
    const canvas = floatingHistoryCanvas();
    setCanvasTheme(canvas, "rounded-map");
    Object.assign(canvas.data.nodes[0], {
      width: 80, height: 44, bcTextAlign: "center", styleAttributes: { textAlign: "center" }
    });
    expect(mergeAutoResizeIntoCurrentHistory(canvas, "a")).toBe(true);
    const beforeEdges = structuredClone(canvas.data.edges);
    Object.assign(canvas.data.edges[0], { fromSide: "right", toSide: "left" });

    expect(mergeFloatingSidesIntoCurrentHistory(canvas, beforeEdges)).toBe(true);
    expect(canvas.history.data[1].edges[0]).toEqual({
      ...beforeEdges[0], fromSide: "right", toSide: "left"
    });
    setCanvasTheme(canvas, "research");
    expect(canvas.history.data).toHaveLength(3);
    canvas.undo();
    expect(canvas.data.nodes[0]).toMatchObject({ width: 80, height: 44 });
    expect(canvas.data.edges[0]).toMatchObject({ fromSide: "right", toSide: "left" });
    canvas.undo();
    expect(resolveCanvasTheme(canvas.data)).toBe("default");
    expect(canvas.data.edges[0]).toMatchObject({ fromSide: "bottom", toSide: "top" });
  });

  it.each(["before capture", "after capture", "manual side"])("does not merge pending edge changes made %s", phase => {
    const canvas = floatingHistoryCanvas();
    if (phase === "manual side") canvas.data.edges[0].toFloating = false;
    setCanvasTheme(canvas, "rounded-map");
    const history = structuredClone(canvas.history);
    if (phase === "before capture") canvas.data.edges[0].label = "Pending label";
    const beforeEdges = structuredClone(canvas.data.edges);
    canvas.data.edges[0].fromSide = "right";
    if (phase === "after capture") canvas.data.edges[0].label = "Pending label";
    if (phase === "manual side") canvas.data.edges[0].toSide = "left";

    expect(mergeFloatingSidesIntoCurrentHistory(canvas, beforeEdges)).toBe(false);
    expect(canvas.history).toEqual(history);
  });

  it.each([
    ["geometry", { width: 80, height: 44 }],
    ["content", { text: "Pending endpoint text" }],
    ["position", { x: 200, y: 300 }]
  ])("does not merge sides derived from endpoint %s absent from the current undo state", (_name, change) => {
    const canvas = floatingHistoryCanvas();
    setCanvasTheme(canvas, "rounded-map");
    const history = structuredClone(canvas.history);
    Object.assign(canvas.data.nodes[0], change);
    const beforeEdges = structuredClone(canvas.data.edges);
    canvas.data.edges[0].fromSide = "right";

    expect(mergeFloatingSidesIntoCurrentHistory(canvas, beforeEdges)).toBe(false);
    expect(canvas.history).toEqual(history);
  });
});
