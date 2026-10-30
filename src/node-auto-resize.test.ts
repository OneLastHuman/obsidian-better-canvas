import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class App {},
  Plugin: class Plugin {},
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
import BetterCanvasPlugin from "./main";
import { resizeNodeToText } from "./enhancements";
import * as enhancements from "./enhancements";
import * as htmlPreview from "./html-preview";
import type { CanvasData } from "./canvas";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  return { plugin, app, events, registeredCleanups };
}

function makeCanvas(data: CanvasData): any {
  const canvas: any = {
    data: JSON.parse(JSON.stringify(data)),
    saved: 0,
    historySaved: 0,
    frames: 0,
    nodes: new Map<string, any>(),
    getData() {
      return this.data;
    },
    importData(next: CanvasData) {
      this.data = JSON.parse(JSON.stringify(next));
      syncNodes();
    },
    requestSave(saveHistory = true) {
      this.saved += 1;
      if (saveHistory) this.historySaved += 1;
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

describe("retired settings and features", () => {
  it("keeps old data inert and uses fixed creation sizes even with legacy dimensions", () => {
    const { plugin } = createMockPlugin();
    const legacy = {
      defaultNodeWidth: 900,
      defaultNodeHeight: 800,
      templates: [{ name: "Old", text: "Keep me" }],
      customColors: ["#123456"],
      customCss: "body { color: red; }",
      youtubeLanguage: "en"
    };
    Object.assign(plugin.settings, legacy);
    const features = new BetterCanvasFeatures(plugin);
    features.init();
    expect((features as any).makeDefaultTextNode("", 10, 20)).toMatchObject({
      x: 10, y: 20, width: 280, height: 140
    });
    expect(plugin.settings).toMatchObject(legacy);
    // No Canvas is open. Refresh must not inject the retired global styles.
    expect(() => (features as any).refresh()).not.toThrow();
    const ids = plugin.addCommand.mock.calls.map(([command]) => command.id);
    expect(ids).not.toContain("bc-ingest-youtube");
    expect(ids).toContain("bc-ingest-web");
    expect(ids).toContain("bc-gemini-youtube-video");
  });

  it("removes template commands while retaining creation and theme-independent style commands", () => {
    const plugin = new (BetterCanvasPlugin as any)();
    plugin.addCommand = vi.fn();
    plugin.registerCommands();
    const ids = plugin.addCommand.mock.calls.map(([command]: any[]) => command.id);
    expect(ids).not.toContain("save-node-template");
    expect(ids).not.toContain("insert-node-template");
    expect(ids).toContain("create-child-node");
    expect(ids).toContain("apply-css-style-preset");
  });

  it("creates a blank child with fixed dimensions without resizing its existing parent", () => {
    const plugin = new (BetterCanvasPlugin as any)();
    plugin.settings = { defaultNodeWidth: 900, defaultNodeHeight: 800, gapX: 100 };
    const parent = { id: "parent", type: "text", text: "Existing", x: 0, y: 0, width: 350, height: 210 };
    const canvas = makeCanvas({ nodes: [parent as any], edges: [] });
    plugin.selectedOrNotice = () => ({ canvas, node: parent });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    try {
      plugin.createChildNode();
      expect(canvas.data.nodes.find((node: any) => node.id === "parent")).toEqual(parent);
      expect(canvas.data.nodes.find((node: any) => node.id !== "parent")).toMatchObject({ width: 280, height: 140 });
      expect(canvas.data.edges).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

    (features as any).resizeTextNode(canvas, "node-1");
    const resizedNode = canvas.data.nodes[0];
    app.workspace.trigger("advanced-canvas:node-resized", canvas, resizedNode);

    const updatedNode = canvas.data.nodes.find((n: any) => n.id === "node-1");
    expect(updatedNode.bcAutoResize).toBe(true);
  });

  it("does not let a no-op layout swallow the next manual resize", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();
    const canvas = makeCanvas({
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 80, height: 44,
        text: "字", bcAutoResize: true, bcTextAlign: "center", styleAttributes: { textAlign: "center" } } as any],
      edges: []
    });
    (features as any).resizeTextNode(canvas, "node-1");
    expect(canvas.saved).toBe(0);
    Object.assign(canvas.data.nodes[0], { width: 300, height: 200 });
    app.workspace.trigger("advanced-canvas:node-resized", canvas, canvas.data.nodes[0]);
    expect(canvas.data.nodes[0].bcAutoResize).toBe(false);
  });

  it("matches automatic sizes per Canvas and rejects a different subsequent manual size", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();
    const data: CanvasData = {
      nodes: [{ id: "same-id", type: "text", x: 0, y: 0, width: 220, height: 100, text: "字", bcAutoResize: true } as any],
      edges: []
    };
    const first = makeCanvas(data);
    const second = makeCanvas(data);
    (features as any).resizeTextNode(first, "same-id");
    Object.assign(second.data.nodes[0], { width: 300, height: 200 });
    app.workspace.trigger("advanced-canvas:node-resized", second, second.data.nodes[0]);
    expect(second.data.nodes[0].bcAutoResize).toBe(false);
    Object.assign(first.data.nodes[0], { width: 350, height: 240 });
    app.workspace.trigger("advanced-canvas:node-resized", first, first.data.nodes[0]);
    expect(first.data.nodes[0].bcAutoResize).toBe(false);
  });

  it("preserves automatic sizing through undo/imported geometry and still recognizes the next manual drag", () => {
    const { plugin, app } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    features.init();
    const canvas = makeCanvas({
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 80, height: 44,
        text: "字", bcAutoResize: true, bcTextAlign: "center", styleAttributes: { textAlign: "center" } } as any],
      edges: []
    });
    const restored = structuredClone(canvas.data);
    Object.assign(restored.nodes[0], { width: 280, height: 140 });
    app.workspace.trigger("advanced-canvas:data-loaded:before", canvas, restored);
    canvas.importData(restored);
    app.workspace.trigger("advanced-canvas:data-loaded:after", canvas, restored);
    app.workspace.trigger("advanced-canvas:node-resized", canvas, canvas.nodes.get("node-1"));
    expect(canvas.data.nodes[0].bcAutoResize).toBe(true);
    expect(canvas.saved).toBe(0);
    Object.assign(canvas.data.nodes[0], { width: 350, height: 200 });
    app.workspace.trigger("advanced-canvas:node-resized", canvas, canvas.nodes.get("node-1"));
    expect(canvas.data.nodes[0].bcAutoResize).toBe(false);
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

describe("HTML preview shutdown integration", () => {
  it("does not restart previews from a queued Canvas frame after plugin unload", () => {
    const handlers = new Map<string, () => void>();
    class Element {
      addEventListener(name: string, callback: () => void) { handlers.set(name, callback); }
      removeEventListener(name: string) { handlers.delete(name); }
    }
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }
    });
    const context = createMockPlugin();
    const features = new BetterCanvasFeatures(context.plugin);
    features.init();
    const canvas = makeCanvas({ nodes: [], edges: [] });
    vi.spyOn(enhancements, "decorateCanvas").mockImplementation(() => {});
    const syncHtml = vi.spyOn(htmlPreview, "syncHtmlPreviews").mockImplementation(() => {});
    vi.spyOn(features as any, "applyZoomBreakpoints").mockImplementation(() => {});
    vi.spyOn(features as any, "applySelectionEdgeHighlight").mockImplementation(() => {});
    (features as any).bindCanvasRouteRefresh({ canvas, containerEl: new Element() });
    handlers.get("wheel")!();
    expect(frames).toHaveLength(1);
    context.registeredCleanups.forEach(cleanup => cleanup());
    context.app.workspace.getLeavesOfType.mockClear();
    frames.forEach(callback => callback(0));
    (features as any).decorate(canvas);
    (features as any).refresh();
    expect(syncHtml).not.toHaveBeenCalled();
    expect(context.app.workspace.getLeavesOfType).not.toHaveBeenCalled();
  });
});

describe("theme-aware auto-resize coordination", () => {
  function setup() {
    vi.useFakeTimers();
    const observers: Array<{ callback: MutationCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
    class Element {
      classList = { contains: vi.fn(() => false), remove: vi.fn() };
      preview: Element | null = null;
      ownerDocument: any;
      querySelector(selector: string) { return selector === ".markdown-preview-view" ? this.preview : null; }
      closest(selector: string) { return selector === ".markdown-preview-view" && this === this.preview ? this : null; }
    }
    const fontListeners = new Map<string, () => void>();
    const fonts = {
      addEventListener: vi.fn((event: string, callback: () => void) => fontListeners.set(event, callback)),
      removeEventListener: vi.fn((event: string) => fontListeners.delete(event))
    };
    vi.stubGlobal("HTMLElement", Element);
    vi.stubGlobal("MutationObserver", class {
      callback: MutationCallback;
      disconnect = vi.fn();
      constructor(callback: MutationCallback) { this.callback = callback; observers.push(this); }
      observe() {}
    });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const context = createMockPlugin();
    const features = new BetterCanvasFeatures(context.plugin);
    features.init();
    const canvas = makeCanvas({
      bcTheme: "default",
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 80, height: 44,
        text: "字", bcAutoResize: true, bcTextAlign: "center", styleAttributes: { textAlign: "center" } } as any],
      edges: []
    });
    const container = new Element();
    container.ownerDocument = { fonts };
    const nodeEl = new Element();
    nodeEl.preview = new Element();
    nodeEl.preview.preview = nodeEl.preview;
    canvas.nodes.get("node-1").nodeEl = nodeEl;
    const view = { canvas, containerEl: container };
    context.app.workspace.getLeavesOfType.mockReturnValue([{ view }] as never);
    const resize = vi.spyOn(enhancements, "resizeNodeToText").mockReturnValue(true);
    const syncHtml = vi.spyOn(htmlPreview, "syncHtmlPreviews");
    return { ...context, features, canvas, container, nodeEl, view, observers, fontListeners, fonts, resize, syncHtml };
  }

  it("coalesces theme changes and reacts to preset, CSS and font completion", () => {
    const { app, canvas, resize, fontListeners } = setup();
    app.workspace.trigger("better-canvas:theme-changed");
    app.workspace.trigger("better-canvas:theme-changed");
    expect(resize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenLastCalledWith(canvas, "node-1", undefined, false);
    canvas.data.nodes[0].bcSoftNotesPreset = "concept";
    app.workspace.trigger("advanced-canvas:data-loaded:after", canvas);
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(2);
    app.workspace.trigger("css-change");
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(3);
    fontListeners.get("loadingdone")?.();
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(4);
  });

  it("does not remeasure for its own inline style writes and unchanged node events", () => {
    const { app, canvas, observers, resize, nodeEl, syncHtml } = setup();
    app.workspace.trigger("better-canvas:theme-changed");
    vi.advanceTimersByTime(220);
    const observer = observers[0];
    observer.callback([{ type: "attributes", attributeName: "style", target: nodeEl } as unknown as MutationRecord], {} as MutationObserver);
    app.workspace.trigger("advanced-canvas:node-changed", canvas, canvas.nodes.get("node-1"));
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(syncHtml).toHaveBeenCalledTimes(1);
    observer.callback([{ type: "childList", target: nodeEl.preview } as unknown as MutationRecord], {} as MutationObserver);
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("clears automatic layout styles when undo restores a disabled node", () => {
    const { app, canvas, nodeEl, resize } = setup();
    const dataset = { bcAutoResize: "true", bcAutoShape: "true" } as Record<string, string>;
    const removeProperty = vi.fn();
    Object.assign(nodeEl, { dataset, style: { removeProperty } });
    canvas.data.nodes[0].bcAutoResize = false;

    app.workspace.trigger("advanced-canvas:data-loaded:after", canvas);
    vi.advanceTimersByTime(220);

    expect(dataset.bcAutoResize).toBeUndefined();
    expect(dataset.bcAutoShape).toBeUndefined();
    expect(removeProperty).toHaveBeenCalledWith("--bc-auto-content-padding");
    expect(resize).not.toHaveBeenCalled();
    expect(canvas.saved).toBe(0);
  });

  it.each(["readonly", "readOnly", "class"])("does not write to %s canvases", mode => {
    const { app, canvas, resize } = setup();
    if (mode === "class") canvas.wrapperEl = { classList: { contains: () => true } };
    else canvas[mode] = true;
    app.workspace.trigger("better-canvas:theme-changed");
    vi.advanceTimersByTime(220);
    expect(resize).not.toHaveBeenCalled();
    expect(canvas.saved).toBe(0);
  });

  it("waits for editing and dragging to finish and respects per-node opt-out", () => {
    const { app, canvas, resize } = setup();
    const internal = canvas.nodes.get("node-1");
    internal.isEditing = true;
    app.workspace.trigger("better-canvas:theme-changed");
    vi.advanceTimersByTime(220);
    expect(resize).not.toHaveBeenCalled();
    internal.isEditing = false;
    app.workspace.trigger("advanced-canvas:node-editing-state-changed", canvas, internal, false);
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(1);
    app.workspace.trigger("advanced-canvas:dragging-state-changed", canvas, true);
    app.workspace.trigger("css-change");
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(1);
    app.workspace.trigger("advanced-canvas:dragging-state-changed", canvas, false);
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(2);
    canvas.data.nodes[0].bcAutoResize = false;
    app.workspace.trigger("better-canvas:theme-changed");
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(2);
    canvas.data.nodes[0].bcAutoResize = true;
    canvas.data.nodes[0].text = "  ";
    app.workspace.trigger("better-canvas:theme-changed");
    vi.advanceTimersByTime(220);
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("cancels pending layout and disconnects the observer when its view closes", () => {
    const { app, view, resize, observers } = setup();
    app.workspace.trigger("better-canvas:theme-changed");
    app.workspace.trigger("advanced-canvas:canvas-view-unloaded:before", view);
    vi.advanceTimersByTime(220);
    expect(resize).not.toHaveBeenCalled();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("cleans observers, font listeners and pending timers when unloaded", () => {
    const { app, registeredCleanups, observers, resize, fontListeners } = setup();
    app.workspace.trigger("better-canvas:theme-changed");
    registeredCleanups.forEach(cleanup => cleanup());
    vi.advanceTimersByTime(220);
    expect(resize).not.toHaveBeenCalled();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(fontListeners.size).toBe(0);
  });
});

describe("fixed content-aware auto-resize", () => {
  const measure = (text: string): number => Array.from(text).length * 16;

  it.each(["internal", "importData"])("saves background geometry without adding history through %s", path => {
    const canvas = makeCanvas({
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 280, height: 140, text: "字", bcAutoResize: true } as any],
      edges: []
    });
    if (path === "importData") delete canvas.nodes.get("node-1").setData;
    expect(resizeNodeToText(canvas, "node-1", measure, false)).toBe(true);
    expect(canvas.data.nodes[0]).toMatchObject({ width: 80, height: 44 });
    expect(canvas.saved).toBe(1);
    expect(canvas.historySaved).toBe(0);
  });

  it("keeps explicit resize commands undoable by default", () => {
    const { plugin } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    const canvas = makeCanvas({
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 280, height: 140, text: "字", bcAutoResize: true } as any],
      edges: []
    });
    expect((features as any).resizeTextNode(canvas, "node-1")).toBe(true);
    expect(canvas.saved).toBe(1);
    expect(canvas.historySaved).toBe(1);
  });

  it("merges background geometry into its existing undo step", () => {
    const { plugin } = createMockPlugin();
    const features = new BetterCanvasFeatures(plugin);
    const canvas = makeCanvas({
      bcTheme: "default",
      nodes: [{ id: "node-1", type: "text", x: 0, y: 0, width: 280, height: 140, text: "字", bcAutoResize: true } as any],
      edges: []
    });
    canvas.history = { current: 0, data: [structuredClone(canvas.data)] };

    expect((features as any).resizeTextNode(canvas, "node-1", false)).toBe(true);

    expect(canvas.history.data).toHaveLength(1);
    expect(canvas.history.data[0].nodes[0]).toEqual(canvas.data.nodes[0]);
    expect(canvas.historySaved).toBe(0);
  });

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

  it("sets the preview sizer to the current text height", () => {
    const canvas = makeCanvas({
      nodes: [
        { id: "node-1", type: "text", x: 0, y: 0, width: 220, height: 100, text: "字".repeat(29), bcAutoResize: true } as any
      ],
      edges: []
    });
    const sizer = {
      style: { minHeight: "71px", height: "71px" } as Record<string, string>,
      setCssStyles(styles: Record<string, string>) { Object.assign(this.style, styles); }
    };
    const preview: any = {
      scrollTop: 12,
      querySelector: (selector: string) => selector === ".markdown-preview-sizer" ? sizer : null
    };
    (canvas.nodes.get("node-1") as any).nodeEl = {
      querySelector: (selector: string) => selector === ".markdown-preview-view" ? preview : null
    };

    expect(resizeNodeToText(canvas, "node-1", measure)).toBe(true);
    expect(sizer.style.minHeight).toBe("48px");
    expect(sizer.style.height).toBe("auto");
    expect(preview.scrollTop).toBe(0);
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

    const sizer = {
      style: { minHeight: "71px", height: "71px" } as Record<string, string>,
      setCssStyles(styles: Record<string, string>) { Object.assign(this.style, styles); }
    };
    const preview: any = {
      scrollTop: 12,
      querySelector: (selector: string) => selector === ".markdown-preview-sizer" ? sizer : null
    };
    (canvas.nodes.get("node-1") as any).nodeEl = {
      querySelector: (selector: string) => selector === ".markdown-preview-view" ? preview : null
    };

    expect(resizeNodeToText(canvas, "node-1", measure)).toBe(true);
    expect(canvas.saved).toBe(0);
    expect(sizer.style.minHeight).toBe("24px");
    expect(preview.scrollTop).toBe(0);
  });
});
