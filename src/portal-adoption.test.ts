import { describe, expect, it } from "vitest";
import type { CanvasNodeData } from "./canvas";
import { findContainingPortal } from "./portal-adoption";

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
});
