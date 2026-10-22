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
