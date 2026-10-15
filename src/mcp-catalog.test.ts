import { describe, expect, it } from "vitest";
import {
  collectMcpCatalogPages,
  formatMcpPromptCatalog,
  formatMcpPromptResult,
  formatMcpResourceCatalog,
  formatMcpResourceRead,
  normalizeMcpPromptPage,
  normalizeMcpResourcePage,
  parseMcpPromptArguments
} from "./mcp-catalog";

describe("MCP resources and prompts catalog", () => {
  it("normalizes resource and prompt pages and discards malformed entries", () => {
    expect(normalizeMcpResourcePage({
      resources: [
        { uri: "file:///safe.txt", name: "Safe", mimeType: "text/plain" },
        { uri: " " },
        { name: "missing uri" }
      ],
      nextCursor: "next"
    })).toEqual({
      items: [{ uri: "file:///safe.txt", name: "Safe", mimeType: "text/plain" }],
      nextCursor: "next"
    });
    expect(normalizeMcpPromptPage({
      prompts: [
        { name: "review", arguments: [{ name: "topic", required: true }, { name: 7 }] },
        { name: "" }
      ]
    })).toEqual({ items: [{ name: "review", arguments: [{ name: "topic", required: true }] }] });
  });

  it("follows cursor pages, deduplicates entries and rejects repeated cursors", async () => {
    const fetchPage = async (cursor?: string) => cursor
      ? { items: [{ id: "b" }, { id: "b" }, { id: "c" }] }
      : { items: [{ id: "a" }, { id: "b" }], nextCursor: "page-2" };
    await expect(collectMcpCatalogPages(fetchPage, item => item.id)).resolves.toEqual([
      { id: "a" }, { id: "b" }, { id: "c" }
    ]);
    await expect(collectMcpCatalogPages(async cursor => ({
      items: [],
      nextCursor: cursor === "again" ? "again" : "again"
    }), item => String(item))).rejects.toThrow(/repeated pagination cursor/);
  });

  it("stops hostile or broken pagination after a bounded number of pages", async () => {
    const fetchPage = async (cursor?: string) => ({
      items: [],
      nextCursor: "page-" + String(Number((cursor ?? "page-0").replace("page-", "")) + 1)
    });
    await expect(collectMcpCatalogPages(fetchPage, item => String(item), 2)).rejects.toThrow(/2-page safety limit/);
  });

  it("validates prompt arguments as a JSON object of string values", () => {
    expect(parseMcpPromptArguments('{"topic":"science","detail":"brief"}')).toEqual({ topic: "science", detail: "brief" });
    expect(() => parseMcpPromptArguments("{")).toThrow(/JSON/);
    expect(() => parseMcpPromptArguments("[]")).toThrow(/object/);
    expect(() => parseMcpPromptArguments('{"count":2}')).toThrow(/字符串/);
  });

  it("formats catalogs with URIs, MIME types and required prompt arguments", () => {
    expect(formatMcpResourceCatalog([{ uri: "note://a", name: "A note", mimeType: "text/plain" }]))
      .toContain("note://a");
    expect(formatMcpPromptCatalog([{ name: "review", description: "Review a note", arguments: [{ name: "topic", required: true }] }]))
      .toContain("topic（必填）");
    expect(formatMcpResourceCatalog([])).toContain("未公开 resources");
    expect(formatMcpPromptCatalog([])).toContain("未公开 prompts");
  });

  it("formats resource text and safely marks unsupported binary content", () => {
    const result = formatMcpResourceRead("note://safe", {
      contents: [
        { uri: "note://safe", mimeType: "text/plain", text: "Allowed text" },
        { uri: "note://binary", mimeType: "application/octet-stream", blob: "AAEC" }
      ]
    });
    expect(result.text).toContain("URI: note://safe");
    expect(result.text).toContain("Allowed text");
    expect(result.text).toContain("未内嵌内容");
    expect(result.images).toEqual([]);
  });

  it("formats prompt message roles, preserving text and valid image blocks", () => {
    const result = formatMcpPromptResult("summarize", {
      description: "Summarize material",
      messages: [
        { role: "user", content: { type: "text", text: "Use cautious language." } },
        { role: "assistant", content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }] }
      ]
    });
    expect(result.text).toContain("[user] Use cautious language.");
    expect(result.text).toContain("Summarize material");
    expect(result.images).toEqual([{ mimeType: "image/png", data: "iVBORw0KGgo=" }]);
  });
});
