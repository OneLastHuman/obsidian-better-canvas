import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { CanvasData } from "./canvas";
import { canvasDataForSelection, canvasDataToFullSvg } from "./full-canvas-export";
import { decorateCanvasTheme, resolveCanvasTheme, setCanvasTheme } from "./canvas-theme";
import { ROUNDED_MAP_PRESETS } from "./node-visual-style";
import { applyRoundedMapPreset, roundedMapCss, roundedMapPath } from "./rounded-map-style";

function fixture(): CanvasData {
  return {
    custom: { keep: true },
    nodes: [
      { id: "a", type: "text", text: "Keep <content>", x: 0, y: 0, width: 300, height: 180, styleAttributes: { custom: "keep", shape: "hexagon" } },
      { id: "b", type: "file", file: "Example.md", x: 400, y: 0, width: 300, height: 180 },
      { id: "group", type: "group", x: -40, y: -40, width: 800, height: 300 }
    ],
    edges: [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", label: "yes" }]
  };
}

describe("rounded map functional presets", () => {
  it("joins the document wave smoothly to both sides at preview and node sizes", () => {
    const html = readFileSync(new URL("../docs/design/rounded-map-theme.prototype.html", import.meta.url), "utf8");
    const source = html.slice(html.indexOf("    function shapeMarkup("), html.indexOf("    function renderPresetPicker("));
    const prototypePath = (width: number, height: number): string => {
      const markup = runInNewContext(source + `; shapeMarkup({id:"document"}, ${width}, ${height})`, { radius: 33 });
      return /class="shape-face" d="([^"]+)"/.exec(markup)![1];
    };
    for (const pathFor of [prototypePath, (w: number, h: number) => roundedMapPath("document", w, h)!]) {
      for (const [width, height] of [[120, 80], [300, 180], [480, 120], [120, 300]]) {
        let cursor = [0, 0], previousTangent: number[] | null = null;
        for (const match of pathFor(width, height).matchAll(/([MHVQC])([^MHVQCZ]*)/g)) {
          const values = match[2].trim().split(/[\s,]+/).map(Number);
          const command = match[1];
          if (command === "M") { cursor = values; continue; }
          const end = command === "H" ? [values[0], cursor[1]] : command === "V" ? [cursor[0], values[0]] : values.slice(-2);
          const control1 = command === "Q" || command === "C" ? values.slice(0, 2) : end;
          const control2 = command === "C" ? values.slice(2, 4) : command === "Q" ? control1 : cursor;
          const incoming = [control1[0] - cursor[0], control1[1] - cursor[1]];
          if (previousTangent && Math.hypot(...incoming) > 0) {
            const cosine = (incoming[0] * previousTangent[0] + incoming[1] * previousTangent[1]) /
              (Math.hypot(...incoming) * Math.hypot(...previousTangent));
            expect(cosine, `document ${width}x${height} has a crease before ${command}`).toBeCloseTo(1, 4);
          }
          const outgoing = [end[0] - control2[0], end[1] - control2[1]];
          if (Math.hypot(...outgoing) > 0) previousTangent = outgoing;
          cursor = end;
        }
      }
    }
  });

  it("applies six distinct shapes immutably while preserving content, geometry and extensions", () => {
    const data = fixture();
    const snapshot = structuredClone(data);
    Object.freeze(data.nodes[0].styleAttributes);
    const shapes = new Set<string>();
    for (const preset of ROUNDED_MAP_PRESETS) {
      const result = applyRoundedMapPreset(data, ["a", "b", "group"], preset.id);
      expect(result.updated).toBe(2);
      expect(result.data.edges).toBe(data.edges);
      expect(result.data.custom).toBe(data.custom);
      expect(result.data.nodes[2]).toBe(data.nodes[2]);
      expect(result.data.nodes[0]).toMatchObject({
        text: "Keep <content>", x: 0, y: 0, width: 300, height: 180,
        bcShape: preset.style.shape, bcBorderStyle: "solid",
        styleAttributes: { custom: "keep", border: "solid", textAlign: preset.style.align }
      });
      expect(result.data.nodes[1].file).toBe("Example.md");
      shapes.add(String(result.data.nodes[0].bcShape));
    }
    expect(shapes.size).toBe(6);
    expect(data).toEqual(snapshot);
  });

  it("ignores unknown presets, missing selections and groups", () => {
    const data = fixture();
    for (const [ids, preset] of [[["a"], "unknown"], [[], "decision"], [["group"], "process"], [["missing"], "io"]] as const) {
      expect(applyRoundedMapPreset(data, ids, preset)).toEqual({ data, updated: 0 });
    }
  });

  it("uses the same paths for CSS masks and full/selection export after JSON round-trip", () => {
    let data = { ...fixture(), bcTheme: "rounded-map" };
    data.nodes = ROUNDED_MAP_PRESETS.map((preset, index) => ({
      ...applyRoundedMapPreset(fixture(), ["a"], preset.id).data.nodes[0],
      id: preset.id, x: index * 360
    }));
    data.edges = [];
    data = JSON.parse(JSON.stringify(data));
    expect(resolveCanvasTheme(data)).toBe("rounded-map");
    const paths = new Set<string>();
    const svg = canvasDataToFullSvg(data).svg;
    for (const preset of ROUNDED_MAP_PRESETS) {
      const path = roundedMapPath(preset.style.shape, 300, 180)!;
      paths.add(path);
      expect(path).not.toMatch(/NaN|Infinity/);
      expect(svg).toContain(`d="${path}"`);
      expect(svg).toContain(`fill="${preset.style.color}"`);
      expect(decodeURIComponent(roundedMapCss(preset.style.shape, 300, 180)["--bc-rounded-ring"])).toContain(`d="${path}"`);
    }
    expect(paths.size).toBe(6);
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain("Keep &lt;content&gt;");
    const selected = canvasDataForSelection(data, ["decision"]);
    expect(selected.bcTheme).toBe("rounded-map");
    expect(canvasDataToFullSvg(selected).svg).toContain("bc-full-rounded-node");
    expect(roundedMapPath("diamond", NaN, 180)).toBeNull();
    expect(roundedMapPath("diamond", 0, 180)).toBeNull();
  });

  it("decorates without writing, updates size-dependent paths and clears them on theme switch", () => {
    let data = { ...fixture(), bcTheme: "rounded-map" };
    const vars = new Map<string, string>();
    const nodeEl = { dataset: {} as Record<string, string>, style: {
      getPropertyValue: (key: string) => vars.get(key),
      setProperty: (key: string, value: string) => vars.set(key, value),
      removeProperty: (key: string) => vars.delete(key)
    } };
    // Exercise the theme's default rounded rectangle rather than the fixture's explicit hexagon.
    data.nodes[0].bcShape = "default";
    const canvas = { getData: () => data, nodes: new Map([["a", { nodeEl }]]), wrapperEl: { dataset: {} } };
    const snapshot = structuredClone(data);
    decorateCanvasTheme(canvas);
    expect(data).toEqual(snapshot);
    expect(nodeEl.dataset.bcRounded).toBe("true");
    const oldClip = vars.get("--bc-rounded-clip");
    data.nodes[0].width = 450;
    decorateCanvasTheme(canvas);
    expect(vars.get("--bc-rounded-clip")).not.toBe(oldClip);
    data = { ...data, bcTheme: "default" };
    decorateCanvasTheme(canvas);
    expect(nodeEl.dataset.bcRounded).toBeUndefined();
    expect(vars.size).toBe(0);
  });

  it("records theme undo history and rejects a read-only Canvas", () => {
    const history: CanvasData[] = [];
    const canvas = {
      data: fixture(), readonly: false,
      getData() { return this.data; },
      pushHistory(data: CanvasData) { history.push(structuredClone(data)); }
    };
    expect(setCanvasTheme(canvas, "rounded-map")).toBe(true);
    expect(history.map(data => data.bcTheme)).toEqual([undefined, "rounded-map"]);
    canvas.data = history[0];
    expect(resolveCanvasTheme(canvas.data)).toBe("default");
    canvas.readonly = true;
    expect(setCanvasTheme(canvas, "rounded-map")).toBe(false);
  });

  it("keeps decision labels escaped and visible in rounded flow exports", () => {
    const data = { ...fixture(), bcTheme: "rounded-map" };
    data.edges[0].label = 'Yes <script> & "No"';
    const svg = canvasDataToFullSvg(data).svg;
    expect(svg).toContain('Yes &lt;script&gt; &amp; &quot;No&quot;');
    expect(svg).toContain('paint-order="stroke fill"');
    expect(svg).toMatch(/id="bc-edge-0" d="M [^"]+ C /);
    expect(svg).not.toContain("<script>");
    expect(canvasDataToFullSvg({ ...data, edges: [{ ...data.edges[0], bcColor: "#123456" }] }).svg)
      .toMatch(/id="bc-edge-0"[^>]+stroke="#123456"/);
  });
});
