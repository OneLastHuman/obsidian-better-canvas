import { describe, expect, it, vi } from "vitest";
import { EditingIframeShortcutRegistry } from "./canvas-editing-shortcuts";

class FakeDocument {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (typeof listener !== "function") return;
    const key = `${type}:${captureOf(options)}`;
    const listeners = this.listeners.get(key) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (typeof listener !== "function") return;
    this.listeners.get(`${type}:${captureOf(options)}`)?.delete(listener);
  }

  count(type: string, capture: boolean): number {
    return this.listeners.get(`${type}:${capture}`)?.size ?? 0;
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(`${type}:true`) ?? []) listener(event);
  }
}

class FakeIframe {
  readonly loadListeners = new Set<EventListener>();
  editing = true;
  isConnected = true;

  constructor(public contentDocument: FakeDocument | null) {}

  closest(selector: string): Element | null {
    return selector === ".canvas-node.is-editing" && this.editing ? ({} as Element) : null;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === "load" && typeof listener === "function") this.loadListeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === "load" && typeof listener === "function") this.loadListeners.delete(listener);
  }

  fireLoad(): void {
    for (const listener of Array.from(this.loadListeners)) listener(new Event("load"));
  }

  asElement(): HTMLIFrameElement {
    return this as unknown as HTMLIFrameElement;
  }
}

class FakeRoot {
  readonly iframes: FakeIframe[] = [];

  querySelectorAll(): HTMLIFrameElement[] {
    return this.iframes.map(iframe => iframe.asElement());
  }
}

function captureOf(options?: boolean | AddEventListenerOptions): boolean {
  return typeof options === "boolean" ? options : Boolean(options?.capture);
}

describe("EditingIframeShortcutRegistry", () => {
  it("binds the shortcut listener to the editing iframe document in the capture phase", () => {
    const handler = vi.fn();
    const doc = new FakeDocument();
    const iframe = new FakeIframe(doc);
    const root = new FakeRoot();
    root.iframes.push(iframe);
    const registry = new EditingIframeShortcutRegistry(handler);

    registry.sync(root as unknown as ParentNode);

    expect(doc.count("keydown", true)).toBe(1);
    expect(doc.count("keydown", false)).toBe(0);
    const event = { key: "Enter", shiftKey: true } as unknown as Event;
    doc.dispatch("keydown", event);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not bind iframes outside an editing node, and deduplicates repeated syncs", () => {
    const handler = vi.fn();
    const doc = new FakeDocument();
    const iframe = new FakeIframe(doc);
    const root = new FakeRoot();
    root.iframes.push(iframe);
    const registry = new EditingIframeShortcutRegistry(handler);

    iframe.editing = false;
    registry.sync(root as unknown as ParentNode);
    expect(doc.count("keydown", true)).toBe(0);

    iframe.editing = true;
    registry.sync(root as unknown as ParentNode);
    registry.sync(root as unknown as ParentNode);
    expect(doc.count("keydown", true)).toBe(1);
  });

  it("unbinds when editing ends and removes all listeners on dispose", () => {
    const handler = vi.fn();
    const doc = new FakeDocument();
    const iframe = new FakeIframe(doc);
    const root = new FakeRoot();
    root.iframes.push(iframe);
    const registry = new EditingIframeShortcutRegistry(handler);

    registry.sync(root as unknown as ParentNode);
    iframe.editing = false;
    registry.sync(root as unknown as ParentNode);
    expect(doc.count("keydown", true)).toBe(0);
    expect(iframe.loadListeners.size).toBe(0);

    iframe.editing = true;
    registry.sync(root as unknown as ParentNode);
    registry.dispose();
    expect(doc.count("keydown", true)).toBe(0);
    expect(iframe.loadListeners.size).toBe(0);
  });

  it("rebinds when the iframe replaces its document", () => {
    const handler = vi.fn();
    const firstDoc = new FakeDocument();
    const iframe = new FakeIframe(firstDoc);
    const root = new FakeRoot();
    root.iframes.push(iframe);
    const registry = new EditingIframeShortcutRegistry(handler);

    registry.sync(root as unknown as ParentNode);
    const secondDoc = new FakeDocument();
    iframe.contentDocument = secondDoc;
    iframe.fireLoad();

    expect(firstDoc.count("keydown", true)).toBe(0);
    expect(secondDoc.count("keydown", true)).toBe(1);
  });

  it("leaves bindings owned by another canvas container untouched", () => {
    const handler = vi.fn();
    const doc = new FakeDocument();
    const iframe = new FakeIframe(doc);
    const root = new FakeRoot();
    root.iframes.push(iframe);
    const registry = new EditingIframeShortcutRegistry(handler);

    registry.sync(root as unknown as ParentNode);
    registry.sync(new FakeRoot() as unknown as ParentNode);
    expect(doc.count("keydown", true)).toBe(1);
  });
});
