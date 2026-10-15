import { describe, expect, it } from "vitest";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape } from "./canvas-node-style";

describe("Canvas node appearance fallback", () => {
  it("uses raw JSON styleAttributes when Better Canvas fields are absent", () => {
    const node = { styleAttributes: { shape: "diamond", border: "dotted" } };
    expect(resolveCanvasNodeShape(node)).toBe("diamond");
    expect(resolveCanvasNodeBorder(node)).toBe("dotted");
  });

  it("gives explicit Better Canvas style fields priority over raw attributes", () => {
    const node = {
      bcShape: "hexagon",
      bcBorderStyle: "dashed",
      styleAttributes: { shape: "diamond", border: "dotted" }
    };
    expect(resolveCanvasNodeShape(node)).toBe("hexagon");
    expect(resolveCanvasNodeBorder(node)).toBe("dashed");
  });

  it("retains defaults when neither source contains a usable value", () => {
    expect(resolveCanvasNodeShape({})).toBe("default");
    expect(resolveCanvasNodeBorder({})).toBe("solid");
    expect(resolveCanvasNodeShape({ styleAttributes: { shape: 7 } })).toBe("default");
    expect(resolveCanvasNodeBorder({ styleAttributes: { border: null } })).toBe("solid");
  });

  it("maps the JSON Canvas rectangle alias to the built-in default shape", () => {
    expect(resolveCanvasNodeShape({ styleAttributes: { shape: "rectangle" } })).toBe("default");
  });
});
