import { describe, expect, it } from "vitest";
import { parseCanvasMarkdownMetadata } from "./canvas-metadata-parser";

describe("Canvas text-node metadata fallback parser", () => {
  it("extracts WikiLinks, Markdown links, external links, and both embed forms", () => {
    const parsed = parseCanvasMarkdownMetadata(
      "See [[Notes/Target.md|target]], [guide](Guides/Start.md), <https://example.org/docs>, ![[Images/diagram.png|diagram]], ![thumbnail](Images/thumb.png)."
    );

    expect(parsed.links.map(item => item.link)).toEqual([
      "Notes/Target.md",
      "Guides/Start.md",
      "https://example.org/docs"
    ]);
    expect(parsed.links[0].displayText).toBe("target");
    expect(parsed.links[1].displayText).toBe("guide");
    expect(parsed.embeds.map(item => item.link)).toEqual(["Images/diagram.png", "Images/thumb.png"]);
    expect(parsed.embeds[0].displayText).toBe("diagram");
    expect(parsed.embeds[1].displayText).toBe("thumbnail");
    expect(parsed.links[1].position.start.line).toBe(0);
    expect(parsed.links[1].position.start.offset).toBeGreaterThan(parsed.links[0].position.start.offset);
  });

  it("extracts headings, hierarchical tags, tasks, list parents, and section ranges", () => {
    const text = [
      "# Project **Overview**",
      "",
      "A paragraph with #release and #team/platform tags.",
      "- [x] completed",
      "  - nested task",
      "- next item",
      "",
      "> quoted text",
      "",
      "Final paragraph."
    ].join("\n");
    const parsed = parseCanvasMarkdownMetadata(text);

    expect(parsed.headings).toHaveLength(1);
    expect(parsed.headings[0].heading).toBe("Project Overview");
    expect(parsed.headings[0].level).toBe(1);
    expect(parsed.tags.map(item => item.tag)).toEqual(["#release", "#team/platform"]);
    expect(parsed.listItems).toHaveLength(3);
    expect(parsed.listItems[0].task).toBe("x");
    expect(parsed.listItems[0].parent).toBe(0);
    expect(parsed.listItems[1].parent).toBe(3);
    expect(parsed.listItems[2].parent).toBe(0);
    expect(parsed.sections.map(section => section.type)).toEqual([
      "heading", "paragraph", "list", "blockquote", "paragraph"
    ]);
    expect(parsed.sections[2].position.start.line).toBe(3);
    expect(parsed.sections[2].position.end.line).toBe(5);
  });

  it("does not index links, tags, or headings inside fenced or inline code", () => {
    const text = [
      "Visible [[Real.md]] #visible and \x60[[hidden.md]] #hidden\x60.",
      "\x60\x60\x60md",
      "# Not a heading",
      "[[NotALink.md]] #notATag",
      "\x60\x60\x60",
      "After the fence."
    ].join("\n");
    const parsed = parseCanvasMarkdownMetadata(text);

    expect(parsed.links.map(item => item.link)).toEqual(["Real.md"]);
    expect(parsed.tags.map(item => item.tag)).toEqual(["#visible"]);
    expect(parsed.headings).toEqual([]);
    expect(parsed.sections.map(section => section.type)).toEqual(["paragraph", "code", "paragraph"]);
  });

  it("extracts footnote definitions and references with source-local positions", () => {
    const parsed = parseCanvasMarkdownMetadata("Text[^ref].\n\n[^ref]: A note");
    expect(parsed.footnoteRefs).toHaveLength(1);
    expect((parsed.footnoteRefs[0] as any).id).toBe("ref");
    expect(parsed.footnotes).toHaveLength(1);
    expect((parsed.footnotes[0] as any).position.start.line).toBe(2);
  });

  it("returns empty arrays for empty input and preserves CRLF offsets", () => {
    expect(parseCanvasMarkdownMetadata("").links).toEqual([]);
    const parsed = parseCanvasMarkdownMetadata("Title\r\n[[Note.md]]");
    expect(parsed.links[0].position.start.line).toBe(1);
    expect(parsed.links[0].position.start.col).toBe(0);
    expect(parsed.links[0].position.start.offset).toBe(7);
  });
});
