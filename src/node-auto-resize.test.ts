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

describe("auto-resize respects configured default node size", () => {
  it("never shrinks an auto-resized node below the configured defaults", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 250, height: 140, text: "hello", bcAutoResize: true } as any
      ],
      edges: []
    });

    resizeNodeToText(canvas, "node-1", { width: 250, height: 140 });

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.width).toBe(250);
    expect(updatedNode.height).toBe(140);
  });

  it("grows an auto-resized node past the configured defaults when text needs room", () => {
    const longText = "a very long single line of text that clearly exceeds the configured default width";
    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 250, height: 140, text: longText, bcAutoResize: true } as any
      ],
      edges: []
    });

    resizeNodeToText(canvas, "node-1", { width: 250, height: 140 });

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.width).toBeGreaterThan(250);
    expect(updatedNode.height).toBeGreaterThanOrEqual(140);
  });

  it("falls back to the previous minimums when no configured size is passed", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 250, height: 140, text: "hello" } as any
      ],
      edges: []
    });

    resizeNodeToText(canvas, "node-1");

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.width).toBe(220);
    expect(updatedNode.height).toBe(100);
  });
});
