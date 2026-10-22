import { afterEach, describe, expect, it, vi } from "vitest";

const { setIcon } = vi.hoisted(() => ({ setIcon: vi.fn() }));
vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, setIcon }));
import CanvasThemeController, { createThemeControl } from "./canvas-theme-controller";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Canvas theme lifecycle", () => {
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
      createElement: () => ({ remove() { style = undefined; } })
    };
    const nodeEl = { dataset: {} as Record<string, string> };
    const wrapperEl = {
      dataset: {} as Record<string, string>,
      querySelectorAll: (selector: string) => selector === "[data-bc-paper]" ? [nodeEl] : [{ contentDocument: doc }]
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
