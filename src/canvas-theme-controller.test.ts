import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({ Modal: class {}, Notice: class {}, setIcon: () => undefined }));
import CanvasThemeController from "./canvas-theme-controller";

afterEach(() => vi.unstubAllGlobals());

describe("Canvas theme lifecycle", () => {
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
