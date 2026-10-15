import { describe, expect, it } from "vitest";
import { applyCustomStyleChoice, cssSnippetVaultPathFromHref, parseCssStyleDefinitions, type CustomStyleDefinition } from "./custom-style-presets";

describe("parseCssStyleDefinitions", () => {
  it("parses node and edge style declarations with reset options", () => {
    const css = [
      "/* @advanced-canvas-node-style",
      "key: validation-state",
      "label: Validation State",
      "icon: hourglass # an inline comment",
      "options:",
      "  -",
      "    label: Stateless",
      "    value: null",
      "    icon: circle-help",
      "  -",
      "    label: Approved",
      "    value: approved",
      "    icon: circle-check",
      "*/",
      "/* @advanced-canvas-edge-style",
      "key: relation-state",
      "label: Relation State",
      "options:",
      "  - label: Default",
      "    value: null",
      "  - label: Reviewed",
      "    value: 'reviewed'",
      "*/"
    ].join("\n");
    expect(parseCssStyleDefinitions(css)).toEqual([
      {
        kind: "node",
        key: "validation-state",
        label: "Validation State",
        icon: "hourglass",
        options: [
          { label: "Stateless", value: null, icon: "circle-help" },
          { label: "Approved", value: "approved", icon: "circle-check" }
        ]
      },
      {
        kind: "edge",
        key: "relation-state",
        label: "Relation State",
        options: [
          { label: "Default", value: null },
          { label: "Reviewed", value: "reviewed" }
        ]
      }
    ]);
  });

  it("ignores malformed definitions, unsafe keys and definitions without exactly one null reset", () => {
    const css = [
      "/* @advanced-canvas-node-style",
      "key: onclick!",
      "label: Unsafe",
      "options:",
      "  - label: Reset",
      "    value: null",
      "  - label: Run",
      "    value: active",
      "*/",
      "/* @advanced-canvas-node-style",
      "key: valid-key",
      "label: Missing reset",
      "options:",
      "  - label: Active",
      "    value: active",
      "*/",
      "/* @advanced-canvas-edge-style",
      "key: valid-edge",
      "label: Valid",
      "options:",
      "  - label: Reset",
      "    value: null",
      "  - label: Active",
      "    value: active",
      "*/"
    ].join("\n");
    expect(parseCssStyleDefinitions(css).map(definition => definition.key)).toEqual(["valid-edge"]);
  });

  it("uses the last declaration for a repeated kind/key pair", () => {
    const css = [
      "/* @advanced-canvas-node-style",
      "key: status",
      "label: First",
      "options:",
      "  - label: Reset",
      "    value: null",
      "  - label: Open",
      "    value: open",
      "*/",
      "/* @advanced-canvas-node-style",
      "key: status",
      "label: Replaced",
      "options:",
      "  - label: Reset",
      "    value: null",
      "  - label: Closed",
      "    value: closed",
      "*/"
    ].join("\n");
    const parsed = parseCssStyleDefinitions(css);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe("Replaced");
    expect(parsed[0].options[1].value).toBe("closed");
  });
});

describe("applyCustomStyleChoice", () => {
  const nodeDefinition: CustomStyleDefinition = {
    kind: "node",
    key: "validation-state",
    label: "Validation State",
    options: [
      { label: "Stateless", value: null },
      { label: "Approved", value: "approved" }
    ]
  };

  const edgeDefinition: CustomStyleDefinition = {
    kind: "edge",
    key: "relation-state",
    label: "Relation State",
    options: [
      { label: "Default", value: null },
      { label: "Reviewed", value: "reviewed" }
    ]
  };

  it("applies a node choice immutably while preserving other metadata and attributes", () => {
    const original = {
      metadata: { keep: true },
      nodes: [
        { id: "n1", text: "A", styleAttributes: { shape: "diamond" } },
        { id: "n2", text: "B" }
      ],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }]
    };
    const result = applyCustomStyleChoice(original, ["n1", "n2"], nodeDefinition, "approved");
    expect(result.updated).toBe(2);
    expect(result.data.nodes[0].styleAttributes).toEqual({ shape: "diamond", "validation-state": "approved" });
    expect(result.data.nodes[1].styleAttributes).toEqual({ "validation-state": "approved" });
    expect(result.data.metadata).toEqual({ keep: true });
    expect(original.nodes[0].styleAttributes).toEqual({ shape: "diamond" });
  });

  it("applies edge choices only to selected edges", () => {
    const original = {
      nodes: [{ id: "n1" }, { id: "n2" }],
      edges: [
        { id: "e1", fromNode: "n1", toNode: "n2", styleAttributes: { path: "dotted" } },
        { id: "e2", fromNode: "n2", toNode: "n1" }
      ]
    };
    const result = applyCustomStyleChoice(original, ["e1"], edgeDefinition, "reviewed");
    expect(result.updated).toBe(1);
    expect(result.data.edges[0].styleAttributes).toEqual({ path: "dotted", "relation-state": "reviewed" });
    expect(result.data.edges[1]).toEqual(original.edges[1]);
  });

  it("stores an explicit null reset and refuses values not present in the definition", () => {
    const data = { nodes: [{ id: "n1", styleAttributes: { "validation-state": "approved" } }], edges: [] };
    const reset = applyCustomStyleChoice(data, ["n1"], nodeDefinition, null);
    expect(reset.updated).toBe(1);
    expect(reset.data.nodes[0].styleAttributes).toEqual({ "validation-state": null });
    const invalid = applyCustomStyleChoice(data, ["n1"], nodeDefinition, "unlisted");
    expect(invalid.data).toBe(data);
    expect(invalid.updated).toBe(0);
  });
});


describe("CSS snippet path resolution", () => {
  it("resolves a local enabled snippet under the configured Vault directory", () => {
    expect(cssSnippetVaultPathFromHref(
      "app://obsidian.md/Users/test/Vault/.obsidian/snippets/node-styles.css",
      ".obsidian"
    )).toBe(".obsidian/snippets/node-styles.css");
  });

  it("supports custom config directories and URL-encoded snippet names", () => {
    expect(cssSnippetVaultPathFromHref(
      "file:///Users/test/Vault/_obsidian/snippets/theme%20one.css",
      "_obsidian"
    )).toBe("_obsidian/snippets/theme one.css");
  });

  it("rejects remote stylesheets, non-snippet paths, and non-CSS files", () => {
    expect(cssSnippetVaultPathFromHref("https://example.com/snippets/theme.css", ".obsidian")).toBeNull();
    expect(cssSnippetVaultPathFromHref("app://obsidian.md/app.css", ".obsidian")).toBeNull();
    expect(cssSnippetVaultPathFromHref("app://obsidian.md/.obsidian/snippets/theme.js", ".obsidian")).toBeNull();
  });
});
