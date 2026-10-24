import { afterEach, describe, expect, it } from "vitest";
import {
  clearRoundedMapNode,
  decorateRoundedMapNode,
  pruneRoundedMapGeometry,
  refreshRoundedMapGeometry,
  roundedMapCss,
  stopRoundedMapGeometry
} from "./rounded-map-style";

interface FakeElement {
  dataset: Record<string, string>;
  style: {
    map: Map<string, string>;
    getPropertyValue(key: string): string;
    setProperty(key: string, value: string): void;
    removeProperty(key: string): void;
  };
  ownerDocument: any;
  isConnected: boolean;
  offsetWidth: number;
  offsetHeight: number;
}

const callbacks: Array<(entries: Array<{ target: FakeElement }>) => void> = [];
const observed = new Set<FakeElement>();

class FakeResizeObserver {
  constructor(callback: (entries: Array<{ target: FakeElement }>) => void) {
    callbacks.push(callback);
  }
  observe(el: FakeElement) { observed.add(el); }
  unobserve(el: FakeElement) { observed.delete(el); }
  disconnect() { observed.clear(); }
}

const doc = { defaultView: { ResizeObserver: FakeResizeObserver } };

function fakeNode(width: number, height: number, connected = true): FakeElement {
  const map = new Map<string, string>();
  return {
    dataset: {},
    style: {
      map,
      getPropertyValue: (key: string) => map.get(key) ?? "",
      setProperty: (key: string, value: string) => { map.set(key, value); },
      removeProperty: (key: string) => { map.delete(key); }
    },
    ownerDocument: doc,
    isConnected: connected,
    offsetWidth: width,
    offsetHeight: height
  };
}

function paint(element: FakeElement): void {
  for (const callback of callbacks) callback([{ target: element }]);
}

afterEach(() => {
  stopRoundedMapGeometry();
  callbacks.length = 0;
  observed.clear();
});

describe("rounded map live geometry", () => {
  it("re-derives clip, ring and padding from the box on every resize frame", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    expect(el.dataset.bcRounded).toBe("true");
    expect(observed.has(el)).toBe(true);
    const initial = el.style.getPropertyValue("--bc-rounded-clip");

    // Native drag: the element box changes before any Canvas event fires.
    el.offsetWidth = 450;
    el.offsetHeight = 260;
    paint(el);

    const live = el.style.getPropertyValue("--bc-rounded-clip");
    expect(live).not.toBe(initial);
    expect(live).toBe(roundedMapCss("default", 450, 260)["--bc-rounded-clip"]);
    expect(el.style.getPropertyValue("--bc-rounded-ring"))
      .toBe(roundedMapCss("default", 450, 260)["--bc-rounded-ring"]);
    expect(el.style.getPropertyValue("--bc-rounded-padding")).toBe("18px 28px 18px 28px");
  });

  it("keeps a diamond safe area proportional to the live size", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, {
      id: "b", type: "text", width: 300, height: 180, bcShape: "diamond"
    } as never);
    expect(el.style.getPropertyValue("--bc-rounded-padding")).toBe("48.6px 78px 48.6px 78px");

    el.offsetWidth = 400;
    el.offsetHeight = 400;
    paint(el);

    expect(el.style.getPropertyValue("--bc-rounded-padding")).toBe("108px 104px 108px 104px");
  });

  it("updates the shared auto-resize safe area without touching other nodes", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    el.dataset.bcAutoShape = "true";
    el.style.setProperty("--bc-auto-content-padding", "18px 28px 18px 28px");

    el.offsetWidth = 400;
    el.offsetHeight = 240;
    paint(el);

    expect(el.style.getPropertyValue("--bc-auto-content-padding")).toBe("18px 28px 18px 28px");
    el.offsetWidth = 100;
    paint(el);
    expect(el.style.getPropertyValue("--bc-auto-content-padding")).toBe("18px 16px 18px 16px");
  });

  it("does not letterbox the ring mask when the box outgrows the last path", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    const ring = decodeURIComponent(el.style.getPropertyValue("--bc-rounded-ring"));
    expect(ring).toContain('preserveAspectRatio="none"');
    for (const key of ["--bc-rounded-dashed", "--bc-rounded-dotted"]) {
      expect(decodeURIComponent(el.style.getPropertyValue(key))).toContain('preserveAspectRatio="none"');
    }
  });

  it("keeps the selection halo a fixed distance from the card at every size", () => {
    const small = roundedMapCss("default", 200, 140);
    const large = roundedMapCss("default", 800, 600);
    expect(small["--bc-rounded-selection-inset"]).toBe("7px");
    expect(large["--bc-rounded-selection-inset"]).toBe("7px");
    // The ring is stroked from the same path in a box grown by the outset,
    // never a percentage scale of the card.
    expect(decodeURIComponent(small["--bc-rounded-selection"])).toContain('width="214" height="154"');
    expect(decodeURIComponent(large["--bc-rounded-selection"])).toContain('width="814" height="614"');
    expect(decodeURIComponent(large["--bc-rounded-selection"])).toContain('preserveAspectRatio="none"');
  });

  it("re-derives the selection halo live so the gap never drifts mid-drag", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    const before = el.style.getPropertyValue("--bc-rounded-selection");
    el.offsetWidth = 700;
    el.offsetHeight = 500;
    paint(el);
    const after = el.style.getPropertyValue("--bc-rounded-selection");
    expect(after).not.toBe(before);
    expect(decodeURIComponent(after)).toContain('width="714" height="514"');
    expect(el.style.getPropertyValue("--bc-rounded-selection-inset")).toBe("7px");
  });

  it("ignores undecorated or degenerate boxes", () => {
    const el = fakeNode(0, 0);
    expect(refreshRoundedMapGeometry(el as unknown as HTMLElement)).toBe(false);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 0, height: 0 } as never);
    expect(el.dataset.bcRounded).toBeUndefined();
    expect(observed.has(el)).toBe(false);
  });

  it("unobserves on clear and prunes culled nodes", () => {
    const live = fakeNode(300, 180);
    const culled = fakeNode(300, 180);
    decorateRoundedMapNode(live as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    decorateRoundedMapNode(culled as unknown as HTMLElement, { id: "b", type: "text", width: 300, height: 180 } as never);
    expect(observed.size).toBe(2);

    clearRoundedMapNode(live as unknown as HTMLElement);
    expect(observed.has(live)).toBe(false);
    expect(live.dataset.bcRounded).toBeUndefined();
    expect(live.dataset.bcRoundedShape).toBeUndefined();
    expect(live.style.map.size).toBe(0);

    culled.isConnected = false;
    pruneRoundedMapGeometry(doc as unknown as Document);
    expect(observed.has(culled)).toBe(false);
  });

  it("drops every observer when the plugin stops", () => {
    const el = fakeNode(300, 180);
    decorateRoundedMapNode(el as unknown as HTMLElement, { id: "a", type: "text", width: 300, height: 180 } as never);
    stopRoundedMapGeometry();
    expect(observed.size).toBe(0);
  });
});
