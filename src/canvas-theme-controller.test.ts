import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setIcon } = vi.hoisted(() => ({ setIcon: vi.fn() }));
vi.mock("obsidian", () => ({ ItemView: class {}, Modal: class {}, Notice: class {}, setIcon }));
vi.mock("./sketch-font", () => ({ SKETCH_FONT_CSS: "/* sketch font */" }));
vi.mock("./soft-notes-font", () => ({ SOFT_NOTES_FONT_CSS: "/* soft font */" }));
import CanvasThemeController, { createThemeControl } from "./canvas-theme-controller";
import type { Plugin } from "obsidian";
import type { CanvasRuntime } from "./canvas-runtime";
import type { CanvasThemeId } from "./canvas-theme";

interface ControllerLifecycle {
  ensureFont(): void;
  syncEditors(canvas: CanvasRuntime, theme: CanvasThemeId): void;
}

function lifecycleController(): ControllerLifecycle {
  // These private lifecycle seams do not access the plugin during fixture checks.
  return new CanvasThemeController({} as Plugin) as unknown as ControllerLifecycle;
}

class FakeStyleSheet {
  cssText = "";
  replaceSync(css: string): void {
    this.cssText = css;
  }
}

beforeEach(() => {
  vi.stubGlobal("CSSStyleSheet", FakeStyleSheet);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Minimal document stand-in that follows the adopted-stylesheet contract
// `syncEditors()` relies on, so per-document sheets are observable via `sheets`.
function fakeEditorCanvas() {
  const sheets: FakeStyleSheet[] = [];
  const classList = () => {
    const set = new Set<string>();
    return {
      add: (name: string) => set.add(name),
      contains: (name: string) => set.has(name),
      toggle: (name: string, force: boolean) => { if (force) set.add(name); else set.delete(name); return force; }
    };
  };
  const ownerDocument = { body: { classList: classList() }, adoptedStyleSheets: [] as FakeStyleSheet[] };
  const contentDocument = {
    head: {},
    documentElement: { classList: classList() },
    body: { classList: classList() },
    adoptedStyleSheets: sheets
  };
  const iframe = { contentDocument, ownerDocument, closest: () => null };
  const canvas: CanvasRuntime = {
    getData: () => ({ nodes: [], edges: [] }),
    importData: vi.fn(),
    wrapperEl: { querySelectorAll: () => [iframe] } as unknown as HTMLElement
  };
  return { sheets, iframe, canvas };
}

describe("Canvas theme lifecycle", () => {
  it("adopts the embedded fonts once per document", () => {
    const doc = { adoptedStyleSheets: [] as FakeStyleSheet[] };
    vi.stubGlobal("document", doc);
    const controller = lifecycleController();
    controller.ensureFont();
    controller.ensureFont();
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(doc.adoptedStyleSheets[0].cssText).toBe("/* sketch font *//* soft font */");
  });

  it("builds an accessible native Canvas control", () => {
    const attributes = new Map<string, string>();
    const created = {
      tagName: "div",
      className: "",
      setAttribute(name: string, value: string) { attributes.set(name, value); },
      getAttribute(name: string) { return attributes.get(name) ?? null; }
    };
    const createDiv = vi.fn(() => created);
    vi.stubGlobal("document", { win: { createDiv } });

    const control = createThemeControl();

    expect(createDiv).toHaveBeenCalledOnce();
    expect(control.getAttribute("role")).toBe("button");
    expect(control.getAttribute("tabindex")).toBe("0");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(setIcon).toHaveBeenCalledWith(control, "wallpaper");
  });

  it("adopts and clears the selected editor theme", () => {
    const { sheets, iframe, canvas } = fakeEditorCanvas();
    const controller = lifecycleController();

    controller.syncEditors(canvas, "scrapbook");

    expect(sheets).toHaveLength(1);
    expect(iframe.contentDocument.documentElement.classList.contains("bc-theme-editor")).toBe(true);
    controller.syncEditors(canvas, "default");
    expect(sheets).toHaveLength(0);
    expect(iframe.contentDocument.documentElement.classList.contains("bc-theme-editor")).toBe(false);
  });

  it("refreshes the editor sheet when only the light/dark appearance changes", () => {
    const { sheets, iframe, canvas } = fakeEditorCanvas();
    const controller = lifecycleController();

    controller.syncEditors(canvas, "rounded-map");
    expect(sheets[0].cssText).toContain("--text-normal: #34372f");

    // Appearance toggles fire `css-change` without changing theme/preset/align, so the
    // sheet must be replaced or the stale ink stays.
    iframe.ownerDocument.body.classList.add("theme-dark");
    iframe.contentDocument.body.classList.add("theme-dark");
    controller.syncEditors(canvas, "rounded-map");

    expect(sheets).toHaveLength(1);
    expect(sheets[0].cssText).toContain("--text-normal: #20262d");
  });

  it("treats a dark host with an un-synced iframe body as dark", () => {
    // The iframe mirror of `theme-dark` lags, so relying on the iframe body alone reads
    // light here; `contains()` returns false, not null, so `??` cannot express the fallback.
    const { sheets, iframe, canvas } = fakeEditorCanvas();
    const controller = lifecycleController();

    iframe.ownerDocument.body.classList.add("theme-dark");
    expect(iframe.contentDocument.body.classList.contains("theme-dark")).toBe(false);
    controller.syncEditors(canvas, "rounded-map");

    expect(sheets).toHaveLength(1);
    expect(sheets[0].cssText).toContain("--text-normal: #20262d");
  });

  it("keeps the existing editor sheet when nothing that affects it changed", () => {
    const { sheets, canvas } = fakeEditorCanvas();
    const controller = lifecycleController();

    controller.syncEditors(canvas, "scrapbook");
    const first = sheets[0];
    const replace = vi.spyOn(first, "replaceSync");
    controller.syncEditors(canvas, "scrapbook");

    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toBe(first);
    expect(replace).not.toHaveBeenCalled();
  });

  it("cleans a decorated canvas and editor even when native controls are unavailable", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("window", { requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: () => undefined });
    const hostDocument = { adoptedStyleSheets: [] as FakeStyleSheet[] };
    vi.stubGlobal("document", hostDocument);
    const doc = {
      head: {},
      body: {},
      documentElement: { classList: { toggle: vi.fn() } },
      adoptedStyleSheets: [] as FakeStyleSheet[]
    };
    const nodeEl = { dataset: {} as Record<string, string> };
    const wrapperEl = {
      dataset: {} as Record<string, string>,
      querySelectorAll: (selector: string) => selector === "[data-bc-paper]" ? [nodeEl]
        : selector.startsWith("iframe.") ? [{ contentDocument: doc, ownerDocument: hostDocument, closest: () => null }] : []
    };
    const canvas = {
      wrapperEl,
      nodes: new Map([["a", { id: "a", nodeEl }]]),
      importData: vi.fn(),
      getData: () => ({ bcTheme: "scrapbook", nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 280, height: 140 }], edges: [] })
    };
    const events = new Map<string, () => void>();
    const cleanups: Array<() => void> = [];
    const plugin = {
      app: { workspace: {
        on: (event: string, fn: () => void) => { events.set(event, fn); },
        onLayoutReady: (fn: () => void) => fn(),
        getLeavesOfType: () => [{ view: { getViewType: () => "canvas", canvas, containerEl: { querySelector: () => null } } }]
      } },
      register: (fn: () => void) => cleanups.push(fn),
      registerEvent: () => undefined,
      registerDomEvent: () => undefined,
      addCommand: () => undefined
    };
    new CanvasThemeController(plugin as never).start();
    frames.shift()?.();
    expect(wrapperEl.dataset.bcTheme).toBe("scrapbook");
    expect(nodeEl.dataset.bcPaper).toBe("tape");
    expect(doc.adoptedStyleSheets).toHaveLength(1);
    expect(hostDocument.adoptedStyleSheets).toHaveLength(1);
    cleanups.forEach(fn => fn());
    expect(wrapperEl.dataset.bcTheme).toBeUndefined();
    expect(nodeEl.dataset.bcPaper).toBeUndefined();
    expect(doc.adoptedStyleSheets).toHaveLength(0);
    expect(hostDocument.adoptedStyleSheets).toHaveLength(0);
  });
});
