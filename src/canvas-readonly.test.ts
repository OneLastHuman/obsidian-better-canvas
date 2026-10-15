import { describe, expect, it } from "vitest";
import {
  CanvasReadonlyController,
  shouldBlockReadonlyInput,
  type CanvasReadonlyOptions
} from "./canvas-readonly";

const allEnabled: CanvasReadonlyOptions = {
  disableContextMenus: true,
  lockPanZoom: true
};

describe("Canvas read-only interaction guards", () => {
  it("keeps canvas input unchanged while read-only mode is off", () => {
    for (const type of ["contextmenu", "pointerdown", "mousedown", "touchstart", "touchmove", "wheel", "keydown"] as const) {
      expect(shouldBlockReadonlyInput(false, allEnabled, type, " ", false)).toBe(false);
    }
  });

  it("independently disables context menus without locking pan or zoom", () => {
    expect(shouldBlockReadonlyInput(true, { disableContextMenus: true, lockPanZoom: false }, "contextmenu")).toBe(true);
    expect(shouldBlockReadonlyInput(true, { disableContextMenus: false, lockPanZoom: false }, "contextmenu")).toBe(false);
    expect(shouldBlockReadonlyInput(true, { disableContextMenus: true, lockPanZoom: false }, "wheel")).toBe(false);
    expect(shouldBlockReadonlyInput(true, { disableContextMenus: true, lockPanZoom: false }, "pointerdown")).toBe(false);
  });

  it("locks pointer, touch and wheel viewport input when enabled", () => {
    for (const type of ["pointerdown", "mousedown", "touchstart", "touchmove", "wheel"] as const) {
      expect(shouldBlockReadonlyInput(true, allEnabled, type)).toBe(true);
    }
    expect(shouldBlockReadonlyInput(true, { disableContextMenus: false, lockPanZoom: false }, "wheel")).toBe(false);
  });

  it("blocks viewport keyboard gestures but preserves editable targets and ordinary typing", () => {
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", " ")).toBe(true);
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", "+")).toBe(true);
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", "0")).toBe(false);
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", "0", false, { ctrlKey: true })).toBe(true);
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", "ArrowRight")).toBe(false);
    expect(shouldBlockReadonlyInput(true, allEnabled, "keydown", " ", true)).toBe(false);
  });

  it("binds read-only guards once, respects class and options, and removes all listeners on stop", () => {
    const handlers = new Map<string, Set<(event: any) => void>>();
    const listenerOptions = new Map<string, AddEventListenerOptions[]>();
    const container = {
      addEventListener(type: string, listener: (event: any) => void, options: AddEventListenerOptions) {
        let listeners = handlers.get(type);
        if (!listeners) handlers.set(type, listeners = new Set());
        listeners.add(listener);
        listenerOptions.set(type, [...(listenerOptions.get(type) ?? []), options]);
      },
      removeEventListener(type: string, listener: (event: any) => void) {
        handlers.get(type)?.delete(listener);
      },
      dispatch(type: string, event: any) {
        for (const listener of handlers.get(type) ?? []) listener({ type, ...event });
      }
    };
    let enabled = false;
    const wrapper = { classList: { contains: (name: string) => name === "bc-readonly" && enabled } };
    const canvas = { wrapperEl: wrapper };
    const controller = new CanvasReadonlyController();

    controller.bind({ containerEl: container }, canvas, allEnabled);
    controller.bind({ containerEl: container }, canvas, allEnabled);
    expect(handlers.get("wheel")?.size).toBe(1);
    expect(listenerOptions.get("wheel")?.[0]).toMatchObject({ capture: true, passive: false });

    let prevented = 0;
    let stopped = 0;
    const event = {
      cancelable: true,
      target: {},
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; },
      stopImmediatePropagation() { stopped += 1; }
    };
    container.dispatch("wheel", event);
    expect(prevented).toBe(0);

    enabled = true;
    container.dispatch("contextmenu", event);
    container.dispatch("wheel", event);
    expect(prevented).toBe(2);
    expect(stopped).toBe(4);

    controller.stop();
    expect(handlers.get("wheel")?.size).toBe(0);
    prevented = 0;
    container.dispatch("wheel", event);
    expect(prevented).toBe(0);
  });
});
