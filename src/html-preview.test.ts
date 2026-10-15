import { describe, expect, it } from "vitest";
import { extractHtmlPreviewBlocks, isHtmlPreviewCandidate } from "./html-preview";

describe("HTML preview extraction", () => {
  it("extracts fenced HTML case-insensitively and leaves other languages alone", () => {
    expect(extractHtmlPreviewBlocks([
      "```ts",
      "const x = 1;",
      "```",
      "```HTML",
      "<h1>Hello</h1>",
      "```"
    ].join("\n"))).toEqual([{ language: "html", source: "<h1>Hello</h1>" }]);
  });

  it("supports multiple blocks and ignores empty or unlabeled fences", () => {
    const result = extractHtmlPreviewBlocks([
      "```",
      "<p>not labeled</p>",
      "```",
      "```html",
      "",
      "```",
      "```htm",
      "<p>one</p>",
      "```",
      "```html",
      "<p>two</p>",
      "```"
    ].join("\n"));
    expect(result).toEqual([
      { language: "htm", source: "<p>one</p>" },
      { language: "html", source: "<p>two</p>" }
    ]);
  });

  it("ignores non-text values and caps excessive source payloads", () => {
    expect(extractHtmlPreviewBlocks(null)).toEqual([]);
    expect(extractHtmlPreviewBlocks(42)).toEqual([]);
    const result = extractHtmlPreviewBlocks("```html\n" + "x".repeat(200_001) + "\n```");
    expect(result[0].source).toHaveLength(200_000);
  });
});

describe("HTML preview candidates", () => {
  it("supports text nodes and Markdown file nodes only", () => {
    expect(isHtmlPreviewCandidate({ id: "t", type: "text", text: "```html\n<p>x</p>\n```" } as any)).toBe(true);
    expect(isHtmlPreviewCandidate({ id: "m", type: "file", file: "notes/idea.md" } as any)).toBe(true);
    expect(isHtmlPreviewCandidate({ id: "p", type: "file", file: "docs/book.pdf" } as any)).toBe(false);
    expect(isHtmlPreviewCandidate({ id: "g", type: "group" } as any)).toBe(false);
  });
});
