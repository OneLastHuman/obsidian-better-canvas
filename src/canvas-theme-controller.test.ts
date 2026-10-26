import { afterEach, describe, expect, it, vi } from "vitest";

const { setIcon } = vi.hoisted(() => ({ setIcon: vi.fn() }));
vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, setIcon }));
vi.mock("./sketch-font", () => ({ SKETCH_FONT_CSS: "/* sketch font */" }));
vi.mock("./soft-notes-font", () => ({ SOFT_NOTES_FONT_CSS: "/* soft font */" }));
import CanvasThemeController, { createThemeControl } from "./canvas-theme-controller";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Minimal iframe/document stand-in that follows the real append/remove/getElementById
// contract `syncEditors()` relies on, so re-injection is observable via `styles`.
function fakeEditorCanvas() {
  const styles: any[] = [];
  const classList = (...names: string[]) => {
    const set = new Set<string>();
    return { add: (name: string) => set.add(name), contains: (name: string) => set.has(name), names };
  };
  const ownerDocument = { body: { classList: classList() } };
  const contentDocument = {
    head: {},
    body: { classList: classList(), appendChild(style: any) { styles.push(style); } },
    getElementById(id: string) { return styles.find(style => style.id === id) ?? null; },
    createElement() {
      const attributes = new Map<string, string>();
      return {
        id: "",
        textContent: "",
        setAttribute(name: string, value: string) { attributes.set(name, value); },
        getAttribute(name: string) { return attributes.get(name) ?? null; },
        remove() { const index = styles.indexOf(this); if (index >= 0) styles.splice(index, 1); }
      };
    }
  };
  const iframe = { contentDocument, ownerDocument, closest: () => null };
  const canvas = { wrapperEl: { querySelectorAll: () => [iframe] } };
  return { styles, iframe, canvas };
}

describe("Canvas theme lifecycle", () => {
  it("refreshes an existing font style on hot reload", () => {
    const style = { textContent: "old font version" };
    vi.stubGlobal("document", { head: {}, getElementById: () => style });
    const controller = new CanvasThemeController({} as never);
    (controller as any).ensureFont();
    expect(style.textContent).toBe("/* sketch font *//* soft font */");
  });

  it("builds the entry as a native 32px control, not a button", () => {
    let created: any;
    vi.stubGlobal("document", {
      createElement: (tagName: string) => {
        const attributes = new Map<string, string>();
        created = {
          tagName: tagName.toLowerCase(),
          className: "",
          setAttribute(name: string, value: string) { attributes.set(name, value); },
          getAttribute(name: string) { return attributes.get(name) ?? null; }
        };
        return created;
      }
    });

    const control = createThemeControl();

    expect(created.tagName).toBe("div");
    expect(control.className).toBe("canvas-control-item bc-theme-control-button");
    expect(control.getAttribute("role")).toBe("button");
    expect(control.getAttribute("tabindex")).toBe("0");
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(setIcon).toHaveBeenCalledWith(control, "wallpaper");
  });

  it("injects dark ink directly on scrapbook CodeMirror content in the editor iframe", () => {
    const { styles, canvas } = fakeEditorCanvas();

    (new CanvasThemeController({} as never) as any).syncEditors(canvas, "scrapbook");

    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain("--text-normal: #43372f");
    // Loose text match is not enough: a host rule with higher specificity only loses to
    // !important, so assert the rule is still marked important and not merely present.
    expect(styles[0].textContent).toMatch(/\.cm-content\s*\{[^}]*color:\s*#43372f\s*!important/);
  });

  it("re-injects the editor sheet when only the light/dark appearance changes", () => {
    const { styles, iframe, canvas } = fakeEditorCanvas();
    const controller = new CanvasThemeController({} as never) as any;

    controller.syncEditors(canvas, "scrapbook");
    const lightKey = styles[0].getAttribute("data-bc-editor-key");
    expect(lightKey).toContain(":light");

    // Appearance toggles fire `css-change` without changing theme/preset/align, so the
    // dedupe key must move or the stale sheet is reused and the fix silently stops working.
    iframe.ownerDocument.body.classList.add("theme-dark");
    iframe.contentDocument.body.classList.add("theme-dark");
    controller.syncEditors(canvas, "scrapbook");

    expect(styles).toHaveLength(1);
    expect(styles[0].getAttribute("data-bc-editor-key")).toBe(lightKey!.replace(/:light$/, ":dark"));
  });

  it("treats a dark host with an un-synced iframe body as dark", () => {
    // The iframe mirror of `theme-dark` lags, so relying on the iframe body alone reads
    // light here; `contains()` returns false, not null, so `??` cannot express the fallback.
    const { styles, iframe, canvas } = fakeEditorCanvas();
    const controller = new CanvasThemeController({} as never) as any;

    iframe.ownerDocument.body.classList.add("theme-dark");
    expect(iframe.contentDocument.body.classList.contains("theme-dark")).toBe(false);
    controller.syncEditors(canvas, "scrapbook");

    expect(styles).toHaveLength(1);
    expect(styles[0].getAttribute("data-bc-editor-key")).toContain(":dark");
  });

  it("switches the rounded-map ink when the host is dark but its iframe body is not", () => {
    // Same appearance rule feeds the rounded-map ink, so both paths must agree.
    const { styles, iframe, canvas } = fakeEditorCanvas();
    const controller = new CanvasThemeController({} as never) as any;

    iframe.ownerDocument.body.classList.add("theme-dark");
    controller.syncEditors(canvas, "rounded-map");

    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toContain("--text-normal: #20262d");
  });

  it("keeps the existing editor sheet when nothing that affects it changed", () => {
    const { styles, canvas } = fakeEditorCanvas();
    const controller = new CanvasThemeController({} as never) as any;

    controller.syncEditors(canvas, "scrapbook");
    const first = styles[0];
    controller.syncEditors(canvas, "scrapbook");

    expect(styles).toHaveLength(1);
    expect(styles[0]).toBe(first);
  });

  it("cleans a decorated canvas and editor even when native controls are unavailable", () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("window", { requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; }, cancelAnimationFrame: () => undefined });
    vi.stubGlobal("document", {});
    let style: any;
    const doc = {
      head: { appendChild(value: any) { style = value; } },
      getElementById: () => style,
      createElement: () => ({
        setAttribute() {},
        getAttribute() { return null; },
        remove() { style = undefined; }
      })
    };
    const nodeEl = { dataset: {} as Record<string, string> };
    const wrapperEl = {
      dataset: {} as Record<string, string>,
      querySelectorAll: (selector: string) => selector === "[data-bc-paper]" ? [nodeEl]
        : selector === "[data-bc-soft-notes]" ? [] : [{ contentDocument: doc }]
    };
    const canvas = { wrapperEl, nodes: new Map([["a", { nodeEl }]]), getData: () => ({ bcTheme: "scrapbook", nodes: [{ id: "a", type: "text" }], edges: [] }) };
    const events = new Map<string, () => void>();
    const cleanups: Array<() => void> = [];
    const plugin = {
      app: { workspace: {
        on: (event: string, fn: () => void) => { events.set(event, fn); },
        onLayoutReady: (fn: () => void) => fn(),
        getLeavesOfType: () => [{ view: { canvas, containerEl: { querySelector: () => null } } }]
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
    expect(style).toBeDefined();
    cleanups.forEach(fn => fn());
    expect(wrapperEl.dataset.bcTheme).toBeUndefined();
    expect(nodeEl.dataset.bcPaper).toBeUndefined();
    expect(style).toBeUndefined();
  });
});
