import { describe, expect, it } from "vitest";
import { buildPdfAnnotationMarkdown } from "./pdf-annotation-export";

function pinnedPdf(id: string, file: string, page: number, extra: Record<string, unknown> = {}) {
  return { id, type: "file", file, subpath: "#page=" + page + "&pinned=true", ...extra };
}

describe("buildPdfAnnotationMarkdown", () => {
  it("exports pinned-page highlights and stroke coordinates in deterministic order", () => {
    const nodes = [
      pinnedPdf("later", "papers/zeta.pdf", 10, {
        bcPdfStrokes: [{
          points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }],
          color: "#e53935", width: 5, tool: "pen", createdAt: 100
        }]
      }),
      pinnedPdf("first", "papers/alpha.pdf", 2, {
        bcPdfTextHighlights: [{
          text: "Important result\nsecond line",
          rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
          color: "#ffeb3b", opacity: 0.36, createdAt: 50
        }]
      }),
      { id: "ordinary", type: "file", file: "papers/alpha.pdf", subpath: "#page=1" }
    ];

    const result = buildPdfAnnotationMarkdown(
      nodes, "notes/research.canvas", new Date("2026-10-15T00:00:00.000Z")
    );

    expect(result).not.toBeNull();
    expect(result?.pageCount).toBe(2);
    expect(result?.highlightCount).toBe(1);
    expect(result?.strokeCount).toBe(1);
    expect(result?.markdown.indexOf("papers/alpha.pdf")).toBeLessThan(
      result?.markdown.indexOf("papers/zeta.pdf") ?? 0
    );
    expect(result?.markdown).toContain("> Important result");
    expect(result?.markdown).toContain("> second line");
    expect(result?.markdown).toContain('"points"');
    expect(result?.markdown).toContain("notes/research.canvas");
  });

  it("escapes HTML in excerpts and chooses a fence longer than embedded backticks", () => {
    const ticks = String.fromCharCode(96).repeat(3);
    const result = buildPdfAnnotationMarkdown([
      pinnedPdf("html", "book.pdf", 1, {
        bcPdfTextHighlights: [{
          text: "<script>alert(1)</script> " + ticks, rects: [], createdAt: 0
        }]
      })
    ]);
    expect(result?.markdown).toContain("&lt;script&gt;");
    expect(result?.markdown).toContain("alert(1)");
    expect(result?.markdown).toContain("归一化坐标数据");
    expect(result?.markdown).toContain(ticks);
  });

  it("rejects ordinary PDF embeds and malformed or empty annotation data", () => {
    expect(buildPdfAnnotationMarkdown([
      { id: "not-pinned", type: "file", file: "book.pdf", subpath: "#page=1", bcPdfStrokes: [{ points: [{ x: 0, y: 0 }] }] },
      pinnedPdf("broken-page", "book.pdf", 0, { bcPdfTextHighlights: [{ text: "bad" }] }),
      pinnedPdf("empty", "book.pdf", 1, { bcPdfStrokes: [{ points: [{ x: Number.NaN, y: 0 }] }] })
    ])).toBeNull();
  });

  it("bounds oversized coordinate and annotation payloads", () => {
    const points = Array.from({ length: 1200 }, (_, index) => ({
      x: index / 1199, y: (1199 - index) / 1199
    }));
    const result = buildPdfAnnotationMarkdown([
      pinnedPdf("large", "book.pdf", 1, {
        bcPdfStrokes: [{ points, color: "#1e88e5", width: 5 }]
      })
    ]);
    expect(result?.truncated).toBe(true);
    expect(result?.strokeCount).toBe(1);
    expect(result?.markdown).toContain("导出限制");
    expect(result?.markdown).toContain('"points"');
    expect(result?.markdown).not.toContain('"x": 1,\n      "y": 0');
  });

  it("returns null for a missing or non-array node list", () => {
    expect(buildPdfAnnotationMarkdown(null)).toBeNull();
    expect(buildPdfAnnotationMarkdown({})).toBeNull();
  });
});
