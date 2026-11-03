import { Modal, Notice, setIcon, type App, type Plugin } from "obsidian";
import { readCanvasData } from "./canvas";
import { clearSketchCanvas } from "./sketch-renderer";
import { SKETCH_FONT_CSS } from "./sketch-font";
import { SOFT_NOTES_FONT_CSS } from "./soft-notes-font";
import { clearSoftNotesNode, ensureSoftNotesGeometry, softNotesClip, softNotesPreset } from "./soft-notes-style";
import { clearResearchNode, RESEARCH_SERIF } from "./research-style";
import { decorateCanvasTheme, resolveCanvasTheme, setCanvasTheme, type CanvasThemeId } from "./canvas-theme";
import { clearRoundedMapNode, roundedMapCss, stopRoundedMapGeometry } from "./rounded-map-style";
import { ROUNDED_MAP_PRESETS } from "./node-visual-style";
import { t } from "./i18n";

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
const SOFT_EDITOR_STYLE_ID = "bc-soft-notes-editor";
const RESEARCH_EDITOR_STYLE_ID = "bc-research-editor";
const FONT_STYLE_ID = "bc-sketch-font";
const ROUNDED_EDITOR_STYLE_ID = "bc-rounded-map-editor";

interface AdoptedSheetRecord {
  sheet: CSSStyleSheet;
  key: string;
}

const adoptedSheets = new WeakMap<Document, Map<string, AdoptedSheetRecord>>();

function setAdoptedStylesheet(doc: Document, id: string, css: string, key = css): void {
  let records = adoptedSheets.get(doc);
  if (!records) {
    records = new Map();
    adoptedSheets.set(doc, records);
  }
  const existing = records.get(id);
  if (existing) {
    if (existing.key === key) return;
    existing.sheet.replaceSync(css);
    existing.key = key;
    return;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  doc.adoptedStyleSheets.push(sheet);
  records.set(id, { sheet, key });
}

function removeAdoptedStylesheet(doc: Document, id: string): void {
  const records = adoptedSheets.get(doc);
  const record = records?.get(id);
  if (!record) return;
  const index = doc.adoptedStyleSheets.indexOf(record.sheet);
  if (index >= 0) doc.adoptedStyleSheets.splice(index, 1);
  records?.delete(id);
}

const EDITOR_CSS = `
body { color-scheme: light; --background-primary: #fff8e8; --background-secondary: #f2e7d2;
  --text-normal: #43372f; --text-muted: #766758; --text-faint: #8c7b68;
  --text-accent: #956247; --text-accent-hover: #70452f; --color-accent: #a16d50;
  --code-background: #eadfc9; --code-normal: #614b3e; --background-modifier-border: #ccbba1;
  --text-selection: #e2c99c; color: #43372f; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #43372f; }
/* CodeMirror paints text nodes inside .cm-content, which the rules above do not reach.
   This sheet is adopted by the iframe document, so it loses to selectors with more
   specificity in the host CSS; !important is what keeps the ink readable on paper. */
.cm-content { color: #43372f !important; caret-color: #43372f; }
`;
const RESEARCH_EDITOR_CSS = `
body { color-scheme: light; --background-primary: #fffdf7; --background-secondary: #eeece5;
  --text-normal: #303831; --text-muted: #65705b; --text-faint: #85877c;
  --text-accent: #416879; --text-accent-hover: #304f5c; --color-accent: #a84e34;
  --code-background: #eeece5; --code-normal: #303831; --background-modifier-border: #d9d9ce;
  --text-selection: #e9d791; color: #303831; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #303831; }
.markdown-preview-view, .cm-content { font-family: ${RESEARCH_SERIF}; line-height: 1.9; }
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

function softNotesEditorCss(preset = "", align = "left"): string {
  return SKETCH_FONT_CSS + SOFT_NOTES_FONT_CSS + `
body { color-scheme: light; --text-normal: #292e28; --text-muted: #78816e;
  --background-primary: transparent; --background-secondary: #f1f3e9;
  --text-accent: #61744e; --text-selection: #d6e6c7; color: #292e28; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: #292e28; }
.markdown-preview-view, .markdown-source-view, .cm-content {
  font-family: "BC Sketch Hand", cursive; font-size: ${preset === "free" ? 16 : 18}px; line-height: 1.65;
  text-align: ${align === "center" || align === "right" ? align : "left"}; }
:is(h1,h2,h3,h4,h5,h6,.cm-header) { font-family: "BC Soft Notes Title", cursive !important; font-weight: 400; }
.cm-header { font-size: ${preset === "free" ? 42 : 28}px; }
`;
}

function roundedEditorCss(appearance: "dark" | "light"): string {
  const ink = appearance === "dark" ? "#20262d" : "#34372f";
  return `body { color-scheme: light; --text-normal: ${ink}; --text-muted: #515b60; --text-faint: #6c747c; --text-accent: #315b86; --text-accent-hover: #24486b; --background-primary: #e5e7e1; --background-secondary: #d7dbd5; --code-background: #d7dbd5; --code-normal: ${ink}; --text-selection: #a9c3d8; color: ${ink}; background: transparent; }
.markdown-source-view, .cm-editor, .cm-scroller { background: transparent !important; color: ${ink}; }`;
}

class CanvasThemeModal extends Modal {
  constructor(app: App, private readonly canvas: any, private readonly changed: () => void) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("bc-theme-modal");
    this.titleEl.setText(t("Canvas theme", "画布主题"));
    this.contentEl.createEl("p", { cls: "bc-theme-intro", text: t("Pick a feel for this Canvas.", "为这一张画布，挑一种质感。") });
    const choices = this.contentEl.createDiv({ cls: "bc-theme-choices" });
    const current = resolveCanvasTheme(readCanvasData(this.canvas));
    const themes: Array<{ id: CanvasThemeId; title: string; detail: string }> = [
      { id: "default", title: t("Default", "默认"), detail: t("Follows Obsidian · clean and simple", "跟随 Obsidian · 清晰简洁") },
      { id: "scrapbook", title: t("Scrapbook", "拼贴手账"), detail: t("Warm paper · tape · collected inspiration", "暖纸 · 胶带 · 收藏灵感") },
      { id: "sketch", title: t("Hand-drawn Whiteboard", "手绘白板"), detail: t("White paper · hand-drawn lines · presets", "白纸 · 手绘线 · 功能预设") },
      { id: "rounded-map", title: t("Gummy Whiteboard", "软糖白板"), detail: t("Large radii · thick strokes · six functional shapes", "大圆角 · 粗描边 · 六种功能形状") },
      { id: "research", title: t("Paper Research", "纸本研究"), detail: t("Sources · citations · careful layout", "资料 · 引文 · 严谨编排") },
      { id: "soft-notes", title: t("Soft Notes", "柔软便签"), detail: t("Soft pastels · gentle curves · free text", "浅粉彩 · 柔软曲线 · 自由文字") }
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
        text: theme.id === "scrapbook" ? t("little things, kept.", "把小事留存下来。")
          : theme.id === "sketch" ? t("think in ink.", "用墨水思考。")
          : theme.id === "rounded-map" ? t("connect the ideas.", "把想法连起来。")
          : theme.id === "research" ? t("Let the sources start a conversation.", "让资料开始对话")
          : theme.id === "soft-notes" ? t("Let ideas grow freely.", "让想法自由生长")
            : t("A space to think.", "一个思考的空间。")
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
      if (theme.id === "soft-notes") {
        ensureSoftNotesGeometry(document);
        for (const [kind, text] of [["spark", t("Inspiration", "灵感")], ["action", t("Take it slow", "慢慢做")], ["question", t("Want to try more", "还想试试")]]) {
          const preset = softNotesPreset(kind);
          const sample = board.createSpan({ cls: "bc-soft-mini bc-mini-" + kind, text });
          sample.style.setProperty("--bc-soft-clip", softNotesClip(preset));
          sample.style.setProperty("--bc-soft-color", preset.color);
        }
      } else if (theme.id === "rounded-map") {
        for (const preset of ROUNDED_MAP_PRESETS.slice(0, 3)) {
          const sample = board.createSpan({ cls: "bc-rounded-preview bc-mini-rounded-" + preset.id });
          for (const [key, value] of Object.entries(roundedMapCss(preset.style.shape, 88, 54))) sample.style.setProperty(key, value);
          sample.style.setProperty("--bc-rounded-fill", preset.style.color);
          sample.createSpan({ text: preset.sample });
        }
      } else if (theme.id === "sketch") {
        for (const [kind, text] of [["concept", t("Idea", "想法")], ["action", t("Next step", "下一步")], ["risk", t("To confirm", "待确认")]]) {
          const sample = board.createSpan({ cls: "bc-sketch-mini bc-mini-" + kind, text });
          sample.dataset.bcSketchPreview = kind;
        }
      } else if (theme.id === "research") {
        for (const kind of ["source", "quote", "argument"]) {
          const sample = board.createSpan({ cls: "bc-research-preview bc-mini-" + kind });
          sample.dataset.bcResearchPreset = kind;
        }
      } else {
        for (const [kind, text] of [["tape", t("Inspiration", "灵感")], ["lined", t("Note", "记录")], ["label", t("Saved", "收藏")]]) {
          const paper = board.createSpan({ cls: "bc-paper-preview bc-mini-" + kind, text });
          paper.dataset.bcPaper = kind;
        }
      }
      const label = button.createDiv({ cls: "bc-theme-choice-label" });
      label.createEl("strong", { text: theme.title });
      if (current === theme.id) label.createSpan({ cls: "bc-theme-current", text: t("In use", "使用中") });
      button.createDiv({ cls: "bc-theme-choice-detail", text: theme.detail });
      button.addEventListener("click", () => {
        if (this.canvas?.readonly || this.canvas?.wrapperEl?.classList?.contains("bc-readonly")) {
          new Notice(t("This Canvas is in read-only mode; themes cannot be switched.", "当前 Canvas 处于只读模式，无法切换主题。"));
          return;
        }
        setCanvasTheme(this.canvas, theme.id);
        this.changed();
        this.close();
      });
    }
    this.contentEl.createEl("p", { cls: "bc-theme-footnote", text: t("The theme is saved with the Canvas. After choosing a theme, apply the matching presets in “Node style”.", "主题随画布保存。选择主题后，在「节点样式」中应用对应的功能预设。") });
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
      id: "choose-canvas-theme", name: t("Switch Canvas theme", "切换当前画布主题"),
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

  /** The font is embedded in main.js; adopt it once for Canvas and editor iframes. */
  private ensureFont(): void {
    if (!SKETCH_FONT_CSS && !SOFT_NOTES_FONT_CSS || typeof document === "undefined") return;
    document.getElementById?.(FONT_STYLE_ID)?.remove();
    setAdoptedStylesheet(document, FONT_STYLE_ID, SKETCH_FONT_CSS + SOFT_NOTES_FONT_CSS);
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
      const themeName = theme === "scrapbook" ? t("Scrapbook", "拼贴手账") : theme === "sketch" ? t("Hand-drawn Whiteboard", "手绘白板") : theme === "rounded-map" ? t("Gummy Whiteboard", "软糖白板") : theme === "research" ? t("Paper Research", "纸本研究") : theme === "soft-notes" ? t("Soft Notes", "柔软便签") : t("Default", "默认");
      control.setAttribute("aria-label", t("Canvas theme · ", "画布主题 · ") + themeName);
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

  // `contains()` answers false rather than null, so `??` cannot express "either side is
  // dark": an iframe body that has not received `theme-dark` yet would mask a dark host.
  // Read the iframe body first, then fall back to the host body, because Obsidian mirrors
  // `theme-dark` into controlled iframes on `css-change` and that mirror can lag a frame.
  private editorAppearance(iframe: HTMLIFrameElement, doc?: Document | null): "dark" | "light" {
    const iframeDark = doc?.body?.classList?.contains("theme-dark") ?? false;
    const hostDark = iframe.ownerDocument?.body?.classList?.contains("theme-dark") ?? false;
    return iframeDark || hostDark ? "dark" : "light";
  }

  private syncEditors(canvas: any, theme: CanvasThemeId): void {
    for (const iframe of canvas.wrapperEl?.querySelectorAll("iframe.canvas-node-iframe, .markdown-embed iframe.embed-iframe.is-controlled") ?? []) {
      try {
        const frame = iframe as HTMLIFrameElement;
        const doc = frame.contentDocument;
        if (!doc?.head) continue;
        const anchor = frame.closest?.("[data-bc-soft-notes]") as HTMLElement | null;
        const preset = anchor?.dataset.bcSoftNotes ?? "";
        const align = anchor?.style.getPropertyValue("--bc-soft-align") ?? "left";
        // Theme switching is not the only trigger: `css-change` fires on light/dark
        // appearance changes too, so the appearance is part of the key or the
        // adopted sheet keeps the stale look.
        const appearance = this.editorAppearance(frame, doc);
        const ids = [EDITOR_STYLE_ID, SKETCH_EDITOR_STYLE_ID, SOFT_EDITOR_STYLE_ID, RESEARCH_EDITOR_STYLE_ID, ROUNDED_EDITOR_STYLE_ID];
        for (const legacyId of ids) doc.getElementById?.(legacyId)?.remove();
        if (theme === "default") {
          for (const id of ids) removeAdoptedStylesheet(doc, id);
          continue;
        }
        const id = theme === "rounded-map" ? ROUNDED_EDITOR_STYLE_ID
          : theme === "scrapbook" ? EDITOR_STYLE_ID
            : theme === "soft-notes" ? SOFT_EDITOR_STYLE_ID
              : theme === "research" ? RESEARCH_EDITOR_STYLE_ID : SKETCH_EDITOR_STYLE_ID;
        for (const stale of ids) {
          if (stale !== id) removeAdoptedStylesheet(doc, stale);
        }
        const editorKey = theme + ":" + preset + ":" + align + ":" + appearance;
        const css = theme === "rounded-map" ? roundedEditorCss(appearance)
          : theme === "scrapbook" ? EDITOR_CSS
            : theme === "soft-notes" ? softNotesEditorCss(preset, align)
              : theme === "research" ? RESEARCH_EDITOR_CSS : sketchEditorCss();
        setAdoptedStylesheet(doc, id, css, editorKey);
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
    document.getElementById?.("bc-soft-geometry")?.remove();
    removeAdoptedStylesheet(document, FONT_STYLE_ID);
    stopRoundedMapGeometry();
  }

  private clearDecoration(canvas: any): void {
    if (canvas.wrapperEl?.dataset) delete canvas.wrapperEl.dataset.bcTheme;
    clearSketchCanvas(canvas);
    for (const el of canvas.wrapperEl?.querySelectorAll("[data-bc-soft-notes]") ?? []) clearSoftNotesNode(el);
    for (const node of canvas.nodes?.values?.() ?? []) {
      const element = node.nodeEl ?? node.containerEl ?? node.el;
      clearRoundedMapNode(element);
      if (element?.dataset) clearResearchNode(element);
    }
    for (const el of canvas.wrapperEl?.querySelectorAll("[data-bc-paper]") ?? []) {
      delete el.dataset.bcPaper;
      delete el.dataset.bcPaperBorder;
    }
    this.syncEditors(canvas, "default");
  }
}
