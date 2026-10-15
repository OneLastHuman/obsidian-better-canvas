import { describe, expect, it } from "vitest";
import { buildAutoFileNodeEdges, extractAutoEdgeTargets } from "./canvas-auto-edges";

describe("extractAutoEdgeTargets", () => {
  it("supports plain paths, wikilinks, aliases, and multiple links", () => {
    expect(extractAutoEdgeTargets([
      "Notes/Alpha.md",
      "connect [[Notes/Beta.md|Beta]] and [[Notes/Gamma.md]]",
      "[[Notes/Beta.md|duplicate]]"
    ])).toEqual(["Notes/Alpha.md", "Notes/Beta.md", "Notes/Gamma.md"]);
  });

  it("ignores non-string and empty values", () => {
    expect(extractAutoEdgeTargets([null, 42, {}, "", "   ", "[[ ]]"])).toEqual([]);
    expect(extractAutoEdgeTargets(undefined)).toEqual([]);
  });

  it("preserves target order while deduplicating repeated links", () => {
    expect(extractAutoEdgeTargets("first [[B]] then [[A]] then [[B]]"))
      .toEqual(["first [[B]] then [[A]] then [[B]]", "B", "A"]);
  });
});

describe("buildAutoFileNodeEdges", () => {
  const nodes = [
    { id: "a", file: "A.md" },
    { id: "b", file: "B.md" },
    { id: "b-copy", file: "B.md" },
    { id: "c", file: "C.md" }
  ];
  const frontmatter: Record<string, unknown> = {
    "A.md": ["[[B.md|B]]", "B.md", "[[B.md]]", "[[missing.md]]"],
    "B.md": "[[B.md]]",
    "C.md": 100
  };
  const destinations: Record<string, string> = {
    "B.md": "B.md",
    "missing.md": "missing.md"
  };
  const read = (path: string) => frontmatter[path];
  const resolve = (path: string) => destinations[path];

  it("creates one edge per source-target pair even when frontmatter repeats links", () => {
    const edges = buildAutoFileNodeEdges(nodes, read, resolve);
    expect(edges.map(edge => edge.id)).toEqual([
      "bc-auto-a-b",
      "bc-auto-a-b-copy"
    ]);
    expect(edges[0]).toMatchObject({
      fromNode: "a",
      fromSide: "right",
      fromFloating: true,
      toNode: "b",
      toSide: "left",
      toFloating: true
    });
  });

  it("never creates self edges or edges for unresolved/non-string values", () => {
    const edges = buildAutoFileNodeEdges(nodes, read, resolve);
    expect(edges.some(edge => edge.fromNode === edge.toNode)).toBe(false);
    expect(edges.every(edge => edge.toNode !== "c")).toBe(true);
  });

  it("returns an empty list if there are no file nodes or usable targets", () => {
    expect(buildAutoFileNodeEdges([], read, resolve)).toEqual([]);
    expect(buildAutoFileNodeEdges([{ id: "a", file: "C.md" }], read, resolve)).toEqual([]);
  });
});
