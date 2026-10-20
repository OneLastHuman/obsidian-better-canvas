import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class App {},
  Component: class Component { register() {} addChild() {} registerEvent() {} },
  ItemView: class ItemView {},
  Modal: class Modal {
    app: unknown;
    contentEl = { empty: vi.fn(), createEl: vi.fn() };
    constructor(app: unknown) { this.app = app; }
    open() { return this; }
    close() {}
  },
  Notice: vi.fn(),
  Platform: { isMobile: false },
  PluginSettingTab: class PluginSettingTab {
    app: unknown;
    plugin: unknown;
    containerEl = { empty: vi.fn(), createEl: vi.fn() };
    constructor(app: unknown, plugin: unknown) { this.app = app; this.plugin = plugin; }
    display() {}
    hide() {}
  },
  Setting: class Setting {
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
    addToggle() { return this; }
    addDropdown() { return this; }
    addButton() { return this; }
  },
  SuggestModal: class SuggestModal {
    app: unknown;
    constructor(app: unknown) { this.app = app; }
    setPlaceholder() {}
  },
  TFile: class TFile {},
  TFolder: class TFolder {},
  MarkdownRenderer: { renderMarkdown: vi.fn() },
  requestUrl: vi.fn()
}));

import BetterCanvasFeatures from "./feature-integrator";
import { resizeNodeToText } from "./enhancements";
import type { CanvasData } from "./canvas";

function createMockPlugin() {
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const registeredCleanups: Array<() => void> = [];

  const app = {
    workspace: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (!events.has(event)) events.set(event, []);
        events.get(event)!.push(handler);
        return { event, handler };
      }),
      trigger: (event: string, ...args: any[]) => {
        const handlers = events.get(event) ?? [];
        for (const handler of handlers) handler(...args);
      },
      getLeavesOfType: vi.fn(() => []),
      onLayoutReady: vi.fn()
    },
    vault: {
      on: vi.fn(() => ({})),
      getAbstractFileByPath: vi.fn(() => null)
    },
    metadataCache: {
      on: vi.fn(() => ({}))
    }
  };

  const plugin = {
    app,
    settings: {
      defaultNodeTextAlign: "center",
      defaultNodeWidth: 250,
      defaultNodeHeight: 140
    },
    register: vi.fn((fn: () => void) => registeredCleanups.push(fn)),
    registerEvent: vi.fn(),
    addSettingTab: vi.fn(),
    addCommand: vi.fn(),
    saveSettings: vi.fn(async () => {}),
    registerMarkdownPostProcessor: vi.fn()
  };

  return { plugin, app, events };
}

function makeCanvas(data: CanvasData): any {
  const canvas: any = {
    data: JSON.parse(JSON.stringify(data)),
    saved: 0,
    frames: 0,
    nodes: new Map<string, any>(),
    getData() {
      return this.data;
    },
    importData(next: CanvasData) {
      this.data = JSON.parse(JSON.stringify(next));
      syncNodes();
    },
    requestSave() {
      this.saved += 1;
    },
    requestFrame() {
      this.frames += 1;
    }
  };
  const syncNodes = (): void => {
    canvas.nodes.clear();
    for (const node of canvas.data.nodes) {
      canvas.nodes.set(node.id, {
        id: node.id,
        getData: () => canvas.data.nodes.find((item: any) => item.id === node.id),
        setData: (next: any) => {
          const current = canvas.data.nodes.find((item: any) => item.id === node.id);
          if (current) Object.assign(current, next);
        }
      });
    }
  };
  syncNodes();
  return canvas;
}

describe("Node auto-resize manual drag-resize override", () => {
  it("clears bcAutoResize when a node is manually resized via the corner handle", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();

    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 220, height: 100, text: "hello", bcAutoResize: true } as any
      ],
      edges: []
    });

    // Simulate the user dragging the bottom-right resize handle to change the node dimensions
    const resizedNode = { id: "node-1", width: 450, height: 300 };
    app.workspace.trigger("advanced-canvas:node-resized", canvas, resizedNode);

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.bcAutoResize).toBe(false);
  });

  it("preserves bcAutoResize when resize is triggered by automated text-fitting", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();

    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 220, height: 100, text: "hello", bcAutoResize: true } as any
      ],
      edges: []
    });

    // Mark that an automated resize is occurring for this node
    (features as any).autoResizingNodeIds.add("node-1");

    const resizedNode = { id: "node-1", width: 300, height: 150 };
    app.workspace.trigger("advanced-canvas:node-resized", canvas, resizedNode);

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.bcAutoResize).toBe(true);
    expect((features as any).autoResizingNodeIds.has("node-1")).toBe(false);
  });

  it("does not modify nodes that already have auto-resize disabled", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();

    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 220, height: 100, text: "hello", bcAutoResize: false } as any
      ],
      edges: []
    });

    const initialSaveCount = canvas.saved;
    const resizedNode = { id: "node-1", width: 450, height: 300 };
    app.workspace.trigger("advanced-canvas:node-resized", canvas, resizedNode);

    expect(canvas.saved).toBe(initialSaveCount);
    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.bcAutoResize).toBe(false);
  });
});

describe("fixed content-aware auto-resize", () => {
  const measure = (text: string): number => Array.from(text).length * 16;

  it("uses the 80 × 44 minimum and centers one line", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 220, height: 100, text: "字", bcAutoResize: true } as any
      ],
      edges: []
    });

    expect(resizeNodeToText(canvas, "node-1", measure)).toBe(true);

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.width).toBe(80);
    expect(updatedNode.height).toBe(44);
    expect(updatedNode.bcTextAlign).toBe("center");
    expect(updatedNode.styleAttributes.textAlign).toBe("center");
  });

  it("keeps 24 characters centered on one line and wraps 25 characters left-aligned", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "node-24", type: "text", x: 0, y: 0, width: 100, height: 100, text: "字".repeat(24), bcAutoResize: true } as any,
        { id: "node-25", type: "text", x: 0, y: 0, width: 100, height: 100, text: "字".repeat(25), bcAutoResize: true } as any
      ],
      edges: []
    });

    resizeNodeToText(canvas, "node-24", measure);
    resizeNodeToText(canvas, "node-25", measure);

    const node24 = canvas.data.nodes.find((n: any) => n.id === "node-24");
    const node25 = canvas.data.nodes.find((n: any) => n.id === "node-25");
    expect(node24).toMatchObject({ width: 432, height: 44, bcTextAlign: "center" });
    expect(node25).toMatchObject({ width: 440, height: 68, bcTextAlign: "left" });
  });

  it("caps very long text at 440 × 560 and preserves style metadata", () => {
    const canvas = makeCanvas({
      nodes: [
        {
          id: "node-1",
          type: "text",
          x: 0,
          y: 0,
          width: 220,
          height: 100,
          text: "字".repeat(600),
          bcAutoResize: true,
          bcShape: "diamond",
          customFlag: true,
          styleAttributes: { border: "dashed", custom: "keep" }
        } as any
      ],
      edges: []
    });

    resizeNodeToText(canvas, "node-1", measure);

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.width).toBe(440);
    expect(updatedNode.height).toBe(560);
    expect(updatedNode.bcTextAlign).toBe("left");
    expect(updatedNode.bcShape).toBe("diamond");
    expect(updatedNode.customFlag).toBe(true);
    expect(updatedNode.styleAttributes).toEqual({
      border: "dashed",
      custom: "keep",
      textAlign: "left"
    });
  });

  it("leaves blank text and non-text nodes untouched", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "blank", type: "text", x: 0, y: 0, width: 250, height: 60, text: "   ", bcAutoResize: true } as any,
        { id: "file", type: "file", x: 0, y: 0, width: 300, height: 200, file: "note.md" } as any
      ],
      edges: []
    });

    expect(resizeNodeToText(canvas, "blank", measure)).toBe(false);
    expect(resizeNodeToText(canvas, "file", measure)).toBe(false);
    expect(resizeNodeToText(canvas, "missing", measure)).toBe(false);

    const blank = canvas.data.nodes.find((n: any) => n.id === "blank");
    expect(blank.width).toBe(250);
    expect(blank.height).toBe(60);
    expect(blank.bcTextAlign).toBeUndefined();
  });

  it("does not write again when the node already has the final layout", () => {
    const canvas = makeCanvas({
      nodes: [
        {
          id: "node-1",
          type: "text",
          x: 0,
          y: 0,
          width: 80,
          height: 44,
          text: "字",
          bcAutoResize: true,
          bcTextAlign: "center",
          styleAttributes: { textAlign: "center" }
        } as any
      ],
      edges: []
    });

    expect(resizeNodeToText(canvas, "node-1", measure)).toBe(true);
    expect(canvas.saved).toBe(0);
  });
});
