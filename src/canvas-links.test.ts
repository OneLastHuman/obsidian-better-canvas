import { describe, expect, it } from "vitest";
import { extractWikiLinks } from "./canvas-links";

describe("Canvas wikilink extraction", () => {
  it("extracts simple links, aliases, embeds, and Canvas node deep links", () => {
    const text = [
      "See [[Folder/Note.md]]",
      "Embed ![[Research.canvas#node-123|Research node]]",
      "Jump to [[Report.pdf#page=4]]",
      "Block [[Note.md#^abc123]]"
    ].join("\n");
    expect(extractWikiLinks(text)).toEqual([
      { targetPath: "Folder/Note.md", original: "[[Folder/Note.md]]" },
      { targetPath: "Research.canvas", subpath: "node-123", alias: "Research node", original: "![[Research.canvas#node-123|Research node]]" },
      { targetPath: "Report.pdf", subpath: "page=4", original: "[[Report.pdf#page=4]]" },
      { targetPath: "Note.md", subpath: "^abc123", original: "[[Note.md#^abc123]]" }
    ]);
  });

  it("ignores empty links and preserves multiple references", () => {
    expect(extractWikiLinks("[] [[ ]] [[A]] [[A]]")).toEqual([
      { targetPath: "A", original: "[[A]]" },
      { targetPath: "A", original: "[[A]]" }
    ]);
  });

  it("returns no matches for ordinary text and external Markdown URLs", () => {
    expect(extractWikiLinks("https://example.com and [site](https://example.com)")).toEqual([]);
  });
});
