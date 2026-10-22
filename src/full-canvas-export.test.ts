import { describe, expect, it } from "vitest";
import { canvasDataForSelection, canvasDataToFullSvg } from "./full-canvas-export";
import type { CanvasData } from "./canvas";
import { applySoftNotesPreset, SOFT_NOTES_PRESETS } from "./soft-notes-style";

const sample: CanvasData = {
  nodes: [
    { id: "a", type: "text", x: -240, y: 40, width: 180, height: 100, text: "Root & <notes>" },
    { id: "b", type: "text", x: 260, y: 180, width: 220, height: 140, text: "Child", color: "2", styleAttributes: { shape: "diamond" } }
  ],
  edges: [
    { id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }
  ]
};

describe("full content SVG export", () => {
  it("exports Soft Notes curves without strokes and keeps free text transparent", () => {
    let data: CanvasData = {
      bcTheme: "soft-notes",
      nodes: SOFT_NOTES_PRESETS.map((preset, index) => ({
        id: preset.id, type: "text", x: index * 400, y: 0, width: 380, height: 300, text: "## 标题\n\n原文 & <保持>"
      })),
      edges: []
    };
    for (const preset of SOFT_NOTES_PRESETS) data = applySoftNotesPreset(data, [preset.id], preset.id).data;
    const svg = canvasDataToFullSvg(data).svg;
    expect(svg.match(/class="bc-full-node bc-full-soft-notes-node"/g)).toHaveLength(6);
    for (const preset of SOFT_NOTES_PRESETS.filter(item => item.path)) {
      expect(svg).toContain('d="' + preset.path + '"');
      expect(svg).toContain('fill="' + preset.color + '" stroke="none"');
    }
    expect(svg).toContain('font-family="BC Soft Notes Title, cursive"');
    expect(svg).toContain('&amp; &lt;保持&gt;');
    const selection = canvasDataForSelection(data, ["free"]);
    const freeSvg = canvasDataToFullSvg(selection, { backgroundColor: "transparent" }).svg;
    expect(selection.bcTheme).toBe("soft-notes");
    expect(freeSvg).toContain('<g fill="transparent" stroke="none"></g>');
    expect(freeSvg).not.toContain("#efd4f7");
  });

  it("uses the union of node positions rather than a viewport size", () => {
    const result = canvasDataToFullSvg(sample, { margin: 10 });
    expect(result.width).toBe(740);
    expect(result.height).toBe(300);
    expect(result.svg).toContain('viewBox="0 0 740 300"');
    expect(result.svg).toContain("Root &amp; &lt;notes&gt;");
    expect(result.svg).toMatch(/marker-end="url\(#bc-arrow-\d+-end\)"/);
    expect(result.svg).toContain("<polygon");
  });

  it("exports custom arrow shapes at both edge ends using the edge color", () => {
    const result = canvasDataToFullSvg({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, text: "A" },
        { id: "b", type: "text", x: 220, y: 0, width: 100, height: 80, text: "B" }
      ],
      edges: [{
        id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
        color: "#ff0000", bcArrowStyle: "diamond", fromEnd: "arrow", toEnd: "arrow"
      }]
    });
    expect(result.svg).toContain('marker-start="url(#bc-arrow-0-start)"');
    expect(result.svg).toContain('marker-end="url(#bc-arrow-0-end)"');
    expect(result.svg).toContain('fill="#ff0000"');
    expect(result.svg).toContain("M1 6 L6 1 L11 6 L6 11 Z");
  });

  it("does not render arrow markers when the saved arrow style is none", () => {
    const result = canvasDataToFullSvg({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, text: "A" },
        { id: "b", type: "text", x: 220, y: 0, width: 100, height: 80, text: "B" }
      ],
      edges: [{
        id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
        bcArrowStyle: "none", styleAttributes: { arrow: "triangle" }, fromEnd: "none", toEnd: "none"
      }]
    });
    expect(result.svg).not.toContain("marker-start");
    expect(result.svg).not.toContain("marker-end");
  });

  it("does not append a truncation ellipsis just because words wrap at spaces", () => {
    const result = canvasDataToFullSvg({
      nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 180, height: 220, text: "alpha beta gamma delta epsilon zeta" }],
      edges: []
    });
    expect(result.svg).toContain("epsilon");
    expect(result.svg).toContain("zeta");
    expect(result.svg).not.toContain("…");
  });

  it("embeds a bounded raster image when export data includes a data URL", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "image",
        type: "file",
        file: "assets/demo.png",
        x: 20,
        y: 30,
        width: 240,
        height: 180,
        bcExportImageDataUrl: "data:image/png;base64,AAA="
      }],
      edges: []
    });
    expect(result.svg).toContain('<image');
    expect(result.svg).toContain('href="data:image/png;base64,AAA="');
    expect(result.svg).toContain("demo.png");
  });

  it("renders the complete built-in flowchart shape set in full-canvas exports", () => {
    const render = (shape: string) => canvasDataToFullSvg({
      nodes: [{
        id: "n", type: "text", x: 0, y: 0, width: 120, height: 80, text: shape,
        styleAttributes: { shape }
      }],
      edges: []
    }).svg;

    expect(render("triangle")).toContain('points="108,48 168,128 48,128"');
    expect(render("pentagon")).toContain("<polygon");
    expect(render("octagon")).toContain("<polygon");
    expect(render("trapezoid")).toContain("<polygon");
    expect(render("chevron")).toContain("<polygon");
    expect(render("cloud")).toContain("<polygon");
    expect(render("parallelogram")).toContain("<polygon");
    expect(render("predefined-process")).toContain("V 128 M");
    expect(render("document")).toContain('C 148.8 126.4');
    expect(render("database")).toContain('fill="none" stroke=');
    expect(render("pill")).toContain('rx="40"');
  });

  it("exports double node borders and text alignment metadata", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "double", type: "text", x: 0, y: 0, width: 160, height: 100, text: "Centered",
        bcBorderStyle: "double", bcTextAlign: "center"
      }],
      edges: []
    });
    expect(result.svg).toContain('text-anchor="middle"');
    expect(result.svg).toContain('stroke-width="1.5"');
    expect(result.svg).toContain('stroke-width="1"');
    expect(result.svg).toContain('<g transform="translate(');
  });

  it("preserves advanced node text, fill, border, and edge stroke attributes", () => {
    const result = canvasDataToFullSvg({
      nodes: [
        {
          id: "a", type: "text", x: 0, y: 0, width: 160, height: 100, text: "Styled node",
          styleAttributes: {
            shape: "rectangle",
            fillColor: "#abcdef",
            textColor: "#123456",
            fontFamily: "Georgia",
            fontWeight: "bold",
            fontStyle: "italic",
            textDecoration: "underline",
            textAlign: "center",
            borderWidth: 3
          }
        },
        { id: "b", type: "text", x: 240, y: 0, width: 160, height: 100, text: "B" }
      ],
      edges: [{
        id: "edge", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
        styleAttributes: { strokeColor: "rgb(12, 34, 56)", strokeWidth: 4, lineStyle: "dotted", arrow: "none" },
        fromEnd: "none", toEnd: "none"
      }]
    });

    expect(result.svg).toContain('fill="#abcdef"');
    expect(result.svg).toContain('font-family="Georgia"');
    expect(result.svg).toContain('font-weight="bold"');
    expect(result.svg).toContain('font-style="italic"');
    expect(result.svg).toContain('text-decoration="underline"');
    expect(result.svg).toContain('text-anchor="middle"');
    expect(result.svg).toContain('fill="#123456"');
    expect(result.svg).toContain('stroke="rgb(12, 34, 56)"');
    expect(result.svg).toContain('stroke-width="4"');
    expect(result.svg).toContain('stroke-dasharray="2 5"');
  });

  it("rejects unsafe color attribute text by falling back to a default", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "a", type: "text", x: 0, y: 0, width: 160, height: 100, text: "Safe",
        styleAttributes: { fillColor: 'url("javascript:alert(1)")', textColor: 'url("javascript:alert(1)")' }
      }],
      edges: [],
    });
    expect(result.svg).not.toContain("javascript:");
    expect(result.svg).toContain('fill="none"');
  });

  it("preserves direct and square pathfinding when exporting full Canvas SVG", () => {
    const nodes = [
      { id: "a", type: "text", x: 0, y: 0, width: 100, height: 80, text: "A" },
      { id: "b", type: "text", x: 220, y: 180, width: 100, height: 80, text: "B" }
    ];
    const render = (method: "direct" | "square") => canvasDataToFullSvg({
      nodes,
      edges: [{
        id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
        styleAttributes: { pathfindingMethod: method, arrow: "none" },
        fromEnd: "none", toEnd: "none"
      }]
    }, { margin: 0 }).svg;

    expect(render("direct")).toContain('d="M 100.00 40.00 L 220.00 220.00"');
    expect(render("square")).toContain('d="M 100.00 40.00 L 160.00 40.00 L 160.00 220.00 L 220.00 220.00"');
  });

  it("uses A-star routing around obstacles in a static export", () => {
    const result = canvasDataToFullSvg({
      nodes: [
        { id: "a", type: "text", x: 0, y: 60, width: 100, height: 80, text: "A" },
        { id: "obstacle", type: "text", x: 140, y: 30, width: 100, height: 170, text: "Obstacle" },
        { id: "b", type: "text", x: 300, y: 60, width: 100, height: 80, text: "B" }
      ],
      edges: [{
        id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left",
        styleAttributes: { pathfindingMethod: "a-star", arrow: "none" },
        fromEnd: "none", toEnd: "none"
      }]
    }, { margin: 0 }).svg;
    const edge = result.match(/<path id="bc-edge-0"[^>]*>/)?.[0] ?? "";
    expect(edge).toContain("d=");
    expect(edge.split(" L ").length - 1).toBeGreaterThan(1);
  });

  it("exports only selected nodes and edges whose endpoints are both selected", () => {
    const data: CanvasData = {
      nodes: [
        { id: "a", type: "text" as const, x: 0, y: 0, width: 100, height: 80, text: "A" },
        { id: "b", type: "text" as const, x: 150, y: 0, width: 100, height: 80, text: "B" },
        { id: "c", type: "text" as const, x: 300, y: 0, width: 100, height: 80, text: "C" }
      ],
      edges: [
        { id: "ab", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" },
        { id: "bc", fromNode: "b", fromSide: "right", toNode: "c", toSide: "left" },
        { id: "ac", fromNode: "a", fromSide: "right", toNode: "c", toSide: "left" }
      ],
      metadata: { keep: true }
    };
    const selection = canvasDataForSelection(data, ["a", "b"]);
    expect(selection.nodes.map(node => node.id)).toEqual(["a", "b"]);
    expect(selection.edges.map(edge => edge.id)).toEqual(["ab"]);
    expect(selection.metadata).toEqual({ keep: true });
  });

  it("returns an empty selection without leaking unrelated edges", () => {
    const result = canvasDataForSelection({ nodes: [], edges: [] }, []);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("renders the sketch theme with deterministic rough geometry, paper and a readable font", () => {
    const data: CanvasData = {
      bcTheme: "sketch",
      nodes: [
        { id: "h", type: "text", x: 0, y: 0, width: 280, height: 100, text: "项目启动", bcSketchPreset: "heading" },
        { id: "a", type: "text", x: 360, y: 0, width: 220, height: 120, text: "访谈用户", bcSketchPreset: "action" },
        { id: "r", type: "text", x: 0, y: 180, width: 240, height: 100, text: "需要确认", bcSketchPreset: "risk" }
      ],
      edges: [{ id: "e", fromNode: "h", fromSide: "right", toNode: "a", toSide: "left" }]
    };
    const first = canvasDataToFullSvg(data, { margin: 20 });
    const second = canvasDataToFullSvg(data, { margin: 20 });
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain('fill="#fffefb"');
    expect(first.svg).toContain('filter="url(#bc-sketch-wobble)"');
    expect(first.svg).toContain('font-family="BC Sketch Hand, Segoe Print, cursive"');
    expect(first.svg).toContain('font-weight="600"');
    expect(first.svg).toContain("项目启动");
    expect(first.svg).not.toContain("NaN");
    expect(canvasDataForSelection(data, ["h", "a"]).bcTheme).toBe("sketch");
  });

  it("supports an optional background and empty canvas", () => {
    const colored = canvasDataToFullSvg(sample, { backgroundColor: "#fff" });
    expect(colored.svg).toContain('fill="#fff"');
    const empty = canvasDataToFullSvg({ nodes: [], edges: [] }, { margin: 0 });
    expect(empty.width).toBe(800);
    expect(empty.height).toBe(600);
  });

  it("exports research paper, title bands and selection metadata without invented card text", () => {
    const data: CanvasData = {
      bcTheme: "research",
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 340, height: 260, text: "# 我的观点\n\n实际材料", bcResearchPreset: "argument" },
        { id: "b", type: "text", x: 400, y: 0, width: 340, height: 260, text: "只有正文", bcResearchPreset: "section", bcBorderStyle: "invisible" },
        { id: "c", type: "text", x: 800, y: 0, width: 340, height: 260, text: "", bcResearchPreset: "quote" }
      ],
      edges: []
    };
    const before = structuredClone(data);
    const result = canvasDataToFullSvg(data).svg;
    expect(result).toContain('fill="#eeece5"');
    expect(result).toContain("Songti SC");
    expect(result).toContain("我的观点");
    expect(result).toContain("只有正文");
    expect(result).not.toContain("[text node]");
    expect(result).not.toContain("核心观点");
    expect(result).not.toContain("章节标题");
    expect(result).not.toContain("NaN");
    expect(canvasDataForSelection(data, ["a"]).nodes[0].bcResearchPreset).toBe("argument");
    expect(canvasDataForSelection(data, ["a"]).bcTheme).toBe("research");
    expect(data).toEqual(before);
  });

  it("rejects impossible export dimensions before allocating an image canvas", () => {
    expect(() => canvasDataToFullSvg({
      nodes: [{ id: "giant", type: "text", x: 0, y: 0, width: 100_000, height: 100, text: "Giant" }],
      edges: []
    })).toThrow(/过大/);
  });

  it("renders common Markdown emphasis, code, links, headings and task markers as rich SVG text", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "rich", type: "text", x: 0, y: 0, width: 480, height: 260,
        text: "# Heading\n**bold** _italic_ ~~strike~~ \x60code\x60 [link](https://example.com/private)\n- [x] done\n[[folder/Note.md|Wiki label]]"
      }],
      edges: []
    });
    expect(result.svg).toContain("Heading");
    expect(result.svg).toContain('font-size="24" font-weight="bold"');
    expect(result.svg).toContain('<tspan font-weight="bold">bold</tspan>');
    expect(result.svg).toContain('<tspan font-style="italic">');
    expect(result.svg).toContain("italic</tspan>");
    expect(result.svg).toContain('text-decoration="line-through"');
    expect(result.svg).toContain('font-family="ui-monospace,SFMono-Regular,Consolas,monospace"');
    expect(result.svg).toContain('fill="#3467a9"');
    expect(result.svg).toContain("☑ done");
    expect(result.svg).toContain("Wiki label");
    expect(result.svg).not.toContain("https://example.com/private");
  });

  it("escapes HTML-looking node text in static exports instead of interpreting it", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "html", type: "text", x: 0, y: 0, width: 500, height: 100,
        text: "<script>alert('x')</script>"
      }],
      edges: []
    });
    expect(result.svg).toContain("&lt;script&gt;alert(&apos;x&apos;)&lt;/script&gt;");
    expect(result.svg).not.toContain("<script>");
  });



  it("renders Markdown tables as aligned SVG grid cells with rich inline styles", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "table", type: "text", x: 0, y: 0, width: 480, height: 260,
        text: "| **Name** | Description | Score |\n|:---|:---:|---:|\n| Alpha | [documentation](https://example.com/private) | 10 |\n| Beta | _plain text_ | 4 |"
      }],
      edges: []
    });
    const cellRects = result.svg.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="(?:#7b8794|none)"[^>]*stroke="#9aa3ad"/g) ?? [];
    expect(cellRects).toHaveLength(9);
    expect(result.svg).toContain('text-anchor="middle"');
    expect(result.svg).toContain('text-anchor="end"');
    expect(result.svg).toContain('<tspan font-weight="bold">Name</tspan>');
    expect(result.svg).toContain('<tspan fill="#3467a9" text-decoration="underline">documentation</tspan>');
    expect(result.svg).toContain('<tspan font-style="italic">plain text</tspan>');
    expect(result.svg).not.toContain("https://example.com/private");
    expect(result.svg).toContain('clip-path="url(#bc-clip-0)"');
  });

  it("clips large table layouts to their node bounds while preserving regular lines around the table", () => {
    const result = canvasDataToFullSvg({
      nodes: [{
        id: "mixed", type: "text", x: 0, y: 0, width: 220, height: 440,
        text: "Before table\n\n| Key | Details |\n|---|---|\n| A | several words should wrap inside a narrow cell |\n| B | another long description here |\n\nAfter table"
      }],
      edges: []
    });
    expect(result.svg).toContain("Before table");
    expect(result.svg).toContain("After table");
    expect(result.svg).toContain('clip-path="url(#bc-clip-0-table-2-0)"');
    expect(result.svg).toContain('width="220" height="440"');
  });

});
