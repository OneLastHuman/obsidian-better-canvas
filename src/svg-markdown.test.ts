import { describe, expect, it } from "vitest";
import { layoutMarkdownForSvg, parseInlineMarkdownForSvg } from "./svg-markdown";

describe("static SVG Markdown layout", () => {
  it("preserves emphasis, code, links, and wiki-link labels as styled text runs", () => {
    const runs = parseInlineMarkdownForSvg(
      "**bold**, _italic_, ~~removed~~, \x60code\x60, [website](https://example.com/private), [[folder/Note.md|alias]], ![[assets/image.png]]"
    );
    expect(runs.map(run => run.text).join("")).toBe("bold, italic, removed, code, website, alias, image.png");
    expect(runs.find(run => run.text === "bold")?.style.bold).toBe(true);
    expect(runs.find(run => run.text === "italic")?.style.italic).toBe(true);
    expect(runs.find(run => run.text === "removed")?.style.strike).toBe(true);
    expect(runs.find(run => run.text === "code")?.style.code).toBe(true);
    expect(runs.find(run => run.text === "website")?.style.link).toBe(true);
    expect(runs.find(run => run.text === "alias")?.style.link).toBeUndefined();
  });

  it("uses heading scale, task markers, quotes, and ordered list prefixes", () => {
    const lines = layoutMarkdownForSvg("# Main heading\n- [x] done\n+ [ ] next\n2) second\n> quoted", 80, 20, 16);
    expect(lines[0].runs.map(run => run.text).join("")).toBe("Main heading");
    expect(lines[0].bold).toBe(true);
    expect(lines[0].fontScale).toBe(1.5);
    expect(lines[1].runs.map(run => run.text).join("")).toBe("☑ done");
    expect(lines[2].runs.map(run => run.text).join("")).toBe("☐ next");
    expect(lines[3].runs.map(run => run.text).join("")).toBe("2. second");
    expect(lines[4].runs.map(run => run.text).join("")).toBe("› quoted");
  });

  it("keeps Markdown punctuation literal inside fenced code blocks", () => {
    const lines = layoutMarkdownForSvg("Before\n\x60\x60\x60ts\nconst value = **literal**;\n\x60\x60\x60\nAfter", 80, 20, 16);
    const codeLine = lines.find(line => line.runs.some(run => run.text.includes("literal")));
    expect(codeLine?.runs.map(run => run.text).join("")).toBe("const value = **literal**;");
    expect(codeLine?.runs[0].style.code).toBe(true);
    expect(lines.map(line => line.runs.map(run => run.text).join("")).join("\n")).toBe(
      "Before\nconst value = **literal**;\nAfter"
    );
  });

  it("wraps long lines, preserves inline formatting after wrapping, and truncates to the height budget", () => {
    const wrapped = layoutMarkdownForSvg("alpha **beta gamma** delta", 10, 10, 16);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.flatMap(line => line.runs).some(run => run.text.includes("beta") && run.style.bold)).toBe(true);

    const bounded = layoutMarkdownForSvg("one\ntwo\nthree\nfour", 20, 2, 16);
    expect(bounded).toHaveLength(2);
    expect(bounded[1].runs.map(run => run.text).join("")).toContain("…");
  });

  it("does not evaluate or interpret HTML and emits it as ordinary text for later XML escaping", () => {
    const lines = layoutMarkdownForSvg("<script>alert(1)</script>", 80, 4, 16);
    expect(lines.flatMap(line => line.runs).map(run => run.text).join("")).toBe("<script>alert(1)</script>");
  });
});


describe("Markdown table layout for SVG", () => {
  it("parses header separators, cell alignment, inline formatting and escaped pipes", () => {
    const lines = layoutMarkdownForSvg(
      "| **Name** | Description | Score |\n|:---|:---:|---:|\n| Alpha | [documentation](https://example.com/private) | 10 |\n| Beta | value \\| total | 4 |",
      72,
      40,
      16
    );
    expect(lines).toHaveLength(3);
    expect(lines.every(line => Boolean(line.tableRow))).toBe(true);
    const header = lines[0].tableRow!;
    expect(header.isHeader).toBe(true);
    expect(header.cells.map(cell => cell.align)).toEqual(["left", "center", "right"]);
    expect(header.cells[0].lines[0].map(run => run.text).join("")).toBe("Name");
    expect(header.cells[0].lines[0].some(run => run.style.bold)).toBe(true);
    expect(lines[1].tableRow!.cells[1].lines[0].some(run => run.style.link)).toBe(true);
    expect(lines[2].tableRow!.cells[1].lines.flat().map(run => run.text).join("")).toBe("value | total");
    expect(lines[0].tableRow!.lineCount).toBeGreaterThanOrEqual(1);
  });

  it("wraps cell content and keeps the total table within the node height budget", () => {
    const lines = layoutMarkdownForSvg(
      "| First | Second |\n|---|---|\n| value | several words that need wrapping |\n| another | more content |",
      24,
      2,
      16
    );
    expect(lines.length).toBe(1);
    expect(lines[0].tableRow!.isHeader).toBe(true);
    expect(lines[0].tableRow!.cells[1].lines.flat().map(run => run.text).join("")).toContain("…");
  });

  it("does not interpret pipe-like content in fenced code as a table", () => {
    const lines = layoutMarkdownForSvg("\x60\x60\x60md\n| A | B |\n|---|---|\n\x60\x60\x60", 80, 10, 16);
    expect(lines.every(line => !line.tableRow)).toBe(true);
    expect(lines.map(line => line.runs.map(run => run.text).join("")).join("\n")).toBe("| A | B |\n|---|---|");
  });
});
