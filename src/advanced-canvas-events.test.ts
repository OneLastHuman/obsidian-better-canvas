import { describe, expect, it } from "vitest";
import {
  AdvancedCanvasEventBridge,
  diffAdvancedCanvasSnapshots,
  type AdvancedCanvasSnapshot
} from "./advanced-canvas-events";
import type { CanvasData } from "./canvas";

function snapshot(overrides: Partial<AdvancedCanvasSnapshot> = {}): AdvancedCanvasSnapshot {
  const data: CanvasData = {
    nodes: [
      { id: "root", type: "text", x: 0, y: 0, width: 100, height: 60, text: "before" },
      { id: "remove-me", type: "text", x: 0, y: 100, width: 100, height: 60, text: "gone" }
    ],
    edges: [
      { id: "old-edge", fromNode: "root", fromSide: "right", toNode: "remove-me", toSide: "left" },
      { id: "remove-edge", fromNode: "remove-me", fromSide: "right", toNode: "root", toSide: "left" }
    ]
  };
  return {
    data,
    selectedIds: [],
    selectedElements: [],
    viewport: { zoom: 0, x: 0, y: 0 },
    readOnly: false,
    editingNodeIds: [],
    metadata: { frontmatter: { title: "old" } },
    ...overrides
  };
}

describe("Advanced Canvas event snapshot diff", () => {
  it("detects node adds/removals, moves, resizes, text changes and edge mutations", () => {
    const previous = snapshot();
    const next = snapshot({
      data: {
        nodes: [
          { id: "root", type: "text", x: 10, y: 0, width: 120, height: 70, text: "after" },
          { id: "new-node", type: "text", x: 250, y: 0, width: 100, height: 60, text: "new" }
        ],
        edges: [
          { id: "old-edge", fromNode: "root", fromSide: "bottom", toNode: "remove-me", toSide: "left" },
          { id: "new-edge", fromNode: "root", fromSide: "right", toNode: "new-node", toSide: "left" }
        ]
      }
    });
    const diff = diffAdvancedCanvasSnapshots(previous, next);
    expect(diff.addedNodes).toEqual(["new-node"]);
    expect(diff.removedNodes).toEqual(["remove-me"]);
    expect(diff.changedNodes).toContain("root");
    expect(diff.movedNodes).toEqual(["root"]);
    expect(diff.resizedNodes).toEqual(["root"]);
    expect(diff.changedNodeTexts).toEqual(["root"]);
    expect(diff.addedEdges).toEqual(["new-edge"]);
    expect(diff.removedEdges).toEqual(["remove-edge"]);
    expect(diff.changedEdges).toEqual(["old-edge"]);
  });

  it("detects selection, viewport, edit-state, read-only, and metadata transitions", () => {
    const previous = snapshot();
    const next = snapshot({
      selectedIds: ["root"],
      selectedElements: [{ id: "root" }],
      viewport: { zoom: 1, x: -24, y: 12 },
      readOnly: true,
      editingNodeIds: ["root"],
      metadata: { frontmatter: { title: "new" } }
    });
    const diff = diffAdvancedCanvasSnapshots(previous, next);
    expect(diff.selectionChanged).toBe(true);
    expect(diff.viewportChanged).toBe(true);
    expect(diff.readOnlyChanged).toBe(true);
    expect(diff.metadataChanged).toBe(true);
    expect(diff.changedEditingNodes).toEqual(["root"]);
  });

  it("treats selection order as irrelevant and missing optional viewport values as stable", () => {
    const previous = snapshot({ selectedIds: ["a", "b"], viewport: {} });
    const next = snapshot({ selectedIds: ["b", "a", "a"], viewport: { zoom: Number.NaN } });
    const diff = diffAdvancedCanvasSnapshots(previous, next);
    expect(diff.selectionChanged).toBe(false);
    expect(diff.viewportChanged).toBe(false);
  });
});

class FakeEmitter {
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  emitted: Array<{ name: string; args: any[] }> = [];

  on(name: string, callback: (...args: any[]) => void): { name: string; callback: (...args: any[]) => void } {
    let list = this.handlers.get(name);
    if (!list) this.handlers.set(name, list = new Set());
    list.add(callback);
    return { name, callback };
  }

  offref(ref: { name: string; callback: (...args: any[]) => void }): void {
    this.handlers.get(ref.name)?.delete(ref.callback);
  }

  trigger(name: string, ...args: any[]): void {
    this.emitted.push({ name, args });
    for (const callback of this.handlers.get(name) ?? []) callback(...args);
  }

  count(name: string): number {
    return this.emitted.filter(item => item.name === name).length;
  }
}

class FakeContainer {
  private handlers = new Map<string, Set<(event: any) => void>>();

  addEventListener(name: string, callback: (event: any) => void): void {
    let list = this.handlers.get(name);
    if (!list) this.handlers.set(name, list = new Set());
    list.add(callback);
  }

  removeEventListener(name: string, callback: (event: any) => void): void {
    this.handlers.get(name)?.delete(callback);
  }

  dispatch(name: string, event: any = {}): void {
    for (const callback of this.handlers.get(name) ?? []) callback(event);
  }
}

function makeCanvas(data: CanvasData): any {
  const canvas: any = {
    data,
    selection: new Set(),
    nodes: new Map(),
    edges: new Map(),
    zoom: 0,
    tx: 0,
    ty: 0,
    getData() { return this.data; },
    importData(next: CanvasData) {
      this.data = next;
      this.nodes = new Map(next.nodes.map(node => [node.id, { ...node, isEditing: false }]));
      this.edges = new Map(next.edges.map(edge => [edge.id, { ...edge }]));
    },
    setData(next: CanvasData) {
      this.data = next;
      this.nodes = new Map(next.nodes.map(node => [node.id, { ...node, isEditing: false }]));
      this.edges = new Map(next.edges.map(edge => [edge.id, { ...edge }]));
    },
    requestSave() {}
  };
  canvas.importData(data);
  return canvas;
}

describe("Advanced Canvas event bridge", () => {
  it("publishes canvas lifecycle, data-load diffs, selection, viewport, save, and undo/redo events", () => {
    const workspace = new FakeEmitter() as any;
    workspace.getLeavesOfType = () => [{ view }];
    workspace.onLayoutReady = (callback: () => void) => { layoutReady = callback; };
    const vault = new FakeEmitter();
    const app = { workspace, vault };
    const cleanups: Array<() => void> = [];
    const plugin = { register: (callback: () => void) => cleanups.push(callback) };
    const container = new FakeContainer();
    const file = { path: "Boards/Test.canvas" };
    const canvas = makeCanvas({
      nodes: [{ id: "root", type: "text", x: 0, y: 0, width: 100, height: 60, text: "Root" }],
      edges: []
    });
    const view: any = { canvas, containerEl: container, file, getViewType: () => "canvas" };
    let layoutReady = () => {};
    const scheduled: Array<() => void> = [];
    const bridge = new AdvancedCanvasEventBridge(app, plugin, { scheduleFrame: callback => scheduled.push(callback) });

    bridge.start();
    expect(workspace.count("advanced-canvas:canvas-changed")).toBe(1);
    while (scheduled.length) scheduled.shift()!();

    canvas.importData({
      nodes: [
        { id: "root", type: "text", x: 0, y: 0, width: 100, height: 60, text: "Root" },
        { id: "child", type: "text", x: 220, y: 0, width: 100, height: 60, text: "Child" }
      ],
      edges: [{ id: "root-child", fromNode: "root", fromSide: "right", toNode: "child", toSide: "left" }]
    });
    expect(workspace.count("advanced-canvas:data-loaded:before")).toBe(1);
    expect(workspace.count("advanced-canvas:data-loaded:after")).toBe(1);
    while (scheduled.length) scheduled.shift()!();
    expect(workspace.count("advanced-canvas:node-created")).toBe(1);
    expect(workspace.count("advanced-canvas:edge-created")).toBe(1);

    canvas.selection = new Set([canvas.nodes.get("root")]);
    container.dispatch("pointerup");
    while (scheduled.length) scheduled.shift()!();
    expect(workspace.count("advanced-canvas:selection-changed")).toBe(1);

    canvas.zoom = 1;
    container.dispatch("wheel");
    while (scheduled.length) scheduled.shift()!();
    expect(workspace.count("advanced-canvas:viewport-changed:before")).toBe(1);
    expect(workspace.count("advanced-canvas:viewport-changed:after")).toBe(1);

    container.dispatch("keydown", { ctrlKey: true, key: "z", shiftKey: false });
    container.dispatch("keydown", { ctrlKey: true, key: "z", shiftKey: true });
    expect(workspace.count("advanced-canvas:undo")).toBe(1);
    expect(workspace.count("advanced-canvas:redo")).toBe(1);

    canvas.requestSave();
    expect(workspace.count("advanced-canvas:canvas-saved:before")).toBe(1);
    vault.trigger("modify", file);
    expect(workspace.count("advanced-canvas:canvas-saved:after")).toBe(1);

    bridge.stop();
    expect(workspace.count("advanced-canvas:canvas-view-unloaded:before")).toBe(1);
    expect(typeof canvas.importData).toBe("function");
    expect(cleanups).toHaveLength(1);
    cleanups.forEach(cleanup => cleanup());
  });

  it("forwards double-click cancellation requests to the DOM event", () => {
    const workspace = new FakeEmitter() as any;
    workspace.getLeavesOfType = () => [{ view }];
    workspace.onLayoutReady = () => {};
    const app = { workspace, vault: new FakeEmitter() };
    const plugin = { register() {} };
    const container = new FakeContainer();
    const canvas = makeCanvas({ nodes: [], edges: [] });
    const view: any = { canvas, containerEl: container, file: { path: "Empty.canvas" }, getViewType: () => "canvas" };
    const bridge = new AdvancedCanvasEventBridge(app, plugin, { scheduleFrame: callback => callback() });
    workspace.on("advanced-canvas:double-click", (_canvas: any, _event: any, preventDefault: { value: boolean }) => {
      preventDefault.value = true;
    });
    bridge.start();
    let prevented = false;
    container.dispatch("dblclick", { preventDefault: () => { prevented = true; }, stopPropagation() {} });
    expect(prevented).toBe(true);
    bridge.stop();
  });
});
