import { Notice, setIcon } from "obsidian";
import type { Events, Plugin } from "obsidian";
import { makeTextNode, readCanvasData, type CanvasData, type CanvasNodeData } from "./canvas";
import { isCanvasViewRuntime, type CanvasRuntime } from "./canvas-runtime";
import { defaultNodeSize } from "./node-defaults";
import {
  applyResearchPreset, applyResearchIntensity, researchPreset, researchIntensity,
  RESEARCH_PRESETS, RESEARCH_COLORS, RESEARCH_INTENSITIES
} from "./research-style";
import { decorateCanvas } from "./enhancements";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape } from "./canvas-node-style";
import { applyRoundedMapPreset, roundedMapCss } from "./rounded-map-style";
import { applyScrapbookPreset, decorateCanvasTheme, recordCanvasStyleHistory, resolveCanvasTheme, scrapbookPreset, SCRAPBOOK_PRESETS, SCRAPBOOK_COLORS } from "./canvas-theme";
import { applySoftNotesPreset, resolveSoftNotesStyle, SOFT_NOTES_COLORS, SOFT_NOTES_PRESETS } from "./soft-notes-style";
import {
  applySketchFill as applySketchFillToData,
  applySketchPreset as applySketchPresetToData,
  isSketchFill,
  SKETCH_COLORS,
  SKETCH_FILLS,
  SKETCH_PRESETS,
  type SketchFill
} from "./sketch-style";
import {
  applyNodeVisualStyle,
  NODE_STYLE_ALIGNMENTS,
  NODE_STYLE_BORDERS,
  NODE_STYLE_COLORS,
  NODE_STYLE_PRESET_LIST,
  NODE_STYLE_SHAPES,
  ROUNDED_MAP_PRESETS,
  type NodeVisualStylePatch
} from "./node-visual-style";
import { t } from "./i18n";

/**
 * Node style entry point.
 *
 * The style button joins Obsidian's own `.canvas-controls` stack on the right
 * edge of the Canvas, next to the zoom/undo groups. Clicking it opens a docked
 * inspector panel. The native node context menu is left untouched, so the AI,
 * layout and other menu entries registered by this plugin and by other plugins
 * keep working.
 */

type ControlGroup = {
  group: HTMLElement;
  button: HTMLElement;
  cleanup: () => void;
};

type ActivePanel = {
  canvas: CanvasRuntime;
  nodeIds: string[];
  surface: HTMLElement;
  outsideHandler: (event: PointerEvent) => void;
  keyHandler: (event: KeyboardEvent) => void;
  resizeHandler: () => void;
  cleanupDrag: () => void;
};

type PresetTransform = (data: CanvasData, ids: readonly string[]) => CanvasData;
const PRESET_DRAG_TYPE = "application/x-better-canvas-node-preset";

function selectedNodeIds(canvas: CanvasRuntime): string[] | null {
  const selected = Array.from(canvas.selection?.values() ?? []);
  if (selected.length === 0) return null;
  const ids = new Set<string>();
  for (const item of selected) {
    const id = item.id ?? item.getData?.().id;
    if (typeof id !== "string" || !canvas.nodes?.has(id)) return null;
    ids.add(id);
  }
  return [...ids].sort();
}

function styleOf(node: CanvasNodeData): {
  color: string;
  shape: string;
  border: string;
  align: string;
  fill: SketchFill | "";
  sketchPreset: string;
  researchPreset: string;
  researchIntensity: number;
} {
  const styleAttributes = node.styleAttributes ?? {};
  const border = resolveCanvasNodeBorder(node);
  return {
    color: typeof node.color === "string" ? node.color.toLowerCase() : "",
    shape: resolveCanvasNodeShape(node),
    border: border === "none" ? "invisible" : border,
    align: typeof node.bcTextAlign === "string"
      ? node.bcTextAlign
      : typeof styleAttributes.textAlign === "string" ? styleAttributes.textAlign : "left",
    fill: isSketchFill(node.bcSketchFill) ? node.bcSketchFill : "",
    sketchPreset: typeof node.bcSketchPreset === "string" ? node.bcSketchPreset : "",
    researchPreset: researchPreset(node.bcResearchPreset).id,
    researchIntensity: researchIntensity(node.bcResearchIntensity)
  };
}

type StyleOptionState = "true" | "false" | "mixed";
type NodeStyleSnapshot = ReturnType<typeof styleOf>;

function optionState(matchCount: number, total: number): StyleOptionState {
  if (total === 0) return "false";
  if (matchCount === total) return "true";
  return matchCount > 0 ? "mixed" : "false";
}

function stateForStyles(
  styles: readonly NodeStyleSnapshot[],
  matches: (style: NodeStyleSnapshot) => boolean
): StyleOptionState {
  return optionState(styles.filter(matches).length, styles.length);
}

function optionClass(baseClass: string, state: StyleOptionState): string {
  return baseClass + (state === "true" ? " is-selected" : state === "mixed" ? " is-mixed" : "");
}

function matchesPreset(style: NodeStyleSnapshot, preset: (typeof NODE_STYLE_PRESET_LIST)[number]): boolean {
  return style.color === preset.style.color.toLowerCase() &&
    style.shape === preset.style.shape &&
    style.border === preset.style.border &&
    style.align === preset.style.align;
}

function matchesSketchPreset(
  style: NodeStyleSnapshot,
  preset: (typeof SKETCH_PRESETS)[number]
): boolean {
  return style.sketchPreset === preset.id &&
    style.shape === preset.style.shape &&
    style.fill === preset.style.fill &&
    style.color === preset.style.color &&
    style.border === preset.style.border &&
    style.align === preset.style.align;
}

/**
 * Inline icon paths used when the host's icon set does not know a name. Each
 * entry is a list of `[d, attributes]` pairs so dashed/dotted strokes can carry
 * their own dash pattern.
 */
const ICON_FALLBACKS: Record<string, Array<[string, Record<string, string>?]>> = {
  palette: [[
    "M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.8 1.8 0 0 1 1.4-3h1.4A3.5 3.5 0 0 0 21 11.2 8.5 8.5 0 0 0 12 3Z"
  ], ["M7.5 10h.01"], ["M10 6.5h.01"], ["M15 7.5h.01"], ["M17 10.5h.01"]],
  "x": [["M6 6l12 12"], ["M18 6 6 18"]],
  "align-left": [["M15 12H3"], ["M17 18H3"], ["M21 6H3"]],
  "align-center": [["M17 12H7"], ["M19 18H5"], ["M21 6H3"]],
  "align-right": [["M21 12H9"], ["M21 18H7"], ["M21 6H3"]],
  "border-solid": [["M4 7h16v10H4z"]],
  "border-dashed": [["M4 7h16v10H4z", { "stroke-dasharray": "3.4 2.4" }]],
  "border-dotted": [["M4 7h16v10H4z", { "stroke-dasharray": "0.6 2.8", "stroke-linecap": "round" }]],
  "border-double": [["M4 6.5h16v11H4z"], ["M4 9.5h16"], ["M4 14.5h16"]],
  "border-none": [["M5 5l14 14"]]
};

function addButton(
  parent: HTMLElement,
  label: string,
  className: string,
  action: (event: MouseEvent) => void,
  icon?: string
): HTMLButtonElement {
  const button = parent.ownerDocument.win.createEl("button");
  button.type = "button";
  button.className = className;
  if (icon) {
    setIcon(button, icon);
    // Keep icon-only controls visible if the host renderer fails to inject the
    // SVG for this surface.
    if (!button.querySelector("svg")) {
      const svg = parent.ownerDocument.win.createSvg("svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.8");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      for (const [d, extra] of ICON_FALLBACKS[icon] ?? []) {
        const path = parent.ownerDocument.win.createSvg("path");
        path.setAttribute("d", d);
        for (const [name, value] of Object.entries(extra ?? {})) path.setAttribute(name, value);
        svg.appendChild(path);
      }
      button.appendChild(svg);
    }
  } else button.textContent = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    action(event);
  });
  parent.appendChild(button);
  return button;
}

export default class NodeMenuUnifier {
  private readonly plugin: Plugin;
  private readonly controlGroups = new Map<HTMLElement, ControlGroup>();
  private activePanel: ActivePanel | null = null;
  private panelRefreshFrame: number | null = null;
  private presetDrag: { panel: ActivePanel; transform: PresetTransform; theme: string } | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  start(): void {
    const workspace = this.plugin.app.workspace;
    const events: Events = workspace;
    this.plugin.registerEvent(workspace.on("layout-change", () => this.scanCanvases()));
    this.plugin.registerEvent(workspace.on("active-leaf-change", () => this.scanCanvases()));
    this.plugin.registerEvent(events.on("better-canvas:theme-changed", () => this.renderStylePanel()));
    this.plugin.registerEvent(events.on("advanced-canvas:data-loaded:after", (canvas: unknown) => {
      if (this.activePanel?.canvas !== canvas || this.panelRefreshFrame !== null) return;
      this.panelRefreshFrame = window.requestAnimationFrame(() => {
        this.panelRefreshFrame = null;
        this.renderStylePanel();
      });
    }));
    workspace.onLayoutReady(() => this.scanCanvases());
    this.plugin.register(() => this.stop());
    this.scanCanvases();
  }

  stop(): void {
    if (this.panelRefreshFrame !== null) window.cancelAnimationFrame(this.panelRefreshFrame);
    this.panelRefreshFrame = null;
    this.dismissPanel();
    for (const record of this.controlGroups.values()) {
      record.cleanup();
      record.group.remove();
    }
    this.controlGroups.clear();
  }

  private scanCanvases(): void {
    const workspace = this.plugin.app.workspace;
    const liveContainers = new Set<HTMLElement>();
    const liveCanvases = new Set<CanvasRuntime>();
    for (const leaf of workspace.getLeavesOfType("canvas")) {
      const view = leaf.view;
      if (!isCanvasViewRuntime(view)) continue;
      const container = view.containerEl;
      const canvas = view.canvas;
      liveContainers.add(container);
      liveCanvases.add(canvas);
      this.installCanvasControl(container, canvas);
    }
    // The panel is bound to one Canvas; close it when that view goes away.
    if (this.activePanel && !liveCanvases.has(this.activePanel.canvas)) this.dismissPanel();
    // Drop controls whose Canvas view has closed.
    for (const [container, record] of this.controlGroups) {
      if (liveContainers.has(container)) continue;
      record.cleanup();
      record.group.remove();
      this.controlGroups.delete(container);
    }
  }

  private installCanvasControl(container: HTMLElement, canvas: CanvasRuntime): void {
    const controls = container.querySelector<HTMLElement>(".canvas-controls");
    if (!controls) return;
    if (this.controlGroups.has(container)) {
      this.syncControlState(container, canvas);
      return;
    }

    // Mirror Obsidian's own group/item markup so the entry inherits the native
    // size, radius, border and hover treatment.
    const group = container.ownerDocument.win.createDiv();
    group.className = "canvas-control-group mod-raised bc-node-style-control-group";
    const button = container.ownerDocument.win.createDiv();
    button.className = "canvas-control-item bc-node-style-control-item";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", t("Node style", "节点样式"));
    button.setAttribute("data-tooltip-position", "left");
    setIcon(button, "palette");
    if (!button.querySelector("svg")) {
      button.textContent = "◐";
    }
    group.appendChild(button);
    controls.insertBefore(group, controls.firstChild);

    const open = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      const selected = Array.from(canvas.selection?.values() ?? []);
      const nodeIds = selectedNodeIds(canvas);
      // An empty Canvas selection opens the panel in its empty state. A
      // selection made only of edges (or a mixed selection) still cannot be
      // styled as nodes.
      if (selected.length > 0 && !nodeIds) {
        new Notice(t("Select one or more nodes (not connections) before opening node style.", "请先选择一个或多个节点（不能包含连线），再打开节点样式。"));
        return;
      }
      if (this.activePanel?.canvas === canvas) {
        this.dismissPanel();
        return;
      }
      this.showStylePanel(canvas, nodeIds ?? []);
      this.syncControlState(container, canvas);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" && event.key !== " ") return;
      open(event);
    };
    const sync = (): void => this.syncControlState(container, canvas);
    button.addEventListener("click", open);
    button.addEventListener("keydown", keydown);
    container.addEventListener("pointerup", sync, true);
    container.addEventListener("keyup", sync, true);

    this.controlGroups.set(container, {
      group,
      button,
      cleanup: () => {
        button.removeEventListener("click", open);
        button.removeEventListener("keydown", keydown);
        container.removeEventListener("pointerup", sync, true);
        container.removeEventListener("keyup", sync, true);
      }
    });
    this.syncControlState(container, canvas);
  }

  private syncControlState(container: HTMLElement, canvas: CanvasRuntime): void {
    const record = this.controlGroups.get(container);
    if (!record) return;
    const nodeIds = selectedNodeIds(canvas);
    record.button.classList.toggle(
      "is-active",
      Boolean(this.activePanel && this.activePanel.canvas === canvas)
    );

    const active = this.activePanel;
    if (!active || active.canvas !== canvas) return;
    const selectedItems = Array.from(canvas.selection?.values() ?? []);
    if (selectedItems.length === 0) {
      if (active.nodeIds.length) {
        active.nodeIds = [];
        this.renderStylePanel();
      }
      return;
    }
    if (!nodeIds) {
      this.dismissPanel();
      return;
    }
    const currentData = readCanvasData(canvas);
    const currentIds = new Set(currentData.nodes.map(node => node.id));
    if (nodeIds.some(id => !currentIds.has(id))) {
      this.dismissPanel();
      new Notice(t("Some selected nodes no longer exist; the style panel was closed.", "部分选中节点已不存在，样式面板已关闭。"));
      return;
    }
    if (nodeIds.join("\u0000") !== active.nodeIds.join("\u0000")) {
      active.nodeIds = nodeIds;
      this.renderStylePanel();
    }
  }

  private showStylePanel(canvas: CanvasRuntime, nodeIds: readonly string[]): void {
    this.dismissPanel();
    const targetIds = [...new Set(nodeIds)].sort();
    const currentData = readCanvasData(canvas);
    const availableIds = new Set(currentData.nodes.map(node => node.id));
    if (targetIds.some(id => !availableIds.has(id))) {
      new Notice(t("The target nodes no longer exist; the style panel was closed.", "目标节点已不存在，样式面板已关闭。"));
      return;
    }

    const ownerDocument = this.controlsForCanvas(canvas)?.ownerDocument ?? this.plugin.app.workspace.containerEl.ownerDocument;
    const surface = ownerDocument.win.createEl("aside");
    surface.className = "bc-node-style-panel";
    surface.setAttribute("role", "dialog");
    surface.setAttribute("aria-label", t("Node style", "节点样式"));
    ownerDocument.body.appendChild(surface);

    const active: ActivePanel = {
      canvas,
      nodeIds: targetIds,
      surface,
      outsideHandler: () => undefined,
      keyHandler: () => undefined,
      resizeHandler: () => this.positionPanel(),
      cleanupDrag: () => undefined
    };
    active.outsideHandler = event => {
      if (event.composedPath().includes(surface)) return;
      // A click on another Canvas node retargets the panel; the style control
      // toggles it; anywhere else dismisses it.
      const target = event.target as Node | null;
      if (target?.instanceOf?.(Element) &&
        (target.closest(".canvas-node") || target.closest(".bc-node-style-control-group"))) return;
      this.dismissPanel();
    };
    active.keyHandler = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.dismissPanel();
    };
    this.activePanel = active;
    this.installPresetDrop(active);
    ownerDocument.addEventListener("pointerdown", active.outsideHandler, true);
    ownerDocument.addEventListener("keydown", active.keyHandler, true);
    ownerDocument.defaultView?.addEventListener("resize", active.resizeHandler);
    this.renderStylePanel();
  }

  /** Docks the panel just left of the Canvas control stack. */
  private positionPanel(): void {
    const active = this.activePanel;
    if (!active) return;
    const controls = this.controlsForCanvas(active.canvas);
    const surface = active.surface;
    const margin = 12;
    const ownerWindow = surface.win;
    surface.style.maxHeight = Math.max(240, ownerWindow.innerHeight - margin * 2) + "px";
    const width = Math.min(316, Math.max(240, ownerWindow.innerWidth - margin * 2));
    surface.style.width = width + "px";

    const anchor = controls?.getBoundingClientRect();
    const panelHeight = Math.min(surface.getBoundingClientRect().height, ownerWindow.innerHeight - margin * 2);
    const top = anchor
      ? Math.min(Math.max(margin, anchor.top), Math.max(margin, ownerWindow.innerHeight - panelHeight - margin))
      : margin;
    const left = anchor
      ? Math.max(margin, anchor.left - width - 10)
      : ownerWindow.innerWidth - width - margin;
    surface.style.top = Math.round(top) + "px";
    surface.style.left = Math.round(left) + "px";
  }

  private controlsForCanvas(canvas: CanvasRuntime): HTMLElement | null {
    const workspace = this.plugin.app.workspace;
    for (const leaf of workspace.getLeavesOfType("canvas")) {
      const view = leaf.view;
      if (!isCanvasViewRuntime(view) || view.canvas !== canvas) continue;
      return view.containerEl.querySelector<HTMLElement>(".canvas-controls");
    }
    return null;
  }

  private dismissPanel(): void {
    const active = this.activePanel;
    if (!active) return;
    const ownerDocument = active.surface.ownerDocument;
    ownerDocument.removeEventListener("pointerdown", active.outsideHandler, true);
    ownerDocument.removeEventListener("keydown", active.keyHandler, true);
    ownerDocument.defaultView?.removeEventListener("resize", active.resizeHandler);
    active.cleanupDrag();
    this.presetDrag = null;
    active.surface.remove();
    this.activePanel = null;
    for (const [container] of this.controlGroups) {
      const view = this.plugin.app.workspace.getLeavesOfType("canvas")
        .map(leaf => leaf.view)
        .find(view => isCanvasViewRuntime(view) && view.containerEl === container);
      const canvas = isCanvasViewRuntime(view) ? view.canvas : undefined;
      if (canvas) this.syncControlState(container, canvas);
    }
  }

  private isReadonly(canvas: CanvasRuntime): boolean {
    return Boolean(canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly"));
  }

  private createPresetNode(active: ActivePanel, transform: PresetTransform, position?: { x: number; y: number }): void {
    if (this.activePanel !== active || this.isReadonly(active.canvas)) return;
    const { canvas } = active;
    const center = position ?? canvas.posCenter?.();
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      new Notice(t("Could not determine the Canvas position; no card was created.", "无法确定画布位置，未创建卡片。"));
      return;
    }
    const before = readCanvasData(canvas);
    const node = makeTextNode("", 0, 0, defaultNodeSize());
    node.x = center.x - node.width / 2;
    node.y = center.y - node.height / 2;
    const next = transform({ ...before, nodes: [...before.nodes, node] }, [node.id]);
    try {
      // Import the styled node once so creation and its preset share one undo step.
      recordCanvasStyleHistory(canvas, before);
      canvas.importData(next);
      canvas.requestSave?.(false);
      recordCanvasStyleHistory(canvas, readCanvasData(canvas));
      const liveNode = canvas.nodes?.get?.(node.id);
      if (liveNode) canvas.selectOnly?.(liveNode);
      active.nodeIds = [node.id];
      canvas.requestFrame?.();
      decorateCanvas(canvas);
      decorateCanvasTheme(canvas);
      this.renderStylePanel();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Could not create the preset card.", "创建预设卡片失败。"));
    }
  }

  private addPresetButton(
    parent: HTMLElement, label: string, className: string, apply: () => void,
    transform: PresetTransform, eligible: boolean
  ): HTMLButtonElement {
    const active = this.activePanel!;
    const button = addButton(parent, label, className, () => {
      if (this.activePanel !== active || this.isReadonly(active.canvas)) return;
      if (active.nodeIds.length === 0) this.createPresetNode(active, transform);
      else apply();
    });
    button.disabled = this.isReadonly(active.canvas) || (active.nodeIds.length > 0 && !eligible);
    button.draggable = !button.disabled;
    button.addEventListener("dragstart", event => {
      if (button.disabled || this.activePanel !== active || this.isReadonly(active.canvas) || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      this.presetDrag = { panel: active, transform, theme: resolveCanvasTheme(readCanvasData(active.canvas)) };
      event.dataTransfer.effectAllowed = "copy";
      // No text fallback: native Canvas must not also create a plain text card.
      event.dataTransfer.setData(PRESET_DRAG_TYPE, "preset");
      event.stopPropagation();
    });
    return button;
  }

  private installPresetDrop(active: ActivePanel): void {
    const target = active.canvas.wrapperEl;
    if (!target?.addEventListener) return;
    const end = (): void => { this.presetDrag = null; };
    const handle = (event: DragEvent): void => {
      const drag = this.presetDrag;
      if (!drag || drag.panel !== active || !event.dataTransfer?.types.includes(PRESET_DRAG_TYPE)) return;
      const element = event.target as Node | null;
      if (element?.instanceOf?.(Element) && element.closest(".canvas-controls, .canvas-card-menu, .canvas-menu")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const allowed = !this.isReadonly(active.canvas) &&
        drag.theme === resolveCanvasTheme(readCanvasData(active.canvas));
      event.dataTransfer.dropEffect = allowed ? "copy" : "none";
      if (event.type !== "drop") return;
      end();
      if (!allowed || typeof active.canvas.posFromClient !== "function") return;
      const position = active.canvas.posFromClient({ x: event.clientX, y: event.clientY });
      // Never fall back to the viewport center when the host cannot resolve a drop.
      if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      this.createPresetNode(active, drag.transform, position);
    };
    target.addEventListener("dragover", handle, true);
    target.addEventListener("drop", handle, true);
    target.ownerDocument.addEventListener("dragend", end, true);
    active.cleanupDrag = () => {
      target.removeEventListener("dragover", handle, true);
      target.removeEventListener("drop", handle, true);
      target.ownerDocument.removeEventListener("dragend", end, true);
    };
  }

  private applyStyle(patch: NodeVisualStylePatch, focusKey?: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }

    const current = readCanvasData(canvas);
    const currentIds = new Set(current.nodes.map(node => node.id));
    if (nodeIds.some(id => !currentIds.has(id))) {
      new Notice(t("Some selected nodes no longer exist; no style was applied.", "部分选中节点已不存在，未应用样式。"));
      this.dismissPanel();
      return;
    }

    const result = applyNodeVisualStyle(current, nodeIds, patch);
    if (result.updated !== nodeIds.length) {
      new Notice(t("Could not update every selected node; no style was applied.", "无法更新全部选中节点，未应用样式。"));
      return;
    }

    try {
      const soft = resolveCanvasTheme(current) === "soft-notes";
      if (soft) recordCanvasStyleHistory(canvas, current);
      canvas.importData(result.data);
      if (soft) {
        canvas.requestSave?.(false);
        recordCanvasStyleHistory(canvas, readCanvasData(canvas));
      } else canvas.requestSave?.();
      canvas.requestFrame?.();
      decorateCanvas(canvas);
      if (soft) decorateCanvasTheme(canvas);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Could not apply the node style.", "应用节点样式失败。"));
      return;
    }

    this.renderStylePanel(focusKey);
  }

  private applyPaper(preset: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    recordCanvasStyleHistory(canvas, data);
    canvas.importData(applyScrapbookPreset(data, nodeIds, preset));
    canvas.requestSave?.(false);
    recordCanvasStyleHistory(canvas, readCanvasData(canvas));
    canvas.requestFrame?.();
    decorateCanvas(canvas);
    decorateCanvasTheme(canvas);
    this.renderStylePanel("paper-" + preset);
  }

  private applySketchPreset(presetId: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    const result = applySketchPresetToData(data, nodeIds, presetId);
    if (result.updated === 0) {
      new Notice(t("Presets are not applied to group nodes.", "分组节点不应用功能预设。"));
      return;
    }
    recordCanvasStyleHistory(canvas, data);
    canvas.importData(result.data);
    canvas.requestSave?.(false);
    recordCanvasStyleHistory(canvas, readCanvasData(canvas));
    canvas.requestFrame?.();
    decorateCanvas(canvas);
    decorateCanvasTheme(canvas);
    this.renderStylePanel("sketch-" + presetId);
  }

  private applyRoundedPreset(presetId: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    const result = applyRoundedMapPreset(data, nodeIds, presetId);
    if (!result.updated) return;
    recordCanvasStyleHistory(canvas, data);
    canvas.importData(result.data);
    canvas.requestSave?.(false);
    recordCanvasStyleHistory(canvas, readCanvasData(canvas));
    canvas.requestFrame?.();
    decorateCanvas(canvas);
    this.renderStylePanel("rounded-" + presetId);
  }

  private applySketchFill(fill: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    const result = applySketchFillToData(data, nodeIds, fill);
    if (result.updated === 0) return;
    recordCanvasStyleHistory(canvas, data);
    canvas.importData(result.data);
    canvas.requestSave?.(false);
    recordCanvasStyleHistory(canvas, readCanvasData(canvas));
    canvas.requestFrame?.();
    decorateCanvas(canvas);
    decorateCanvasTheme(canvas);
    this.renderStylePanel("sketch-fill-" + fill);
  }

  private applySoftPreset(presetId: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    const result = applySoftNotesPreset(data, nodeIds, presetId);
    if (!result.updated) return;
    recordCanvasStyleHistory(canvas, data);
    canvas.importData(result.data);
    canvas.requestSave?.(false);
    recordCanvasStyleHistory(canvas, readCanvasData(canvas));
    canvas.requestFrame?.();
    decorateCanvas(canvas);
    decorateCanvasTheme(canvas);
    this.renderStylePanel("soft-" + presetId);
  }

  private applyResearch(value: string | number): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeIds } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice(t("This Canvas is in read-only mode; node styles cannot be changed.", "当前 Canvas 处于只读模式，无法更改节点样式。"));
      return;
    }
    const data = readCanvasData(canvas);
    if (nodeIds.some(id => !data.nodes.some(node => node.id === id))) {
      this.dismissPanel();
      return;
    }
    const result = typeof value === "number"
      ? applyResearchIntensity(data, nodeIds, value)
      : applyResearchPreset(data, nodeIds, value);
    if (!result.updated) return;
    try {
      recordCanvasStyleHistory(canvas, data);
      canvas.importData(result.data);
      canvas.requestSave?.(false);
      recordCanvasStyleHistory(canvas, readCanvasData(canvas));
      canvas.requestFrame?.();
      decorateCanvas(canvas);
      decorateCanvasTheme(canvas);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Could not apply the paper style.", "应用纸本样式失败。"));
      return;
    }
    this.renderStylePanel("research-" + value);
  }

  private renderStylePanel(focusKey?: string): void {
    const active = this.activePanel;
    if (!active) return;
    const data = readCanvasData(active.canvas);
    const nodes = active.nodeIds.map(id => data.nodes.find(node => node.id === id))
      .filter((node): node is CanvasNodeData => node !== undefined);
    if (nodes.length !== active.nodeIds.length) {
      this.dismissPanel();
      new Notice(t("The target nodes no longer exist; the style panel was closed.", "目标节点已不存在，样式面板已关闭。"));
      return;
    }
    const nodeStyles = nodes.map(styleOf);
    const hasSelection = nodeStyles.length > 0;
    const hasMixedStyles = (["color", "shape", "border", "align", "fill", "sketchPreset", "researchPreset", "researchIntensity"] as const)
      .some(key => new Set(nodeStyles.map(style => style[key])).size > 1);
    const surface = active.surface;
    surface.replaceChildren();

    const header = surface.ownerDocument.win.createDiv();
    header.className = "bc-node-style-header";
    const heading = surface.ownerDocument.win.createEl("strong");
    heading.className = "bc-node-style-title";
    heading.textContent = t("Node style", "节点样式");
    header.appendChild(heading);
    if (!hasSelection) {
      const count = surface.ownerDocument.win.createSpan();
      count.className = "bc-node-style-selection-count";
      count.textContent = t("No nodes selected", "未选择节点");
      header.appendChild(count);
    } else if (active.nodeIds.length > 1) {
      const count = surface.ownerDocument.win.createSpan();
      count.className = "bc-node-style-selection-count";
      count.textContent = t(`${active.nodeIds.length} node${active.nodeIds.length === 1 ? "" : "s"}`, `${active.nodeIds.length} 个节点`) + (hasMixedStyles ? t(" · Some styles differ", " · 部分样式不同") : "");
      header.appendChild(count);
    }
    addButton(header, t("Close", "关闭"), "bc-node-style-close", () => this.dismissPanel(), "x");
    surface.appendChild(header);

    const body = surface.ownerDocument.win.createDiv();
    body.className = "bc-node-style-scroll";
    surface.appendChild(body);
    const hint = surface.ownerDocument.win.createEl("p");
    hint.className = "bc-node-style-preset-hint";
    hint.textContent = hasSelection
      ? t("Click a preset to apply it to the selection; drag it onto the Canvas to create a card.", "点击预设应用到选区；拖入画布新建卡片。")
      : t("Click to create in the center of the viewport, or drag onto the Canvas to choose a position.", "点击在视口中心新建，或拖入画布指定位置。");
    body.appendChild(hint);

    const addSection = (label: string): HTMLElement => {
      const section = surface.ownerDocument.win.createEl("section");
      section.className = "bc-node-style-section";
      const title = surface.ownerDocument.win.createDiv();
      title.className = "bc-node-style-section-title";
      title.textContent = label;
      section.appendChild(title);
      body.appendChild(section);
      return section;
    };

    const canvasTheme = resolveCanvasTheme(data);
    const isScrapbook = canvasTheme === "scrapbook";
    const isSketch = canvasTheme === "sketch";
    const isSoft = canvasTheme === "soft-notes";
    const isResearch = canvasTheme === "research";
    const isRounded = canvasTheme === "rounded-map";
    surface.dataset.bcTheme = canvasTheme;
    if (isResearch) {
      const applicable = nodes.filter(node => node.type !== "group");
      const presets = surface.ownerDocument.win.createDiv();
      presets.className = "bc-research-presets";
      addSection(t("Paper Research · Presets", "纸本研究 · 功能预设")).appendChild(presets);
      for (const preset of RESEARCH_PRESETS) {
        const state = optionState(applicable.filter(node => researchPreset(node.bcResearchPreset).id === preset.id).length, applicable.length);
        const button = this.addPresetButton(presets, "", optionClass("bc-research-preset", state),
          () => this.applyResearch(preset.id),
          (data, ids) => applyResearchPreset(data, ids, preset.id).data, applicable.length > 0);
        button.dataset.styleOption = "research-" + preset.id;
        button.title = preset.label + " · " + preset.detail;
        button.setAttribute("aria-label", t(preset.label + ": " + preset.detail, preset.label + "：" + preset.detail));
        button.setAttribute("aria-pressed", state);
        const preview = surface.ownerDocument.win.createSpan();
        preview.className = "bc-research-preview";
        preview.dataset.bcResearchPreset = preset.id;
        preview.style.setProperty("--bc-research-accent", preset.color);
        preview.setAttribute("aria-hidden", "true");
        button.appendChild(preview);
      }
      const intensities = surface.ownerDocument.win.createDiv();
      intensities.className = "bc-research-intensities";
      addSection(t("Paper tint intensity", "纸面色彩浓度")).appendChild(intensities);
      for (const intensity of RESEARCH_INTENSITIES) {
        const state = optionState(applicable.filter(node => researchIntensity(node.bcResearchIntensity) === intensity.value).length, applicable.length);
        const button = addButton(intensities, intensity.label, optionClass("bc-research-intensity", state), () => this.applyResearch(intensity.value));
        button.dataset.styleOption = "research-" + intensity.value;
        button.setAttribute("aria-pressed", state);
        button.disabled = applicable.length === 0;
      }
    }
    if (isScrapbook) {
      const papers = surface.ownerDocument.win.createDiv();
      papers.className = "bc-paper-presets";
      addSection(t("Scrapbook · Paper", "拼贴手账 · 纸片")).appendChild(papers);
      for (const preset of SCRAPBOOK_PRESETS) {
        const applicable = nodes.filter(node => node?.type !== "group");
        const state = applicable.length ? optionState(
          applicable.filter(node => scrapbookPreset(node?.bcScrapbookPreset) === preset.id).length,
          applicable.length
        ) : "false";
        const button = this.addPresetButton(papers, "", optionClass("bc-paper-preset", state),
          () => this.applyPaper(preset.id),
          (data, ids) => applyScrapbookPreset(data, ids, preset.id), applicable.length > 0);
        button.dataset.styleOption = "paper-" + preset.id;
        button.setAttribute("aria-label", preset.label);
        button.setAttribute("title", preset.label);
        button.setAttribute("aria-pressed", state);
        const preview = surface.ownerDocument.win.createSpan();
        preview.className = "bc-paper-preview";
        preview.dataset.bcPaper = preset.id;
        preview.textContent = preset.sample;
        preview.setAttribute("aria-hidden", "true");
        button.appendChild(preview);
      }
    }
    if (isSketch) {
      const presetSection = addSection(t("Presets", "功能预设"));
      const presets = surface.ownerDocument.win.createDiv();
      presets.className = "bc-sketch-presets";
      presetSection.appendChild(presets);
      for (const preset of SKETCH_PRESETS) {
        const state = stateForStyles(nodeStyles, style => matchesSketchPreset(style, preset));
        const button = this.addPresetButton(
          presets,
          preset.label,
          optionClass("bc-sketch-preset", state),
          () => this.applySketchPreset(preset.id),
          (data, ids) => applySketchPresetToData(data, ids, preset.id).data,
          nodes.some(node => node?.type !== "group")
        );
        button.dataset.styleOption = "sketch-" + preset.id;
        button.title = preset.label + " · " + preset.use;
        button.setAttribute("aria-label", t(preset.label + ": " + preset.use, preset.label + "：" + preset.use));
        button.setAttribute("aria-pressed", state);
        const preview = surface.ownerDocument.win.createSpan();
        preview.className = "bc-sketch-preset-preview shape-" + preset.style.shape +
          " fill-" + preset.style.fill + " border-" + preset.style.border + " align-" + preset.style.align;
        preview.style.setProperty("--bc-sketch-preset-color", preset.style.color);
        preview.setAttribute("aria-hidden", "true");
        preview.textContent = preset.sample;
        button.appendChild(preview);
        const label = surface.ownerDocument.win.createSpan();
        label.className = "bc-sketch-preset-name";
        label.textContent = preset.label;
        button.appendChild(label);
      }

      const fillSection = addSection(t("Fill", "填充"));
      const fills = surface.ownerDocument.win.createDiv();
      fills.className = "bc-sketch-fills";
      fillSection.appendChild(fills);
      for (const fill of SKETCH_FILLS) {
        const state = stateForStyles(nodeStyles, style => style.fill === fill.id);
        const button = addButton(
          fills,
          fill.label,
          optionClass("bc-sketch-fill", state),
          () => this.applySketchFill(fill.id)
        );
        button.dataset.styleOption = "sketch-fill-" + fill.id;
        button.title = fill.label;
        button.setAttribute("aria-label", fill.label);
        button.setAttribute("aria-pressed", state);
        button.disabled = !hasSelection;
        const swatch = surface.ownerDocument.win.createSpan();
        swatch.className = "bc-sketch-fill-swatch fill-" + fill.id;
        swatch.setAttribute("aria-hidden", "true");
        button.appendChild(swatch);
      }
    }
    if (isSoft) {
      const presets = surface.ownerDocument.win.createDiv();
      presets.className = "bc-soft-presets";
      addSection(t("Soft Notes · Presets", "柔软便签 · 功能预设")).appendChild(presets);
      const applicable = nodes.filter((node): node is CanvasNodeData => node?.type === "text");
      for (const preset of SOFT_NOTES_PRESETS) {
        const state = optionState(applicable.filter(node => {
          const style = resolveSoftNotesStyle(node);
          return style.preset.id === preset.id && style.color === preset.color && style.align === preset.align;
        }).length, applicable.length);
        const button = this.addPresetButton(presets, "", optionClass("bc-soft-preset", state),
          () => this.applySoftPreset(preset.id),
          (data, ids) => applySoftNotesPreset(data, ids, preset.id).data, applicable.length > 0);
        button.dataset.styleOption = "soft-" + preset.id;
        button.title = preset.label + " · " + preset.use;
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-pressed", state);
        const preview = surface.ownerDocument.win.createSvg("svg");
        preview.setAttribute("viewBox", "0 0 320 240");
        preview.setAttribute("aria-hidden", "true");
        const shape = surface.ownerDocument.win.createSvg("path");
        shape.setAttribute("d", preset.path);
        shape.setAttribute("fill", preset.color);
        preview.appendChild(shape);
        const sample = surface.ownerDocument.win.createSvg("path");
        sample.setAttribute("d", preset.id === "free"
          ? "M105 55H215M160 55V165M130 165H190M100 200H220"
          : "M90 92H220M90 123H230M90 152H180");
        sample.setAttribute("fill", "none");
        sample.setAttribute("stroke", preset.id === "free" ? "currentColor" : "#535d48");
        sample.setAttribute("stroke-width", "9");
        sample.setAttribute("stroke-linecap", "round");
        preview.appendChild(sample);
        button.appendChild(preview);
      }
      const hint = surface.ownerDocument.win.createEl("p");
      hint.className = "bc-soft-hint";
      hint.textContent = t("Applies to selected text nodes and keeps the body text. No preset adds a border.", "应用到选中的文本节点；保留正文。所有预设均无边框。");
      body.appendChild(hint);
    }
    if (isRounded) {
      const presets = surface.ownerDocument.win.createDiv();
      presets.className = "bc-rounded-presets";
      addSection(t("Gummy Whiteboard · Presets", "软糖白板 · 功能预设")).appendChild(presets);
      const applicable = nodes.filter(node => node.type !== "group").map(styleOf);
      for (const preset of ROUNDED_MAP_PRESETS) {
        const state = stateForStyles(applicable, style => matchesPreset(style, preset));
        const button = this.addPresetButton(presets, "", optionClass("bc-rounded-preset", state),
          () => this.applyRoundedPreset(preset.id),
          (data, ids) => applyRoundedMapPreset(data, ids, preset.id).data, applicable.length > 0);
        button.dataset.styleOption = "rounded-" + preset.id;
        button.setAttribute("aria-label", preset.label);
        button.setAttribute("aria-pressed", state);
        button.title = preset.label;
        const preview = surface.ownerDocument.win.createSpan();
        preview.className = "bc-rounded-preview";
        preview.setAttribute("aria-hidden", "true");
        for (const [key, value] of Object.entries(roundedMapCss(preset.style.shape, 120, 80))) preview.style.setProperty(key, value);
        preview.style.setProperty("--bc-rounded-fill", preset.style.color);
        const sample = surface.ownerDocument.win.createSpan();
        sample.textContent = preset.sample;
        preview.appendChild(sample);
        button.appendChild(preview);
      }
    }
    if (!isScrapbook && !isSketch && !isRounded && !isResearch && !isSoft) {
    const presetSection = addSection(t("Presets", "预设"));
    const presets = surface.ownerDocument.win.createDiv();
    presets.className = "bc-node-style-presets";
    presetSection.appendChild(presets);
    for (const preset of NODE_STYLE_PRESET_LIST) {
      const state = stateForStyles(nodeStyles, style => matchesPreset(style, preset));
      const button = this.addPresetButton(
        presets,
        "",
        optionClass("bc-node-style-preset", state),
        () => this.applyStyle({ ...preset.style }, "preset-" + preset.id),
        (data, ids) => applyNodeVisualStyle(data, ids, preset.style).data, hasSelection
      );
      button.dataset.styleOption = "preset-" + preset.id;
      button.title = t(preset.label + " preset", preset.label + "预设");
      button.setAttribute("aria-label", t(preset.label + " preset", preset.label + "预设"));
      button.setAttribute("aria-pressed", state);

      const preview = surface.ownerDocument.win.createSpan();
      preview.className = "bc-node-style-preset-preview shape-" + preset.style.shape +
        " border-" + preset.style.border + " align-" + preset.style.align;
      preview.style.setProperty("--bc-preset-color", preset.style.color);
      preview.setAttribute("aria-hidden", "true");
      const sample = surface.ownerDocument.win.createSpan();
      sample.className = "bc-node-style-preset-sample";
      sample.textContent = "Aa";
      preview.appendChild(sample);
      button.appendChild(preview);
    }
    }

    const colorSection = addSection(t("Color", "颜色"));
    const colors = surface.ownerDocument.win.createDiv();
    colors.className = "bc-node-style-colors";
    colorSection.appendChild(colors);
    const roundedColors = ROUNDED_MAP_PRESETS.map(preset => ({ id: preset.id, label: preset.label, value: preset.style.color }));
    for (const color of isScrapbook ? SCRAPBOOK_COLORS : isSketch ? SKETCH_COLORS : isRounded ? roundedColors : isResearch ? RESEARCH_COLORS : isSoft ? SOFT_NOTES_COLORS : NODE_STYLE_COLORS) {
      const state = stateForStyles(nodeStyles, style => style.color === color.value.toLowerCase());
      const button = addButton(
        colors,
        "",
        optionClass("bc-node-style-color", state),
        () => this.applyStyle({ color: color.value }, "color-" + color.id)
      );
      button.dataset.styleOption = "color-" + color.id;
      button.title = color.label;
      button.setAttribute("aria-label", color.label);
      button.setAttribute("aria-pressed", state);
      button.disabled = !hasSelection;
      const swatch = surface.ownerDocument.win.createSpan();
      swatch.className = "bc-node-style-swatch";
      swatch.style.backgroundColor = color.value;
      button.appendChild(swatch);
    }

    if (!isSoft) {
    const shapeSection = addSection(t("Shape", "形状"));
    const shapes = surface.ownerDocument.win.createDiv();
    shapes.className = "bc-node-style-shapes";
    shapeSection.appendChild(shapes);
    for (const shape of NODE_STYLE_SHAPES) {
      const state = stateForStyles(nodeStyles, style => style.shape === shape.id);
      const button = addButton(
        shapes,
        "",
        optionClass("bc-node-style-choice", state),
        () => this.applyStyle({ shape: shape.id }, "shape-" + shape.id)
      );
      button.dataset.styleOption = "shape-" + shape.id;
      button.title = shape.label;
      button.setAttribute("aria-label", shape.label);
      button.setAttribute("aria-pressed", state);
      button.disabled = !hasSelection;
      // The preview alone identifies the option; the name stays a tooltip and
      // accessible label instead of printed text under the preview.
      const preview = surface.ownerDocument.win.createSpan();
      preview.className = "bc-node-shape-preview shape-" + shape.id;
      if (isRounded) {
        const css = roundedMapCss(shape.id, 32, 24);
        if (Object.keys(css).length) {
          preview.className += " bc-rounded-shape-preview";
          for (const [key, value] of Object.entries(css)) preview.style.setProperty(key, value);
        }
      }
      preview.setAttribute("aria-hidden", "true");
      button.appendChild(preview);
    }

    const borderSection = addSection(t("Border", "边框"));
    const borders = surface.ownerDocument.win.createDiv();
    borders.className = "bc-node-style-borders";
    borderSection.appendChild(borders);
    for (const border of NODE_STYLE_BORDERS) {
      const state = stateForStyles(nodeStyles, style => style.border === border.id);
      const button = addButton(
        borders,
        border.label,
        optionClass("bc-node-style-choice", state),
        () => this.applyStyle({ border: border.id }, "border-" + border.id),
        border.icon
      );
      button.dataset.styleOption = "border-" + border.id;
      button.setAttribute("aria-pressed", state);
      button.disabled = !hasSelection;
    }
    }

    const alignSection = addSection(t("Text align", "文本对齐"));
    const alignments = surface.ownerDocument.win.createDiv();
    alignments.className = "bc-node-style-alignments";
    alignSection.appendChild(alignments);
    for (const align of NODE_STYLE_ALIGNMENTS) {
      const state = stateForStyles(nodeStyles, style => style.align === align.id);
      const button = addButton(
        alignments,
        align.label,
        optionClass("bc-node-style-choice", state),
        () => this.applyStyle({ align: align.id }, "align-" + align.id),
        align.icon
      );
      button.dataset.styleOption = "align-" + align.id;
      button.setAttribute("aria-pressed", state);
      button.disabled = !hasSelection;
    }

    this.positionPanel();
    if (focusKey) {
      const selector = '[data-style-option="' + focusKey + '"]';
      surface.querySelector<HTMLElement>(selector)?.focus();
    }
  }

}
