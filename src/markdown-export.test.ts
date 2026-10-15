import { describe, expect, it } from "vitest";
import { flattenMarkdownForSvg } from "./markdown-export";

describe("flattenMarkdownForSvg", () => {
  it("removes inline emphasis, strike-through, and code markers", () => {
    expect(flattenMarkdownForSvg("**bold** _italic_ ~~removed~~ \x60code\x60 __strong__"))
      .toBe("bold italic removed code strong");
  });

  it("uses visible labels for WikiLinks, Markdown links, and embedded files", () => {
    expect(flattenMarkdownForSvg(
      "See [[folder/Target.md|custom label]], [[Other.canvas#node-id]], [website](https://example.com), ![[assets/diagram.png]], ![photo](photo.png)"
    )).toBe("See custom label, Other, website, diagram.png, photo");
  });

  it("preserves readable headings, quotes, bullet lists and task markers", () => {
    expect(flattenMarkdownForSvg(
      "# Topic\n\n> A quoted line\n- first\n* [x] done\n+ [ ] next\n1) numbered"
    )).toBe("Topic\n\nA quoted line\n• first\n☑ done\n☐ next\n1. numbered");
  });

  it("removes code-fence delimiters but retains the code body and normalizes blank lines", () => {
    expect(flattenMarkdownForSvg("Before\n\n\x60\x60\x60ts\nconst value = \x60hello\x60;\n\x60\x60\x60\n\n\nAfter"))
      .toBe("Before\n\nconst value = \\x60hello\\x60;\n\nAfter");
  });

  it("does not strip Markdown-like characters from fenced code", () => {
    expect(flattenMarkdownForSvg("\\x60\\x60\\x60js\\nconst bold = **literal**;\\n\\x60\\x60\\x60"))
      .toBe("const bold = **literal**;");
  });

  it("keeps empty input empty and safely preserves literal HTML markup", () => {
    expect(flattenMarkdownForSvg("")).toBe("");
    expect(flattenMarkdownForSvg("<b>literal</b>")).toBe("<b>literal</b>");
  });
});
