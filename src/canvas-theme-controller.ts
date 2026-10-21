import { Modal, Notice, setIcon, type App, type Plugin } from "obsidian";
import { readCanvasData } from "./canvas";
import { decorateCanvasTheme, resolveCanvasTheme, setCanvasTheme, type CanvasThemeId } from "./canvas-theme";

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
const EDITOR_CSS = `
body { color-scheme: light; --background-primary: #fff8e8; --background-secondary: #f2e7d2;
  --text-normal: #43372f; --text-muted: #766758; --text-faint: #8c7b68;
  --text-accent: #956247; --text-accent-hover: #70452f; --color-accent: #a16d50;
  --code-background: #eadfc9; --code-normal: #614b3e; --background-modifier-border: #ccbba1;
  --text-selection: #e2c99c; color: #43372f; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #43372f; }
`;

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
      { id: "scrapbook", title: "拼贴手账", detail: "暖纸 · 胶带 · 收藏灵感" }
    ];
    for (const theme of themes) {
      const button = choices.createEl("button", { cls: "bc-theme-choice" });
      button.type = "button";
      button.dataset.themeChoice = theme.id;
      button.setAttribute("aria-pressed", String(current === theme.id));
      const board = button.createDiv({ cls: "bc-theme-mini-board" });
      board.dataset.bcTheme = theme.id;
      board.setAttribute("aria-hidden", "true");
      board.createSpan({ cls: "bc-theme-mini-caption", text: theme.id === "scrapbook" ? "little things, kept." : "A space to think." });
      // createElementNS is necessary for SVG in Obsidian's HTML helpers.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 240 140");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M82 67 C125 60 100 104 152 100 M145 94 L153 100 L146 106");
      svg.appendChild(path);
      board.appendChild(svg);
      for (const [kind, text] of [["tape", "灵感"], ["lined", "记录"], ["label", "收藏"]]) {
        const paper = board.createSpan({ cls: "bc-paper-preview bc-mini-" + kind, text });
        paper.dataset.bcPaper = kind;
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
    this.contentEl.createEl("p", { cls: "bc-theme-footnote", text: "主题随画布保存。选中卡片后，在「节点样式」中挑选纸片预设。" });
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
    const workspace = this.plugin.app.workspace as any;
    for (const name of ["layout-change", "active-leaf-change", "advanced-canvas:data-loaded:after",
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
      this.syncEditors(canvas, theme === "scrapbook");
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
      control.setAttribute("aria-label", "画布主题 · " + (theme === "scrapbook" ? "拼贴手账" : "默认"));
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

  private syncEditors(canvas: any, enabled: boolean): void {
    for (const iframe of canvas.wrapperEl?.querySelectorAll("iframe.canvas-node-iframe, .markdown-embed iframe.embed-iframe.is-controlled") ?? []) {
      try {
        const doc = (iframe as HTMLIFrameElement).contentDocument;
        if (!doc?.head) continue;
        const previous = doc.getElementById(EDITOR_STYLE_ID);
        if (!enabled) { previous?.remove(); continue; }
        if (previous) continue;
        const style = doc.createElement("style");
        style.id = EDITOR_STYLE_ID;
        style.textContent = EDITOR_CSS;
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
    for (const el of canvas.wrapperEl?.querySelectorAll("[data-bc-paper]") ?? []) {
      delete el.dataset.bcPaper;
      delete el.dataset.bcPaperBorder;
    }
    this.syncEditors(canvas, false);
  }
}
