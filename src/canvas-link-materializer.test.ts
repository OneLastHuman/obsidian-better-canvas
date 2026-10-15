import { describe, expect, it } from "vitest";
import {
  dedupeMaterializableCanvasLinks,
  materializableLinkKey,
  type MaterializableCanvasLink
} from "./canvas-link-materializer";

const entry = (target: string, external = false, title = target): MaterializableCanvasLink => ({
  title,
  detail: target,
  target,
  sourcePath: "Current.canvas",
  ...(external ? { external: true } : {})
});

describe("Canvas link materialization", () => {
  it("normalizes HTTP(S) URL keys and rejects unsafe or malformed protocols", () => {
    expect(materializableLinkKey("https://example.com/a", true)).toBe("url:https://example.com/a");
    expect(materializableLinkKey("javascript:alert(1)", true)).toBeUndefined();
    expect(materializableLinkKey("not a URL", true)).toBeUndefined();
  });

  it("keeps the first occurrence of duplicate outgoing/incoming targets", () => {
    const links = dedupeMaterializableCanvasLinks([
      entry("Notes/Plan.md", false, "outgoing"),
      entry("Notes/Plan.md", false, "incoming duplicate"),
      entry("https://example.com", true),
      entry("https://example.com", true, "URL duplicate"),
      entry("", false)
    ]);
    expect(links.map(link => link.title)).toEqual(["outgoing", "https://example.com"]);
  });

  it("skips targets that already have corresponding file or link nodes", () => {
    const links = dedupeMaterializableCanvasLinks([
      entry("Notes/Plan.md"),
      entry("https://example.com", true),
      entry("Notes/Next.md")
    ], ["file:Notes/Plan.md", "url:https://example.com/"]);
    expect(links.map(link => link.target)).toEqual(["Notes/Next.md"]);
  });

  it("keeps separate subpaths distinct while collapsing identical ones", () => {
    const links = dedupeMaterializableCanvasLinks([
      entry("Plan.canvas#node-a"),
      entry("Plan.canvas#node-a"),
      entry("Plan.canvas#node-b")
    ]);
    expect(links.map(link => link.target)).toEqual(["Plan.canvas#node-a", "Plan.canvas#node-b"]);
  });
});
