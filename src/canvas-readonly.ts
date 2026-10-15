export interface CanvasReadonlyOptions {
  disableContextMenus: boolean;
  lockPanZoom: boolean;
}

export type CanvasReadonlyInputType =
  | "contextmenu"
  | "pointerdown"
  | "mousedown"
  | "touchstart"
  | "touchmove"
  | "wheel"
  | "keydown";

export interface ReadonlyKeyboardModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Decide whether a Canvas DOM input should be intercepted by read-only mode.
 * Viewport lock affects only user-driven input; explicit commands can still
 * invoke Obsidian's zoom-to-fit / zoom-to-selection APIs programmatically.
 */
export function shouldBlockReadonlyInput(
  readOnly: boolean,
  options: CanvasReadonlyOptions,
  type: CanvasReadonlyInputType,
  key = "",
  editableTarget = false,
  modifiers: ReadonlyKeyboardModifiers = {}
): boolean {
  if (!readOnly || editableTarget) return false;

  if (type === "contextmenu") return options.disableContextMenus;
  if (!options.lockPanZoom) return false;

  if (type === "pointerdown" || type === "mousedown" || type === "touchstart" ||
      type === "touchmove" || type === "wheel") {
    return true;
  }

  if (type === "keydown") {
    const normalized = key.toLowerCase();
    if (normalized === " " || normalized === "spacebar") return true;
    const zoomKey = ["+", "=", "-", "_", "0"].includes(normalized);
    return zoomKey && Boolean(modifiers.ctrlKey || modifiers.metaKey || normalized !== "0");
  }
  return false;
}

interface ReadonlyListenerRecord {
  type: CanvasReadonlyInputType;
  listener: (event: any) => void;
  options: AddEventListenerOptions;
}

interface ReadonlyBinding {
  container: any;
  wrapper: any;
  options: CanvasReadonlyOptions;
  listeners: ReadonlyListenerRecord[];
}

/** Installs/removes read-only interaction guards without patching Canvas data APIs. */
export class CanvasReadonlyController {
  private readonly bindings = new Map<any, ReadonlyBinding>();

  bind(view: any, canvas: any, options: CanvasReadonlyOptions): void {
    const container = view?.containerEl ?? view?.contentEl ?? canvas?.wrapperEl;
    const wrapper = canvas?.wrapperEl;
    if (!container?.addEventListener || !container?.removeEventListener || !wrapper) return;

    const existing = this.bindings.get(container);
    if (existing) {
      existing.wrapper = wrapper;
      existing.options = { ...options };
      return;
    }

    const binding: ReadonlyBinding = {
      container,
      wrapper,
      options: { ...options },
      listeners: []
    };
    const eventTypes: CanvasReadonlyInputType[] = [
      "contextmenu", "pointerdown", "mousedown", "touchstart", "touchmove", "wheel", "keydown"
    ];

    for (const type of eventTypes) {
      const listener = (event: any): void => {
        const readOnly = Boolean(binding.wrapper?.classList?.contains?.("bc-readonly"));
        const target = event?.target as any;
        const editable = Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor"));
        const blocked = shouldBlockReadonlyInput(
          readOnly,
          binding.options,
          type,
          String(event?.key ?? ""),
          editable,
          {
            ctrlKey: Boolean(event?.ctrlKey),
            metaKey: Boolean(event?.metaKey),
            shiftKey: Boolean(event?.shiftKey)
          }
        );
        if (!blocked) return;
        if (event?.cancelable !== false) event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
      };
      const listenerOptions: AddEventListenerOptions = { capture: true, passive: false };
      container.addEventListener(type, listener, listenerOptions);
      binding.listeners.push({ type, listener, options: listenerOptions });
    }
    this.bindings.set(container, binding);
  }

  unbind(container: any): void {
    const binding = this.bindings.get(container);
    if (!binding) return;
    for (const item of binding.listeners) {
      binding.container.removeEventListener(item.type, item.listener, item.options);
    }
    binding.listeners.length = 0;
    this.bindings.delete(container);
  }

  stop(): void {
    for (const container of [...this.bindings.keys()]) this.unbind(container);
  }
}
