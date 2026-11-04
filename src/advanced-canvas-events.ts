import type { App, EventRef, Events, Plugin, TAbstractFile } from "obsidian";
import { normalizeCanvasData, type CanvasData } from "./canvas";
import { isCanvasViewRuntime, type CanvasRuntime, type CanvasViewRuntime } from "./canvas-runtime";

export type AdvancedCanvasEventName =
  | "advanced-canvas:settings-changed"
  | "advanced-canvas:canvas-changed"
  | "advanced-canvas:canvas-view-unloaded:before"
  | "advanced-canvas:canvas-metadata-changed"
  | "advanced-canvas:viewport-changed:before"
  | "advanced-canvas:viewport-changed:after"
  | "advanced-canvas:node-moved"
  | "advanced-canvas:node-resized"
  | "advanced-canvas:double-click"
  | "advanced-canvas:dragging-state-changed"
  | "advanced-canvas:node-created"
  | "advanced-canvas:edge-created"
  | "advanced-canvas:node-added"
  | "advanced-canvas:edge-added"
  | "advanced-canvas:node-changed"
  | "advanced-canvas:edge-changed"
  | "advanced-canvas:node-rendered"
  | "advanced-canvas:node-text-content-changed"
  | "advanced-canvas:node-removed"
  | "advanced-canvas:edge-removed"
  | "advanced-canvas:node-editing-state-changed"
  | "advanced-canvas:selection-changed"
  | "advanced-canvas:copy"
  | "advanced-canvas:popup-menu-created"
  | "advanced-canvas:node-interaction"
  | "advanced-canvas:undo"
  | "advanced-canvas:redo"
  | "advanced-canvas:readonly-changed"
  | "advanced-canvas:data-requested"
  | "advanced-canvas:data-loaded:before"
  | "advanced-canvas:data-loaded:after"
  | "advanced-canvas:canvas-saved:before"
  | "advanced-canvas:canvas-saved:after";

export interface CanvasViewportSnapshot {
  zoom?: number;
  x?: number;
  y?: number;
}

export interface AdvancedCanvasSnapshot {
  data: CanvasData;
  selectedIds: string[];
  selectedElements: unknown[];
  viewport: CanvasViewportSnapshot;
  readOnly: boolean;
  editingNodeIds: string[];
  metadata: unknown;
}

export interface AdvancedCanvasSnapshotDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  movedNodes: string[];
  resizedNodes: string[];
  changedNodeTexts: string[];
  addedEdges: string[];
  removedEdges: string[];
  changedEdges: string[];
  changedEditingNodes: string[];
  selectionChanged: boolean;
  viewportChanged: boolean;
  readOnlyChanged: boolean;
  metadataChanged: boolean;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function mapById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map(item => [item.id, item]));
}

function numberChanged(a: unknown, b: unknown): boolean {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) && !Number.isFinite(right)) return false;
  return left !== right;
}

function stringSet(values: readonly string[]): Set<string> {
  return new Set(values.filter(value => typeof value === "string"));
}

function arraysAsSetEqual(left: readonly string[], right: readonly string[]): boolean {
  const a = stringSet(left);
  const b = stringSet(right);
  return a.size === b.size && [...a].every(value => b.has(value));
}

function viewportEqual(left: CanvasViewportSnapshot, right: CanvasViewportSnapshot): boolean {
  return !numberChanged(left.zoom, right.zoom) &&
    !numberChanged(left.x, right.x) &&
    !numberChanged(left.y, right.y);
}

/** Pure state diff shared by the runtime bridge and regression tests. */
export function diffAdvancedCanvasSnapshots(
  previous: AdvancedCanvasSnapshot,
  next: AdvancedCanvasSnapshot
): AdvancedCanvasSnapshotDiff {
  const previousNodes = mapById(previous.data.nodes);
  const nextNodes = mapById(next.data.nodes);
  const previousEdges = mapById(previous.data.edges);
  const nextEdges = mapById(next.data.edges);

  const addedNodes: string[] = [];
  const removedNodes: string[] = [];
  const changedNodes: string[] = [];
  const movedNodes: string[] = [];
  const resizedNodes: string[] = [];
  const changedNodeTexts: string[] = [];
  const addedEdges: string[] = [];
  const removedEdges: string[] = [];
  const changedEdges: string[] = [];
  const changedEditingNodes = new Set<string>();

  for (const [id, node] of nextNodes) {
    const old = previousNodes.get(id);
    if (!old) {
      addedNodes.push(id);
      continue;
    }
    if (!jsonEqual(old, node)) changedNodes.push(id);
    if (numberChanged(old.x, node.x) || numberChanged(old.y, node.y)) movedNodes.push(id);
    if (numberChanged(old.width, node.width) || numberChanged(old.height, node.height)) resizedNodes.push(id);
    if (old.text !== node.text) changedNodeTexts.push(id);
  }
  for (const id of previousNodes.keys()) {
    if (!nextNodes.has(id)) removedNodes.push(id);
  }

  for (const [id, edge] of nextEdges) {
    const old = previousEdges.get(id);
    if (!old) addedEdges.push(id);
    else if (!jsonEqual(old, edge)) changedEdges.push(id);
  }
  for (const id of previousEdges.keys()) {
    if (!nextEdges.has(id)) removedEdges.push(id);
  }

  const previousEditing = stringSet(previous.editingNodeIds);
  const nextEditing = stringSet(next.editingNodeIds);
  for (const id of previousEditing) if (!nextEditing.has(id)) changedEditingNodes.add(id);
  for (const id of nextEditing) if (!previousEditing.has(id)) changedEditingNodes.add(id);

  return {
    addedNodes,
    removedNodes,
    changedNodes,
    movedNodes,
    resizedNodes,
    changedNodeTexts,
    addedEdges,
    removedEdges,
    changedEdges,
    changedEditingNodes: [...changedEditingNodes],
    selectionChanged: !arraysAsSetEqual(previous.selectedIds, next.selectedIds),
    viewportChanged: !viewportEqual(previous.viewport, next.viewport),
    readOnlyChanged: previous.readOnly !== next.readOnly,
    metadataChanged: !jsonEqual(previous.metadata, next.metadata)
  };
}

interface PatchRecord {
  restore: () => void;
}

function patchProperty<T, K extends keyof T>(target: T, key: K, wrapped: T[K]): PatchRecord {
  const original = target[key];
  target[key] = wrapped;
  return { restore: () => { if (target[key] === wrapped) target[key] = original; } };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    "then" in value && typeof value.then === "function";
}

interface BridgePlugin extends Pick<Plugin, "register"> {
  saveSettings?: (this: BridgePlugin, ...args: unknown[]) => unknown;
}

interface CanvasBridgeState {
  view: CanvasViewRuntime;
  canvas: CanvasRuntime;
  container: HTMLElement | null;
  snapshot: AdvancedCanvasSnapshot;
  baseGetData: CanvasRuntime["getData"];
  listeners: Array<() => void>;
  patches: PatchRecord[];
  renderedElements: Map<string, unknown>;
  hoveredNodeId: string;
  dragging: boolean;
  pendingViewportBefore: boolean;
  pendingSave: boolean;
  pendingKeyboardInput: boolean;
  frameQueued: boolean;
  dataLoadDepth: number;
  dispatchingDataRequest: boolean;
  knownNodeIds: Set<string>;
  knownEdgeIds: Set<string>;
  initialLoadSeen: boolean;
  filePath: string;
  observer?: MutationObserver;
}

export interface AdvancedCanvasEventBridgeOptions {
  scheduleFrame?: (callback: () => void) => unknown;
}

/**
 * Best-effort compatibility bridge for Advanced Canvas's custom workspace API.
 * It only observes the host Canvas and never alters Canvas JSON unless a
 * subscriber deliberately changes the data in a data-loaded:before callback.
 */
export class AdvancedCanvasEventBridge {
  private readonly app: App;
  private readonly plugin: BridgePlugin;
  private readonly scheduleFrame: (callback: () => void) => unknown;
  private states = new Map<CanvasViewRuntime, CanvasBridgeState>();
  private subscriptions: Array<{ emitter: Events; ref: EventRef }> = [];
  private settingsPatch: PatchRecord | null = null;
  private started = false;
  private stopped = false;

  constructor(app: App, plugin: BridgePlugin, options: AdvancedCanvasEventBridgeOptions = {}) {
    this.app = app;
    this.plugin = plugin;
    this.scheduleFrame = options.scheduleFrame ?? (callback => window.requestAnimationFrame(callback));
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const workspace = this.app?.workspace;
    if (typeof workspace?.on === "function") {
      this.subscribe(workspace, workspace.on("layout-change", () => this.scan()));
      this.subscribe(workspace, workspace.on("active-leaf-change", () => this.scan()));
    }
    const vault = this.app?.vault;
    if (typeof vault?.on === "function") {
      this.subscribe(vault, vault.on("modify", file => this.onVaultModify(file)));
    }
    workspace?.onLayoutReady?.(() => this.scan());
    this.patchSettingsSave();
    this.plugin?.register?.(() => this.stop());
    this.scan();
  }

  stop(): void {
    if (this.stopped) return;
    for (const state of [...this.states.values()]) this.detach(state);
    this.stopped = true;
    for (const item of this.subscriptions.splice(0)) {
      try {
        item.emitter?.offref?.(item.ref);
      } catch {
        // Different Obsidian builds expose slightly different event cleanup APIs.
      }
    }
    this.settingsPatch?.restore();
    this.settingsPatch = null;
    this.started = false;
  }

  private subscribe(emitter: Events, ref: EventRef): void {
    if (emitter && ref) this.subscriptions.push({ emitter, ref });
  }

  private emit = (name: AdvancedCanvasEventName, ...args: unknown[]): void => {
    if (this.stopped) return;
    try {
      this.app?.workspace?.trigger?.(name, ...args);
    } catch (error) {
      console.warn("Better Canvas event bridge listener failed:", name, error);
    }
  };

  private patchSettingsSave(): void {
    const target = this.plugin;
    if (!target || typeof target.saveSettings !== "function") return;
    const original = target.saveSettings;
    const emit = this.emit;
    const wrapped = function (this: BridgePlugin, ...args: unknown[]) {
      const result: unknown = original.apply(this, args);
      if (isPromiseLike(result)) {
        return result.then((value: unknown) => {
          emit("advanced-canvas:settings-changed");
          return value;
        });
      }
      emit("advanced-canvas:settings-changed");
      return result;
    };
    this.settingsPatch = patchProperty(target, "saveSettings", wrapped);
  }

  private scan(): void {
    if (this.stopped) return;
    const leaves = this.app?.workspace?.getLeavesOfType?.("canvas") ?? [];
    const currentViews = new Set<CanvasViewRuntime>();
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!isCanvasViewRuntime(view)) continue;
      const canvas = view.canvas;
      currentViews.add(view);
      const existing = this.states.get(view);
      if (existing && existing.canvas === canvas) {
        this.scheduleSnapshot(existing, false);
        continue;
      }
      if (existing) this.detach(existing);
      this.attach(view, canvas);
    }
    for (const [view, state] of [...this.states]) {
      if (!currentViews.has(view)) this.detach(state);
    }
  }

  private attach(view: CanvasViewRuntime, canvas: CanvasRuntime): void {
    const baseGetData = canvas.getData.bind(canvas);
    const snapshot = this.takeSnapshot({ view, canvas, baseGetData });
    const state: CanvasBridgeState = {
      view,
      canvas,
      container: view.containerEl ?? view.contentEl ?? null,
      baseGetData,
      snapshot,
      listeners: [],
      patches: [],
      renderedElements: new Map(),
      hoveredNodeId: "",
      dragging: false,
      pendingViewportBefore: false,
      pendingSave: false,
      pendingKeyboardInput: false,
      frameQueued: false,
      dataLoadDepth: 0,
      dispatchingDataRequest: false,
      filePath: view.file?.path ?? "",
      knownNodeIds: new Set(snapshot.data.nodes.map(node => node.id).filter(Boolean)),
      knownEdgeIds: new Set(snapshot.data.edges.map(edge => edge.id).filter(Boolean)),
      initialLoadSeen: false
    };
    // A canvas that already holds data was loaded before the bridge attached, so
    // its next import is a regular edit rather than the view's initial file load.
    state.initialLoadSeen = state.knownNodeIds.size > 0 || state.knownEdgeIds.size > 0;
    this.states.set(view, state);
    this.patchCanvasMethods(state);
    this.bindDomEvents(state);
    this.bindReadOnlyObserver(state);
    this.emit("advanced-canvas:canvas-changed", canvas);
    this.emitRenderedNodes(state);
  }

  private detach(state: CanvasBridgeState): void {
    this.emit("advanced-canvas:canvas-view-unloaded:before", state.view);
    for (const cleanup of state.listeners.splice(0)) {
      try { cleanup(); } catch { /* cleanup should never block unload */ }
    }
    try { state.observer?.disconnect?.(); } catch { /* optional observer */ }
    for (const patch of state.patches.splice(0).reverse()) patch.restore();
    this.states.delete(state.view);
  }

  private readData(state: Pick<CanvasBridgeState, "canvas" | "baseGetData">): CanvasData {
    try {
      return normalizeCanvasData(state.baseGetData.call(state.canvas));
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  private takeSnapshot(state: Pick<CanvasBridgeState, "view" | "canvas" | "baseGetData">): AdvancedCanvasSnapshot {
    const data = this.readData(state);
    const selectedElements = Array.from(state.canvas?.selection?.values?.() ?? []);
    const selectedIds = selectedElements
      .map(element => element.id ?? element.node?.id ?? element.getData?.()?.id)
      .filter((id: unknown): id is string => typeof id === "string");
    const viewport: CanvasViewportSnapshot = {};
    const zoom = Number(state.canvas?.zoom);
    const x = Number(state.canvas?.tx ?? state.canvas?.panX ?? state.canvas?.x);
    const y = Number(state.canvas?.ty ?? state.canvas?.panY ?? state.canvas?.y);
    if (Number.isFinite(zoom)) viewport.zoom = zoom;
    if (Number.isFinite(x)) viewport.x = x;
    if (Number.isFinite(y)) viewport.y = y;
    const editingNodeIds: string[] = [];
    for (const [id, node] of state.canvas?.nodes?.entries?.() ?? []) {
      if (node?.isEditing) editingNodeIds.push(String(id));
    }
    const metadata = state.canvas?.metadata?.frontmatter ??
      (state.view?.file ? { path: state.view.file.path, frontmatter: "frontmatter" in state.view.file ? state.view.file.frontmatter : undefined } : data.metadata);
    const readOnly = Boolean(
      state.canvas?.readOnly ||
      state.canvas?.readonly ||
      state.canvas?.wrapperEl?.classList?.contains?.("bc-readonly")
    );
    return {
      data,
      selectedIds,
      selectedElements,
      viewport,
      readOnly,
      editingNodeIds,
      metadata
    };
  }

  private scheduleSnapshot = (state: CanvasBridgeState, keyboardInput: boolean): void => {
    if (this.stopped || !this.states.has(state.view)) return;
    state.pendingKeyboardInput = state.pendingKeyboardInput || keyboardInput;
    if (state.frameQueued) return;
    state.frameQueued = true;
    this.scheduleFrame(() => {
      state.frameQueued = false;
      if (this.stopped || !this.states.has(state.view)) return;
      const usingKeyboard = state.pendingKeyboardInput;
      state.pendingKeyboardInput = false;
      this.processSnapshot(state, this.takeSnapshot(state), usingKeyboard);
    });
  };

  private processSnapshot(
    state: CanvasBridgeState,
    next: AdvancedCanvasSnapshot,
    usingKeyboard: boolean
  ): void {
    const canvas = state.canvas;
    const previous = state.snapshot;
    const changes = diffAdvancedCanvasSnapshots(previous, next);
    const previousNodes = mapById(previous.data.nodes);
    const nextNodes = mapById(next.data.nodes);
    const previousEdges = mapById(previous.data.edges);
    const nextEdges = mapById(next.data.edges);

    for (const id of changes.addedNodes) {
      if (state.knownNodeIds.has(id)) continue;
      state.knownNodeIds.add(id);
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id);
      this.emit("advanced-canvas:node-created", canvas, node);
      this.emit("advanced-canvas:node-added", canvas, node);
    }
    for (const id of changes.removedNodes) {
      this.emit("advanced-canvas:node-removed", canvas, previousNodes.get(id));
    }
    for (const id of changes.changedNodes) {
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id) ?? previousNodes.get(id);
      this.emit("advanced-canvas:node-changed", canvas, node);
    }
    for (const id of changes.movedNodes) {
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id);
      this.emit("advanced-canvas:node-moved", canvas, node, usingKeyboard);
    }
    for (const id of changes.resizedNodes) {
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id);
      this.emit("advanced-canvas:node-resized", canvas, node);
    }
    for (const id of changes.changedNodeTexts) {
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id);
      this.emit("advanced-canvas:node-text-content-changed", canvas, node, undefined);
    }
    for (const id of changes.addedEdges) {
      if (state.knownEdgeIds.has(id)) continue;
      state.knownEdgeIds.add(id);
      const edge = canvas.edges?.get?.(id) ?? nextEdges.get(id);
      this.emit("advanced-canvas:edge-created", canvas, edge);
      this.emit("advanced-canvas:edge-added", canvas, edge);
    }
    for (const id of changes.removedEdges) {
      this.emit("advanced-canvas:edge-removed", canvas, previousEdges.get(id));
    }
    for (const id of changes.changedEdges) {
      const edge = canvas.edges?.get?.(id) ?? nextEdges.get(id) ?? previousEdges.get(id);
      this.emit("advanced-canvas:edge-changed", canvas, edge);
    }
    for (const id of changes.changedEditingNodes) {
      const node = canvas.nodes?.get?.(id) ?? nextNodes.get(id) ?? previousNodes.get(id);
      this.emit("advanced-canvas:node-editing-state-changed", canvas, node, next.editingNodeIds.includes(id));
    }
    if (changes.selectionChanged) {
      const oldSelection = new Set(previous.selectedElements);
      const updateSelection = (update: () => void): void => { update(); };
      this.emit("advanced-canvas:selection-changed", canvas, oldSelection, updateSelection);
    }
    if (changes.viewportChanged) {
      if (!state.pendingViewportBefore) this.emit("advanced-canvas:viewport-changed:before", canvas);
      this.emit("advanced-canvas:viewport-changed:after", canvas);
    }
    state.pendingViewportBefore = false;
    if (changes.readOnlyChanged) {
      this.emit("advanced-canvas:readonly-changed", canvas, next.readOnly);
    }
    if (changes.metadataChanged) {
      this.emit("advanced-canvas:canvas-metadata-changed", canvas);
    }
    state.snapshot = next;
    this.emitRenderedNodes(state);
  }

  private emitRenderedNodes(state: CanvasBridgeState): void {
    const canvas = state.canvas;
    const data = this.readData(state);
    for (const item of data.nodes) {
      const node = canvas.nodes?.get?.(item.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      if (!element) continue;
      const previous = state.renderedElements.get(item.id);
      if (previous === element) continue;
      state.renderedElements.set(item.id, element);
      this.emit("advanced-canvas:node-rendered", canvas, node ?? item);
    }
    for (const id of [...state.renderedElements.keys()]) {
      if (!canvas.nodes?.has?.(id)) state.renderedElements.delete(id);
    }
  }

  private listen<K extends keyof HTMLElementEventMap>(state: CanvasBridgeState, name: K, callback: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void {
    const container = state.container;
    if (!container?.addEventListener) return;
    container.addEventListener(name, callback, options);
    state.listeners.push(() => container.removeEventListener(name, callback, typeof options === "object" ? options.capture : options));
  }

  private bindDomEvents(state: CanvasBridgeState): void {
    this.listen(state, "pointerdown", () => {
      if (!state.pendingViewportBefore) {
        state.pendingViewportBefore = true;
        this.emit("advanced-canvas:viewport-changed:before", state.canvas);
      }
      if (!state.dragging) {
        state.dragging = true;
        this.emit("advanced-canvas:dragging-state-changed", state.canvas, true);
      }
    }, true);
    const finishPointer = () => {
      if (state.dragging) {
        state.dragging = false;
        this.emit("advanced-canvas:dragging-state-changed", state.canvas, false);
      }
      this.scheduleSnapshot(state, false);
    };
    this.listen(state, "pointerup", finishPointer, true);
    this.listen(state, "pointercancel", finishPointer, true);
    this.listen(state, "keyup", event => {
      this.scheduleSnapshot(state, true);
      if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === "c") {
        const data = this.readData(state);
        const selected = new Set(state.snapshot.selectedIds);
        const selectedNodes = data.nodes.filter(node => selected.has(node.id));
        const selectedIds = new Set(selectedNodes.map(node => node.id));
        const selectedEdges = data.edges.filter(edge => selected.has(edge.id) ||
          (selectedIds.has(edge.fromNode) && selectedIds.has(edge.toNode)));
        this.emit("advanced-canvas:copy", state.canvas, { nodes: selectedNodes, edges: selectedEdges });
      }
    }, true);
    this.listen(state, "keydown", event => {
      if (!(event.ctrlKey || event.metaKey) || event.key?.toLowerCase() !== "z") return;
      if (event.shiftKey) this.emit("advanced-canvas:redo", state.canvas);
      else this.emit("advanced-canvas:undo", state.canvas);
    }, true);
    this.listen(state, "wheel", () => {
      if (!state.pendingViewportBefore) {
        state.pendingViewportBefore = true;
        this.emit("advanced-canvas:viewport-changed:before", state.canvas);
      }
      this.scheduleSnapshot(state, false);
    }, { capture: true, passive: true });
    this.listen(state, "input", () => this.scheduleSnapshot(state, false), true);
    this.listen(state, "dblclick", event => {
      const preventDefault = { value: false };
      this.emit("advanced-canvas:double-click", state.canvas, event, preventDefault);
      if (preventDefault.value) {
        event.preventDefault?.();
        event.stopPropagation?.();
      }
    }, true);
    this.listen(state, "contextmenu", () => this.emit("advanced-canvas:popup-menu-created", state.canvas), true);
    this.listen(state, "pointerover", event => {
      const id = this.nodeIdFromTarget(state, event.target);
      if (!id || id === state.hoveredNodeId) return;
      state.hoveredNodeId = id;
      const node = state.canvas.nodes?.get?.(id);
      if (node) this.emit("advanced-canvas:node-interaction", state.canvas, node);
    }, true);
  }

  private nodeIdFromTarget(state: CanvasBridgeState, target: EventTarget | null): string {
    const data = this.readData(state);
    for (const item of data.nodes) {
      const node = state.canvas.nodes?.get?.(item.id);
      const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
      const ownerWindow = element?.ownerDocument.defaultView;
      if (element && (element === target || (ownerWindow && target instanceof ownerWindow.Node && element.contains(target)))) return item.id;
    }
    return "";
  }


  private bindReadOnlyObserver(state: CanvasBridgeState): void {
    const wrapper = state.canvas?.wrapperEl;
    const Observer = wrapper?.ownerDocument?.defaultView?.MutationObserver ??
      (typeof MutationObserver !== "undefined" ? MutationObserver : undefined);
    if (!wrapper || !Observer) return;
    state.observer = new Observer(() => this.scheduleSnapshot(state, false));
    state.observer.observe(wrapper, { attributes: true, attributeFilter: ["class"] });
  }

  private patchCanvasMethods(state: CanvasBridgeState): void {
    const canvas = state.canvas;
    const emit = this.emit;
    const scheduleSnapshot = this.scheduleSnapshot;
    const getData = canvas?.getData;
    if (typeof getData === "function") {
      const wrapped = function (this: CanvasRuntime, ...args: unknown[]) {
        const data: unknown = getData.apply(this, args);
        if (!state.dispatchingDataRequest) {
          state.dispatchingDataRequest = true;
          try { emit("advanced-canvas:data-requested", canvas, data); }
          finally { state.dispatchingDataRequest = false; }
        }
        return data;
      };
      state.patches.push(patchProperty(canvas, "getData", wrapped));
    }

    for (const key of ["importData", "setData"] as const) {
      const original = canvas?.[key];
      if (typeof original !== "function") continue;
      const wrapped = function (this: CanvasRuntime, incoming: CanvasData, ...args: unknown[]) {
        const outermost = state.dataLoadDepth === 0;
        let data = incoming;
        const setData = (next: CanvasData) => { data = next; };
        if (outermost) {
          emit("advanced-canvas:data-loaded:before", canvas, incoming, setData);
        }
        const filePath = state.view.file?.path ?? "";
        if (filePath && filePath !== state.filePath) {
          // A pane can swap canvas files without recreating its view or canvas
          // object, so the ids tracked for the previous file must be dropped
          // before this one is imported: everything it already holds belongs to
          // the newly opened file and is not newly created.
          state.filePath = filePath;
          state.knownNodeIds.clear();
          state.knownEdgeIds.clear();
          state.initialLoadSeen = false;
        }
        if (!state.initialLoadSeen) {
          // The first import after a not-yet-loaded view is the canvas file
          // itself: its items already existed and must not be reported as
          // newly created. Canvases the bridge only attaches to after their
          // file was loaded are excluded in attach(), so this branch only
          // catches the view's own initial load.
          state.initialLoadSeen = true;
          for (const node of Array.isArray(data?.nodes) ? data.nodes : []) {
            if (typeof node?.id === "string" && node.id) state.knownNodeIds.add(node.id);
          }
          for (const edge of Array.isArray(data?.edges) ? data.edges : []) {
            if (typeof edge?.id === "string" && edge.id) state.knownEdgeIds.add(edge.id);
          }
        }
        state.dataLoadDepth += 1;
        let result: unknown;
        try {
          result = original.call(this, data, ...args);
        } catch (error) {
          state.dataLoadDepth = Math.max(0, state.dataLoadDepth - 1);
          throw error;
        }
        const complete = (): void => {
          state.dataLoadDepth = Math.max(0, state.dataLoadDepth - 1);
          if (outermost) {
            emit("advanced-canvas:data-loaded:after", canvas, data, setData);
            scheduleSnapshot(state, false);
          }
        };
        if (isPromiseLike(result)) {
          return result.then((value: unknown) => { complete(); return value; }, (error: unknown) => {
            complete();
            throw error;
          });
        }
        complete();
        return result;
      };
      state.patches.push(patchProperty(canvas, key, wrapped));
    }

    const requestSave = canvas?.requestSave;
    if (typeof requestSave === "function") {
      const wrapped = function (this: CanvasRuntime, ...args: unknown[]) {
        state.pendingSave = true;
        emit("advanced-canvas:canvas-saved:before", canvas);
        const result: unknown = requestSave.apply(this, args);
        return result;
      };
      state.patches.push(patchProperty(canvas, "requestSave", wrapped));
    }
  }

  private onVaultModify(file: TAbstractFile): void {
    const path = typeof file?.path === "string" ? file.path : "";
    if (!path) return;
    for (const state of this.states.values()) {
      if (state.view?.file?.path !== path) continue;
      if (state.pendingSave) {
        state.pendingSave = false;
        this.emit("advanced-canvas:canvas-saved:after", state.canvas);
      }
      this.scheduleSnapshot(state, false);
    }
  }
}
