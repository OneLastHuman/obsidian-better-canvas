import { Modal, Notice, setIcon, type App, type Plugin } from "obsidian";
import { readCanvasData } from "./canvas";
import { clearSketchCanvas } from "./sketch-renderer";
import { SKETCH_FONT_CSS } from "./sketch-font";
import { decorateCanvasTheme, resolveCanvasTheme, setCanvasTheme, type CanvasThemeId } from "./canvas-theme";
import { clearRoundedMapNode, roundedMapCss } from "./rounded-map-style";
import { ROUNDED_MAP_PRESETS } from "./node-visual-style";

/**
 * Mirrors Obsidian's native control markup (a `div.canvas-control-item`) rather
 * than a `<button>`, so the entry inherits the same 32px box, 8px padding and
 * muted icon colour as the neighbouring Canvas controls.
 */
export function createThemeControl(): HTMLElement {
  const control = document.createElement("div");
  control.className = "canvas-control-item bc-theme-control-button";
  control.setAttribute("role", "button");
  control.setAttribute("tabindex", "0");
  control.setAttribute("aria-haspopup", "dialog");
  control.setAttribute("data-tooltip-position", "left");
  setIcon(control, "wallpaper");
  return control;
}

const EDITOR_STYLE_ID = "bc-scrapbook-editor";
const SKETCH_EDITOR_STYLE_ID = "bc-sketch-editor";
const FONT_STYLE_ID = "bc-sketch-font";
const ROUNDED_EDITOR_STYLE_ID = "bc-rounded-map-editor";
const EDITOR_CSS = `
body { color-scheme: light; --background-primary: #fff8e8; --background-secondary: #f2e7d2;
  --text-normal: #43372f; --text-muted: #766758; --text-faint: #8c7b68;
  --text-accent: #956247; --text-accent-hover: #70452f; --color-accent: #a16d50;
  --code-background: #eadfc9; --code-normal: #614b3e; --background-modifier-border: #ccbba1;
  --text-selection: #e2c99c; color: #43372f; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #43372f; }
`;

function sketchEditorCss(): string {
  return SKETCH_FONT_CSS + `
body { color-scheme: light; --background-primary: #fffefb; --background-secondary: #f4f3ee;
  --text-normal: #262520; --text-muted: #696b65; --text-faint: #8a8b84;
  --text-accent: #6554c0; --text-accent-hover: #4f3fa5; --color-accent: #6554c0;
  --code-background: #f1f0ea; --code-normal: #45443e; --background-modifier-border: #d9d8cf;
  --text-selection: #ddd6ff; color: #262520; background: transparent;
  font-family: "BC Sketch Hand", "Segoe Print", cursive; font-weight: 600; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #262520; }
.markdown-preview-view, .markdown-source-view, .cm-content, .inline-title {
  font-family: "BC Sketch Hand", "Segoe Print", cursive; font-weight: 600; }
`;
}

class CanvasThemeModal extends Modal {
  constructor(app: App, private readonly canvas: any, private readonly changed: () => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("bc-theme-modal");
    this.titleEl.setText("画布主题");
    this.contentEl.createEl("p", { cls: "bc-theme-intro", text: "为这一张画布，挑一种质感。" });
    const choices = this.contentEl.createDiv({ cls: "bc-theme-choices" });
    const current = resolveCanvasTheme(readCanvasData(this.canvas));
    const themes: Array<{ id: CanvasThemeId; title: string; detail: string }> = [
      { id: "default", title: "默认", detail: "跟随 Obsidian · 清晰简洁" },
      { id: "scrapbook", title: "拼贴手账", detail: "暖纸 · 胶带 · 收藏灵感" },
      { id: "sketch", title: "手绘白板", detail: "白纸 · 手绘线 · 功能预设" },
      { id: "rounded-map", title: "软糖白板", detail: "大圆角 · 粗描边 · 六种功能形状" }
    ];
    for (const theme of themes) {
      const button = choices.createEl("button", { cls: "bc-theme-choice" });
      button.type = "button";
      button.dataset.themeChoice = theme.id;
      button.setAttribute("aria-pressed", String(current === theme.id));
      const board = button.createDiv({ cls: "bc-theme-mini-board" });
      board.dataset.bcTheme = theme.id;
      board.setAttribute("aria-hidden", "true");
      board.createSpan({
        cls: "bc-theme-mini-caption",
        text: theme.id === "scrapbook" ? "little things, kept."
          : theme.id === "sketch" ? "think in ink." : theme.id === "rounded-map" ? "connect the ideas."
            : "A space to think."
      });
      // createElementNS is necessary for SVG in Obsidian's HTML helpers.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 240 140");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", theme.id === "sketch"
        ? "M74 72 C116 64 101 106 157 99 M149 93 L158 99 L150 106"
        : "M82 67 C125 60 100 104 152 100 M145 94 L153 100 L146 106");
      svg.appendChild(path);
      board.appendChild(svg);
      if (theme.id === "rounded-map") {
        for (const preset of ROUNDED_MAP_PRESETS.slice(0, 3)) {
          const sample = board.createSpan({ cls: "bc-rounded-preview bc-mini-rounded-" + preset.id });
          for (const [key, value] of Object.entries(roundedMapCss(preset.style.shape, 88, 54))) sample.style.setProperty(key, value);
          sample.style.setProperty("--bc-rounded-fill", preset.style.color);
          sample.createSpan({ text: preset.sample });
        }
      } else if (theme.id === "sketch") {
        for (const [kind, text] of [["concept", "想法"], ["action", "下一步"], ["risk", "待确认"]]) {
          const sample = board.createSpan({ cls: "bc-sketch-mini bc-mini-" + kind, text });
          sample.dataset.bcSketchPreview = kind;
        }
      } else {
        for (const [kind, text] of [["tape", "灵感"], ["lined", "记录"], ["label", "收藏"]]) {
          const paper = board.createSpan({ cls: "bc-paper-preview bc-mini-" + kind, text });
          paper.dataset.bcPaper = kind;
        }
      }
      const label = button.createDiv({ cls: "bc-theme-choice-label" });
      label.createEl("strong", { text: theme.title });
      if (current === theme.id) label.createSpan({ cls: "bc-theme-current", text: "使用中" });
      button.createDiv({ cls: "bc-theme-choice-detail", text: theme.detail });
      button.addEventListener("click", () => {
        if (this.canvas?.readonly || this.canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
          new Notice("当前 Canvas 处于只读模式，无法切换主题。");
          return;
        }
        setCanvasTheme(this.canvas, theme.id);
        this.changed();
        this.close();
      });
    }
    this.contentEl.createEl("p", { cls: "bc-theme-footnote", text: "主题随画布保存。在「节点样式」中选择主题的功能预设。" });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Coordinates view lifetime, native history events and same-origin editors. */
export default class CanvasThemeController {
  private readonly controls = new Map<any, HTMLElement>();
  private readonly decoratedCanvases = new Set<any>();
  private pendingFrame: number | null = null;
  private modal: CanvasThemeModal | null = null;
  private stopped = false;

  constructor(private readonly plugin: Plugin) {}

  start(): void {
    this.ensureFont();
    const workspace = this.plugin.app.workspace as any;
    for (const name of ["layout-change", "active-leaf-change", "css-change", "advanced-canvas:data-loaded:after",
      "advanced-canvas:node-added", "advanced-canvas:node-changed", "advanced-canvas:node-editing-state-changed",
      "advanced-canvas:canvas-changed", "advanced-canvas:viewport-changed:after"]) {
      this.plugin.registerEvent(workspace.on(name, () => this.schedule()));
    }
    workspace.onLayoutReady(() => this.schedule());
    this.plugin.registerDomEvent(document, "load", event => {
      const target = event.target;
      if (target instanceof HTMLIFrameElement && target.closest(".canvas-wrapper")) this.schedule();
    }, true);
    this.plugin.addCommand({
      id: "choose-canvas-theme", name: "切换当前画布主题",
      checkCallback: (checking: boolean) => {
        const view = workspace.activeLeaf?.view;
        if (view?.getViewType?.() !== "canvas" || !view.canvas) return false;
        if (!checking) this.open(view.canvas);
        return true;
      }
    });
    this.plugin.register(() => this.stop());
    this.schedule();
  }

  private open(canvas: any): void {
    this.modal?.close();
    this.modal = new CanvasThemeModal(this.plugin.app, canvas, () => {
      this.scan();
      (this.plugin.app.workspace as any).trigger("better-canvas:theme-changed");
    });
    this.modal.open();
  }

  /** The font is embedded in main.js; inject it once for Canvas and editor iframes. */
  private ensureFont(): void {
    if (!SKETCH_FONT_CSS) return;
    const head = (globalThis as any).document?.head;
    if (!head || typeof document === "undefined") return;
    if (document.getElementById(FONT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = SKETCH_FONT_CSS;
    head.appendChild(style);
  }

  private schedule(): void {
    if (this.stopped || this.pendingFrame !== null) return;
    this.pendingFrame = window.requestAnimationFrame(() => {
      this.pendingFrame = null;
      this.scan();
    });
  }

  private scan(): void {
    if (this.stopped) return;
    const live = new Set<any>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const view = leaf.view as any;
      const canvas = view.canvas;
      if (!canvas) continue;
      live.add(canvas);
      this.decoratedCanvases.add(canvas);
      decorateCanvasTheme(canvas);
      const theme = resolveCanvasTheme(readCanvasData(canvas));
      this.syncEditors(canvas, theme);
      const stack = view.containerEl?.querySelector(".canvas-controls");
      if (!stack) continue;
      let group = this.controls.get(canvas);
      if (group && !stack.contains(group)) {
        group.remove();
        this.controls.delete(canvas);
        group = undefined;
      }
      if (!group) {
        group = document.createElement("div");
        group.className = "canvas-control-group mod-raised bc-theme-control";
        const control = createThemeControl();
        const activate = (event: Event): void => {
          event.preventDefault();
          event.stopPropagation();
          this.open(canvas);
        };
        control.addEventListener("click", activate);
        control.addEventListener("keydown", (event: KeyboardEvent) => {
          if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
          activate(event);
        });
        group.appendChild(control);
        stack.insertBefore(group, stack.firstChild);
        this.controls.set(canvas, group);
      }
      const control = group.firstElementChild as HTMLElement;
      const themeName = theme === "scrapbook" ? "拼贴手账" : theme === "sketch" ? "手绘白板" : theme === "rounded-map" ? "软糖白板" : "默认";
      control.setAttribute("aria-label", "画布主题 · " + themeName);
    }
    for (const [canvas, group] of this.controls) {
      if (live.has(canvas)) continue;
      group.remove();
      this.controls.delete(canvas);
    }
    for (const canvas of this.decoratedCanvases) {
      if (live.has(canvas)) continue;
      this.clearDecoration(canvas);
      this.decoratedCanvases.delete(canvas);
    }
  }

  private syncEditors(canvas: any, theme: CanvasThemeId): void {
    for (const iframe of canvas.wrapperEl?.querySelectorAll("iframe.canvas-node-iframe, .markdown-embed iframe.embed-iframe.is-controlled") ?? []) {
      try {
        const doc = (iframe as HTMLIFrameElement).contentDocument;
        if (!doc?.head) continue;
        const scrapbook = doc.getElementById(EDITOR_STYLE_ID);
        const sketch = doc.getElementById(SKETCH_EDITOR_STYLE_ID);
        const rounded = doc.getElementById(ROUNDED_EDITOR_STYLE_ID);
        if (theme === "rounded-map") {
          scrapbook?.remove();
          sketch?.remove();
          const style = rounded ?? doc.createElement("style");
          style.id = ROUNDED_EDITOR_STYLE_ID;
          const dark = canvas.wrapperEl.ownerDocument?.body.classList.contains("theme-dark");
          const ink = dark ? "#20262d" : "#34372f";
          const css = `body { color-scheme: light; --text-normal: ${ink}; --text-muted: #515b60; --text-faint: #6c747c; --text-accent: #315b86; --text-accent-hover: #24486b; --background-primary: #e5e7e1; --background-secondary: #d7dbd5; --code-background: #d7dbd5; --code-normal: ${ink}; --text-selection: #a9c3d8; color: ${ink}; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: ${ink}; }`;
          if (style.textContent !== css) style.textContent = css;
          if (!rounded) doc.head.appendChild(style);
          continue;
        }
        rounded?.remove();
        if (theme === "default") {
          scrapbook?.remove();
          sketch?.remove();
          continue;
        }
        const styleId = theme === "scrapbook" ? EDITOR_STYLE_ID : SKETCH_EDITOR_STYLE_ID;
        if (doc.getElementById(styleId)) {
          (theme === "scrapbook" ? sketch : scrapbook)?.remove();
          continue;
        }
        scrapbook?.remove();
        sketch?.remove();
        const style = doc.createElement("style");
        style.id = styleId;
        style.textContent = theme === "scrapbook" ? EDITOR_CSS : sketchEditorCss();
        doc.head.appendChild(style);
      } catch { /* Remote embeds are not editing surfaces. */ }
    }
  }

  private stop(): void {
    this.stopped = true;
    if (this.pendingFrame !== null) window.cancelAnimationFrame(this.pendingFrame);
    this.modal?.close();
    for (const group of this.controls.values()) group.remove();
    for (const canvas of this.decoratedCanvases) this.clearDecoration(canvas);
    this.controls.clear();
    this.decoratedCanvases.clear();
  }

  private clearDecoration(canvas: any): void {
    if (canvas.wrapperEl?.dataset) delete canvas.wrapperEl.dataset.bcTheme;
    clearSketchCanvas(canvas);
    for (const node of canvas.nodes?.values?.() ?? []) {
      clearRoundedMapNode(node?.nodeEl ?? node?.containerEl ?? node?.el);
    }
    for (const el of canvas.wrapperEl?.querySelectorAll("[data-bc-paper]") ?? []) {
      delete el.dataset.bcPaper;
      delete el.dataset.bcPaperBorder;
    }
    this.syncEditors(canvas, "default");
  }
}
