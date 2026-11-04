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

interface ReadonlyEventContainer {
  addEventListener(type: string, listener: EventListener, options: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options: AddEventListenerOptions): void;
}

interface ReadonlyWrapper {
  classList: Pick<DOMTokenList, "contains">;
}

function hasClosest(target: EventTarget | null): target is EventTarget & Pick<Element, "closest"> {
  return target !== null && "closest" in target && typeof target.closest === "function";
}

function isReadonlyEventContainer(value: Partial<ReadonlyEventContainer> | undefined): value is ReadonlyEventContainer {
  return typeof value?.addEventListener === "function" && typeof value.removeEventListener === "function";
}

interface ReadonlyListenerRecord {
  type: CanvasReadonlyInputType;
  listener: EventListener;
  options: AddEventListenerOptions;
}

interface ReadonlyBinding {
  container: ReadonlyEventContainer;
  wrapper: ReadonlyWrapper;
  options: CanvasReadonlyOptions;
  listeners: ReadonlyListenerRecord[];
}

/** Installs/removes read-only interaction guards without patching Canvas data APIs. */
export class CanvasReadonlyController {
  private readonly bindings = new Map<ReadonlyEventContainer, ReadonlyBinding>();

  bind(
    view: { containerEl?: ReadonlyEventContainer; contentEl?: ReadonlyEventContainer } | null | undefined,
    canvas: { wrapperEl?: ReadonlyWrapper & Partial<ReadonlyEventContainer> } | null | undefined,
    options: CanvasReadonlyOptions
  ): void {
    const container = view?.containerEl ?? view?.contentEl ?? canvas?.wrapperEl;
    const wrapper = canvas?.wrapperEl;
    if (!isReadonlyEventContainer(container) || !wrapper) return;

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
      const listener: EventListener = (event): void => {
        const readOnly = binding.wrapper.classList.contains("bc-readonly");
        const target = event.target;
        const editable = hasClosest(target) && Boolean(target.closest("input, textarea, select, [contenteditable='true'], .cm-editor"));
        const blocked = shouldBlockReadonlyInput(
          readOnly,
          binding.options,
          type,
          "key" in event && typeof event.key === "string" ? event.key : "",
          editable,
          {
            ctrlKey: "ctrlKey" in event && Boolean(event.ctrlKey),
            metaKey: "metaKey" in event && Boolean(event.metaKey),
            shiftKey: "shiftKey" in event && Boolean(event.shiftKey)
          }
        );
        if (!blocked) return;
        if (event.cancelable !== false) event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      };
      const listenerOptions: AddEventListenerOptions = { capture: true, passive: false };
      container.addEventListener(type, listener, listenerOptions);
      binding.listeners.push({ type, listener, options: listenerOptions });
    }
    this.bindings.set(container, binding);
  }

  unbind(container: ReadonlyEventContainer): void {
    const binding = this.bindings.get(container);
    if (!binding) return;
    for (const item of binding.listeners) {
      binding.container.removeEventListener(item.type, item.listener, item.options);
    }
    binding.listeners.length = 0;
    this.bindings.delete(container);
  }

  retainOnly(activeContainers: Iterable<ReadonlyEventContainer>): void {
    const active = new Set(activeContainers);
    for (const container of [...this.bindings.keys()]) {
      if (!active.has(container)) this.unbind(container);
    }
  }

  stop(): void {
    for (const container of [...this.bindings.keys()]) this.unbind(container);
  }
}
