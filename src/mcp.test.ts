import { describe, expect, it } from "vitest";
import { normalizeMcpToolResult } from "./mcp";

describe("MCP result normalization", () => {
  it("preserves text blocks and image payloads", () => {
    const result = normalizeMcpToolResult({
      content: [
        { type: "text", text: "Found three useful results." },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
        { type: "text", text: "See the attached chart." }
      ]
    });

    expect(result.text).toBe("Found three useful results.\nSee the attached chart.");
    expect(result.images).toEqual([
      { mimeType: "image/png", data: "iVBORw0KGgo=" }
    ]);
  });

  it("retains unrecognized content as readable JSON", () => {
    const result = normalizeMcpToolResult({
      content: [
        { type: "resource", resource: { uri: "file:///report.txt" } }
      ]
    });

    expect(result.text).toContain('"type": "resource"');
    expect(result.images).toEqual([]);
  });

  it("normalizes plain string and JSON results", () => {
    expect(normalizeMcpToolResult("complete")).toEqual({ text: "complete", images: [] });
    expect(normalizeMcpToolResult({ count: 2 })).toEqual({
      text: JSON.stringify({ count: 2 }, null, 2),
      images: []
    });
  });

  it("does not treat malformed image blocks as valid images", () => {
    const result = normalizeMcpToolResult({
      content: [
        { type: "image", mimeType: "image/png" },
        { type: "image", data: "abc" },
        { type: "text", text: "safe text" }
      ]
    });

    expect(result.text).toBe("safe text");
    expect(result.images).toEqual([]);
  });
});
