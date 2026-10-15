import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "./canvas";
import { findContainingPortal, findContainingPortalForGroup } from "./portal-adoption";

function node(id: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}): CanvasNodeData {
  return { id, type: "text", x, y, width, height, ...extra } as CanvasNodeData;
}

describe("findContainingPortal", () => {
  const large = node("portal-large", 0, 0, 1000, 800, { type: "file", file: "large.canvas", portal: true });
  const small = node("portal-small", 200, 100, 300, 300, { type: "file", file: "small.canvas", portal: true });

  it("selects the smallest Portal containing a new node center", () => {
    const candidate = node("new", 240, 180, 50, 50);
    expect(findContainingPortal(candidate, [large, small])?.id).toBe("portal-small");
  });

  it("returns no owner when the center lies outside a Portal's inset", () => {
    const candidate = node("outside", 985, 10, 40, 40);
    expect(findContainingPortal(candidate, [large])).toBeUndefined();
  });

  it("does not attach a node to the current Canvas file's self-reference", () => {
    const own = node("own-portal", 0, 0, 1000, 800, { type: "file", file: "current.canvas", portal: true });
    expect(findContainingPortal(node("new", 200, 200, 40, 40), [own], "current.canvas")).toBeUndefined();
  });

  it("ignores closed Portal frames and ordinary canvas file nodes", () => {
    const closed = node("closed", 0, 0, 500, 400, { type: "file", file: "closed.canvas", portal: false });
    const ordinary = node("ordinary", 0, 0, 500, 400, { type: "file", file: "ordinary.canvas" });
    expect(findContainingPortal(node("new", 100, 100, 40, 40), [closed, ordinary])).toBeUndefined();
  });

  it("rejects candidates with malformed or non-positive geometry", () => {
    const invalid = [
      node("nan-x", Number.NaN, 100, 40, 40),
      node("infinite-y", 100, Number.POSITIVE_INFINITY, 40, 40),
      node("zero-width", 100, 100, 0, 40),
      node("negative-height", 100, 100, 40, -1),
      node("overflowing-right-edge", Number.MAX_VALUE, 100, Number.MAX_VALUE, 40)
    ];
    for (const candidate of invalid) {
      expect(findContainingPortal(candidate, [large])).toBeUndefined();
    }
  });

  it("ignores malformed Portal rectangles rather than adopting into them", () => {
    const invalidPortals = [
      node("nan", Number.NaN, 0, 500, 400, { type: "file", file: "nan.canvas", portal: true }),
      node("infinite", 0, 0, Number.POSITIVE_INFINITY, 400, { type: "file", file: "infinite.canvas", portal: true }),
      node("zero", 0, 0, 0, 400, { type: "file", file: "zero.canvas", portal: true }),
      node("negative", 0, 0, 500, -10, { type: "file", file: "negative.canvas", portal: true }),
      node("overflowing", Number.MAX_VALUE, 0, Number.MAX_VALUE, 400, { type: "file", file: "overflowing.canvas", portal: true })
    ];
    expect(findContainingPortal(node("candidate", 100, 100, 40, 40), invalidPortals)).toBeUndefined();
  });

  it("rejects invalid inset values and ignores invalid runtime entries", () => {
    const candidate = node("candidate", 100, 100, 40, 40);
    expect(findContainingPortal(candidate, [large], undefined, -1)).toBeUndefined();
    expect(findContainingPortal(candidate, [large], undefined, Number.NaN)).toBeUndefined();
    expect(findContainingPortal(candidate, [null, large] as unknown as CanvasNodeData[])?.id).toBe("portal-large");
    expect(findContainingPortal(candidate, large as unknown as CanvasNodeData[])).toBeUndefined();
  });

  it("adopts a new group only when its full rectangle is inside the Portal", () => {
    const portal = node("portal", 100, 100, 500, 400, { type: "file", file: "target.canvas", portal: true });
    const fullyInside = node("group", 140, 150, 220, 180, { type: "group" });
    const partiallyOutside = node("outside-group", 540, 150, 100, 180, { type: "group" });

    expect(findContainingPortalForGroup(fullyInside, [portal])?.id).toBe("portal");
    expect(findContainingPortalForGroup(partiallyOutside, [portal])).toBeUndefined();
  });

  it("prefers the smallest Portal that fully contains a group and avoids self references", () => {
    const large = node("large", 0, 0, 1000, 800, { type: "file", file: "large.canvas", portal: true });
    const small = node("small", 200, 100, 400, 350, { type: "file", file: "small.canvas", portal: true });
    const group = node("group", 240, 140, 160, 120, { type: "group" });
    expect(findContainingPortalForGroup(group, [large, small])?.id).toBe("small");
    expect(findContainingPortalForGroup(group, [large], "large.canvas")).toBeUndefined();
  });

  it("rejects groups with malformed or non-positive geometry", () => {
    const portal = node("portal", 0, 0, 500, 400, { type: "file", file: "target.canvas", portal: true });
    expect(findContainingPortalForGroup(node("nan", Number.NaN, 10, 20, 20, { type: "group" }), [portal])).toBeUndefined();
    expect(findContainingPortalForGroup(node("zero", 10, 10, 0, 20, { type: "group" }), [portal])).toBeUndefined();
    expect(findContainingPortalForGroup(node("negative", 10, 10, 20, -1, { type: "group" }), [portal])).toBeUndefined();
    expect(findContainingPortalForGroup(node("overflow", Number.MAX_VALUE, 10, Number.MAX_VALUE, 20, { type: "group" }), [portal])).toBeUndefined();
    expect(findContainingPortalForGroup(node("group", 10, 10, 20, 20, { type: "group" }), [portal], undefined, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
