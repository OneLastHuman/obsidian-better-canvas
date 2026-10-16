import { Notice } from "obsidian";
import type { Plugin } from "obsidian";
import { readCanvasData, type CanvasNodeData } from "./canvas";
import { decorateCanvas } from "./enhancements";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape } from "./canvas-node-style";
import {
  applyNodeVisualStyle,
  DEFAULT_NODE_VISUAL_STYLE,
  NODE_STYLE_ALIGNMENTS,
  NODE_STYLE_BORDERS,
  NODE_STYLE_COLORS,
  NODE_STYLE_PRESETS,
  NODE_STYLE_SHAPES,
  type NodeVisualStylePatch
} from "./node-visual-style";

type PopupPatch = {
  menu: any;
  original: (...args: any[]) => any;
  wrapper: (...args: any[]) => any;
  hadOwnRender: boolean;
};

type PanelSource = "toolbar" | "context";

type ActivePanel = {
  canvas: any;
  nodeId: string;
  source: PanelSource;
  surface: HTMLElement;
  popupEl?: HTMLElement;
  anchor: { x: number; y: number };
  outsideHandler: (event: PointerEvent) => void;
  keyHandler: (event: KeyboardEvent) => void;
};

function selectedNodeId(canvas: any): string | null {
  const selected = Array.from(canvas?.selection?.values?.() ?? []) as any[];
  if (selected.length !== 1) return null;
  const id = selected[0]?.id ?? selected[0]?.getData?.()?.id;
  return typeof id === "string" && canvas?.nodes?.has?.(id) ? id : null;
}

function nodeElement(canvas: any, nodeId: string): HTMLElement | null {
  const node = canvas?.nodes?.get?.(nodeId);
  const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
  return element instanceof HTMLElement ? element : null;
}

function nodeFromData(canvas: any, nodeId: string): CanvasNodeData | undefined {
  return readCanvasData(canvas).nodes.find(node => node.id === nodeId);
}

function styleOf(node: CanvasNodeData): { color: string; shape: string; border: string; align: string } {
  const styleAttributes = node.styleAttributes && typeof node.styleAttributes === "object"
    ? node.styleAttributes as Record<string, unknown>
    : {};
  return {
    color: typeof node.color === "string" ? node.color : "",
    shape: resolveCanvasNodeShape(node),
    border: resolveCanvasNodeBorder(node),
    align: typeof node.bcTextAlign === "string"
      ? node.bcTextAlign
      : typeof styleAttributes.textAlign === "string" ? styleAttributes.textAlign : "left"
  };
}

function addButton(
  parent: HTMLElement,
  label: string,
  className: string,
  action: (event: MouseEvent) => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.setAttribute("aria-label", label);
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
  private readonly patchedMenus = new Map<any, PopupPatch>();
  private activePanel: ActivePanel | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  start(): void {
    const workspace = this.plugin.app.workspace as any;
    this.plugin.registerEvent(workspace.on("layout-change", () => this.scanCanvases()));
    this.plugin.registerEvent(workspace.on("active-leaf-change", () => this.scanCanvases()));
    workspace.onLayoutReady(() => this.scanCanvases());
    this.plugin.register(() => this.stop());
    this.scanCanvases();
  }

  stop(): void {
    this.dismissPanel(false);
    for (const record of this.patchedMenus.values()) {
      if (record.menu.render !== record.wrapper) continue;
      if (record.hadOwnRender) record.menu.render = record.original;
      else delete record.menu.render;
    }
    this.patchedMenus.clear();
  }

  openStyleFromContextMenu(canvas: any, nodeId: string): void {
    const element = nodeElement(canvas, nodeId);
    if (!element || !nodeFromData(canvas, nodeId)) {
      new Notice("目标节点已不存在，无法打开样式面板。");
      return;
    }
    const rect = element.getBoundingClientRect();
    this.showStylePanel(canvas, nodeId, "context", { x: rect.right + 8, y: rect.top });
  }

  private scanCanvases(): void {
    const workspace = this.plugin.app.workspace as any;
    for (const leaf of workspace.getLeavesOfType?.("canvas") ?? []) {
      const canvas = leaf?.view?.canvas;
      if (canvas) this.patchCanvasMenu(canvas);
    }
  }

  private patchCanvasMenu(canvas: any): void {
    const menu = canvas?.menu;
    if (!menu || typeof menu.render !== "function" || !(menu.menuEl instanceof HTMLElement)) return;
    if (this.patchedMenus.has(menu)) return;

    const original = menu.render as (...args: any[]) => any;
    const hadOwnRender = Object.prototype.hasOwnProperty.call(menu, "render");
    const integration = this;
    const wrapper = function(this: any, ...args: any[]): any {
      const result = original.apply(this, args);
      integration.renderPopupToolbar(canvas, menu);
      return result;
    };

    try {
      menu.render = wrapper;
      this.patchedMenus.set(menu, { menu, original, wrapper, hadOwnRender });
    } catch {
      // If a future host version seals this internal object, retain native behavior.
    }
  }

  private renderPopupToolbar(canvas: any, menu: any): void {
    const popupEl = menu?.menuEl;
    if (!(popupEl instanceof HTMLElement)) return;
    if (this.activePanel?.source === "toolbar" && this.activePanel.popupEl === popupEl) return;

    const nodeId = selectedNodeId(canvas);
    if (!nodeId || !nodeFromData(canvas, nodeId)) {
      popupEl.classList.remove("bc-node-popup-menu", "bc-node-style-view", "bc-node-popup-dismissed");
      return;
    }

    popupEl.classList.remove("bc-node-popup-dismissed", "bc-node-style-view");
    popupEl.classList.add("bc-node-popup-menu");
    popupEl.replaceChildren();

    addButton(popupEl, "样式", "bc-node-toolbar-button", () => {
      const rect = popupEl.getBoundingClientRect();
      this.showStylePanel(canvas, nodeId, "toolbar", { x: rect.left, y: rect.top }, popupEl);
    });
    addButton(popupEl, "更多 ⋯", "bc-node-toolbar-button", event => {
      const rect = popupEl.getBoundingClientRect();
      this.openNativeContextMenu(canvas, nodeId, {
        x: event.clientX || rect.right,
        y: event.clientY || rect.bottom
      });
    });
  }

  private showStylePanel(
    canvas: any,
    nodeId: string,
    source: PanelSource,
    anchor: { x: number; y: number },
    popupEl?: HTMLElement
  ): void {
    this.dismissPanel(false);

    let surface: HTMLElement;
    if (source === "toolbar" && popupEl) {
      surface = popupEl;
      surface.classList.add("bc-node-popup-menu", "bc-node-style-view");
      surface.classList.remove("bc-node-popup-dismissed");
    } else {
      surface = document.createElement("div");
      surface.className = "bc-node-style-popover";
      document.body.appendChild(surface);
      this.positionPopover(surface, anchor);
    }

    const active: ActivePanel = {
      canvas,
      nodeId,
      source,
      surface,
      ...(popupEl ? { popupEl } : {}),
      anchor,
      outsideHandler: () => undefined,
      keyHandler: () => undefined
    };
    active.outsideHandler = event => {
      if (!surface.contains(event.target as Node)) this.dismissPanel(false);
    };
    active.keyHandler = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.dismissPanel(false);
    };
    this.activePanel = active;
    document.addEventListener("pointerdown", active.outsideHandler, true);
    document.addEventListener("keydown", active.keyHandler, true);
    this.renderStylePanel();
  }

  private positionPopover(surface: HTMLElement, anchor: { x: number; y: number }): void {
    const width = Math.min(332, Math.max(240, window.innerWidth - 24));
    const panelHeight = Math.min(640, window.innerHeight - 24);
    const left = Math.max(12, Math.min(anchor.x, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(anchor.y, window.innerHeight - panelHeight - 12));
    surface.style.left = left + "px";
    surface.style.top = top + "px";
    surface.style.width = width + "px";
  }

  private dismissPanel(restoreToolbar: boolean): void {
    const active = this.activePanel;
    if (!active) return;
    document.removeEventListener("pointerdown", active.outsideHandler, true);
    document.removeEventListener("keydown", active.keyHandler, true);
    this.activePanel = null;

    if (active.source === "toolbar" && active.popupEl) {
      if (restoreToolbar) this.renderPopupToolbar(active.canvas, { menuEl: active.popupEl });
      else {
        active.popupEl.replaceChildren();
        active.popupEl.classList.remove("bc-node-style-view");
        active.popupEl.classList.add("bc-node-popup-dismissed");
      }
    } else {
      active.surface.remove();
    }
  }

  private openNativeContextMenu(canvas: any, nodeId: string, point: { x: number; y: number }): void {
    const element = nodeElement(canvas, nodeId);
    if (!element) {
      new Notice("目标节点已不存在，无法打开菜单。");
      return;
    }
    if (this.activePanel) this.dismissPanel(false);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      clientX: point.x,
      clientY: point.y
    });
    element.dispatchEvent(event);
  }

  private applyStyle(patch: NodeVisualStylePatch, focusKey: string): void {
    const active = this.activePanel;
    if (!active) return;
    const { canvas, nodeId } = active;
    if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式，无法更改节点样式。");
      return;
    }

    const current = readCanvasData(canvas);
    const result = applyNodeVisualStyle(current, [nodeId], patch);
    if (result.updated === 0) {
      new Notice("目标节点已不存在，未应用样式。");
      this.dismissPanel(false);
      return;
    }

    try {
      canvas.importData(result.data);
      canvas.requestSave?.();
      canvas.requestFrame?.();
      decorateCanvas(canvas);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "应用节点样式失败。");
      return;
    }

    this.renderStylePanel(focusKey);
  }

  private renderStylePanel(focusKey?: string): void {
    const active = this.activePanel;
    if (!active) return;
    const node = nodeFromData(active.canvas, active.nodeId);
    if (!node) {
      this.dismissPanel(false);
      new Notice("目标节点已不存在，样式面板已关闭。");
      return;
    }

    const currentStyle = styleOf(node);
    const surface = active.surface;
    surface.replaceChildren();
    if (active.source === "context") surface.classList.add("bc-node-style-popover");
    else surface.classList.add("bc-node-popup-menu", "bc-node-style-view");

    const header = document.createElement("div");
    header.className = "bc-node-style-header";
    addButton(header, "← 返回", "bc-node-style-back", () => {
      const source = active.source;
      const canvas = active.canvas;
      const nodeId = active.nodeId;
      const anchor = active.anchor;
      const popupEl = active.popupEl;
      this.dismissPanel(source === "toolbar");
      if (source === "context") this.openNativeContextMenu(canvas, nodeId, anchor);
      else if (popupEl) this.renderPopupToolbar(canvas, { menuEl: popupEl });
    });
    const heading = document.createElement("strong");
    heading.textContent = "节点样式";
    header.appendChild(heading);
    surface.appendChild(header);

    const body = document.createElement("div");
    body.className = "bc-node-style-scroll";
    surface.appendChild(body);

    const addSection = (label: string): HTMLElement => {
      const section = document.createElement("section");
      section.className = "bc-node-style-section";
      const title = document.createElement("div");
      title.className = "bc-node-style-section-title";
      title.textContent = label;
      section.appendChild(title);
      body.appendChild(section);
      return section;
    };

    const colorSection = addSection("颜色");
    const colors = document.createElement("div");
    colors.className = "bc-node-style-colors";
    colorSection.appendChild(colors);
    for (const color of NODE_STYLE_COLORS) {
      const selected = currentStyle.color.toLowerCase() === color.value.toLowerCase();
      const button = addButton(colors, "", "bc-node-style-color" + (selected ? " is-selected" : ""), () => {
        this.applyStyle({ color: color.value }, "color-" + color.id);
      });
      button.dataset.styleOption = "color-" + color.id;
      button.title = color.label;
      button.setAttribute("aria-label", color.label);
      button.setAttribute("aria-pressed", String(selected));
      const swatch = document.createElement("span");
      swatch.className = "bc-node-style-swatch";
      swatch.style.backgroundColor = color.value;
      button.appendChild(swatch);
      const label = document.createElement("span");
      label.className = "bc-node-style-option-label";
      label.textContent = color.label;
      button.appendChild(label);
    }

    const shapeSection = addSection("形状");
    const shapes = document.createElement("div");
    shapes.className = "bc-node-style-shapes";
    shapeSection.appendChild(shapes);
    for (const shape of NODE_STYLE_SHAPES) {
      const selected = currentStyle.shape === shape.id;
      const button = addButton(shapes, "", "bc-node-style-choice" + (selected ? " is-selected" : ""), () => {
        this.applyStyle({ shape: shape.id }, "shape-" + shape.id);
      });
      button.dataset.styleOption = "shape-" + shape.id;
      button.title = shape.label;
      button.setAttribute("aria-label", shape.label);
      button.setAttribute("aria-pressed", String(selected));
      const preview = document.createElement("span");
      preview.className = "bc-node-shape-preview shape-" + shape.id;
      button.appendChild(preview);
      const label = document.createElement("span");
      label.className = "bc-node-style-option-label";
      label.textContent = shape.label;
      button.appendChild(label);
    }

    const borderSection = addSection("边框");
    const borders = document.createElement("div");
    borders.className = "bc-node-style-borders";
    borderSection.appendChild(borders);
    for (const border of NODE_STYLE_BORDERS) {
      const selected = currentStyle.border === border.id ||
        (border.id === "invisible" && currentStyle.border === "none");
      const button = addButton(borders, "", "bc-node-style-choice" + (selected ? " is-selected" : ""), () => {
        this.applyStyle({ border: border.id }, "border-" + border.id);
      });
      button.dataset.styleOption = "border-" + border.id;
      button.title = border.label;
      button.setAttribute("aria-label", border.label);
      button.setAttribute("aria-pressed", String(selected));
      const sample = document.createElement("span");
      sample.className = "bc-node-border-preview border-" + border.id;
      button.appendChild(sample);
      const label = document.createElement("span");
      label.className = "bc-node-style-option-label";
      label.textContent = border.label;
      button.appendChild(label);
    }

    const alignSection = addSection("文本对齐");
    const alignments = document.createElement("div");
    alignments.className = "bc-node-style-alignments";
    alignSection.appendChild(alignments);
    for (const align of NODE_STYLE_ALIGNMENTS) {
      const selected = currentStyle.align === align.id;
      const button = addButton(alignments, align.label, "bc-node-style-choice" + (selected ? " is-selected" : ""), () => {
        this.applyStyle({ align: align.id }, "align-" + align.id);
      });
      button.dataset.styleOption = "align-" + align.id;
      button.setAttribute("aria-pressed", String(selected));
    }

    const presetSection = addSection("预设");
    const presets = document.createElement("div");
    presets.className = "bc-node-style-presets";
    presetSection.appendChild(presets);
    const presetNames: Record<string, string> = { flow: "Flow", focus: "Focus", warning: "Warning / Risk" };
    for (const id of Object.keys(NODE_STYLE_PRESETS)) {
      const preset = NODE_STYLE_PRESETS[id];
      const button = addButton(presets, presetNames[id] ?? id, "bc-node-style-preset", () => {
        this.applyStyle({ color: preset.color, shape: preset.shape, border: preset.border, align: preset.align }, "preset-" + id);
      });
      button.dataset.styleOption = "preset-" + id;
      button.setAttribute("aria-pressed", String(
        currentStyle.color.toLowerCase() === preset.color.toLowerCase() &&
        currentStyle.shape === preset.shape &&
        currentStyle.border === preset.border &&
        currentStyle.align === preset.align
      ));
    }

    const footer = document.createElement("div");
    footer.className = "bc-node-style-footer";
    addButton(footer, "重置", "bc-node-style-reset", () => {
      this.applyStyle({
        color: DEFAULT_NODE_VISUAL_STYLE.color,
        shape: DEFAULT_NODE_VISUAL_STYLE.shape,
        border: DEFAULT_NODE_VISUAL_STYLE.border,
        align: DEFAULT_NODE_VISUAL_STYLE.align
      }, "reset");
    });
    addButton(footer, "完成", "bc-node-style-done mod-cta", () => this.dismissPanel(false));
    surface.appendChild(footer);

    if (active.source === "context") this.positionPopover(surface, active.anchor);
    if (focusKey) {
      const selector = '[data-style-option="' + focusKey + '"]';
      surface.querySelector<HTMLElement>(selector)?.focus();
    }
  }
}
