import { describe, expect, it } from "vitest";
import { readCanvasFrontmatter, replaceCanvasFrontmatter } from "./canvas-frontmatter";

describe("Canvas frontmatter JSON editor helpers", () => {
  it("reads frontmatter without modifying the document", () => {
    const raw = JSON.stringify({
      nodes: [{ id: "n1", type: "text", text: "keep me" }],
      edges: [],
      metadata: { version: "1.0-1.0", author: "other-plugin", frontmatter: { tags: ["notes"] } }
    });
    const result = readCanvasFrontmatter(raw);

    expect(result.frontmatter).toEqual({ tags: ["notes"] });
    expect(result.document.nodes).toEqual([{ id: "n1", type: "text", text: "keep me" }]);
    expect(result.metadata.author).toBe("other-plugin");
  });

  it("replaces all frontmatter keys and preserves canvas nodes and other metadata", () => {
    const raw = JSON.stringify({
      nodes: [{ id: "n1", type: "text", text: "newer live data" }],
      edges: [],
      pluginField: { keep: true },
      metadata: { version: "future-version", author: "external", frontmatter: { old: true } }
    });
    const result = replaceCanvasFrontmatter(raw, JSON.stringify({ project: "canvas", tags: ["one", "two"] }));
    const saved = JSON.parse(result.serialized);

    expect(saved.metadata.frontmatter).toEqual({ project: "canvas", tags: ["one", "two"] });
    expect(saved.metadata.version).toBe("future-version");
    expect(saved.metadata.author).toBe("external");
    expect(saved.nodes).toEqual([{ id: "n1", type: "text", text: "newer live data" }]);
    expect(saved.pluginField).toEqual({ keep: true });
    expect(result.metadata).toEqual(saved.metadata);
  });

  it("initializes missing metadata and frontmatter while preserving other root fields", () => {
    const result = replaceCanvasFrontmatter('{"nodes":[],"edges":[]}', '{"status":"draft"}');
    const saved = JSON.parse(result.serialized);

    expect(saved.metadata.version).toBe("1.0-1.0");
    expect(saved.metadata.frontmatter).toEqual({ status: "draft" });
    expect(saved.nodes).toEqual([]);
    expect(saved.edges).toEqual([]);
  });

  it.each(["[]", "null", '"text"', "42", "{broken"])(
    "rejects invalid frontmatter JSON values: %s",
    raw => {
      expect(() => replaceCanvasFrontmatter('{"nodes":[]}', raw)).toThrow();
    }
  );

  it("rejects invalid Canvas documents", () => {
    expect(() => readCanvasFrontmatter("not json")).toThrow(/有效的 JSON/);
    expect(() => readCanvasFrontmatter("[]")).toThrow(/JSON 对象/);
  });

  it("rejects dangerous top-level property names", () => {
    expect(() => replaceCanvasFrontmatter('{"nodes":[]}', '{"__proto__":{"polluted":true}}'))
      .toThrow(/保留属性名/);
    expect(() => replaceCanvasFrontmatter('{"nodes":[]}', '{"constructor":"x"}'))
      .toThrow(/保留属性名/);
  });
});
