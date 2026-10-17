import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the shape-aware node borders (#133).
 *
 * Obsidian paints the Canvas card on `.canvas-node-container`; `.canvas-node`
 * is only the positioning anchor. A rectangular container border cannot follow
 * a clip-path outline, so polygon shapes hide the container border and stroke
 * the outline with the `::after` ring masks. These assertions keep the CSS
 * contract in sync, because breaking it silently degrades to a border that is
 * cut into stubs or to a borderless shape.
 */
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

interface CssRule {
  selectors: string;
  body: string;
}

function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].replace(/\s+/g, " ").trim();
    if (selectors) rules.push({ selectors, body: match[2] });
  }
  return rules;
}

const rules = parseRules(styles);

function rulesFor(fragment: string): CssRule[] {
  return rules.filter(rule => rule.selectors.includes(fragment));
}

/** Reads the last declaration of `property` from the rules matching `fragment`. */
function declaration(fragment: string, property: string): string | null {
  const match = rulesFor(fragment)
    .map(rule => new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule.body))
    .filter(Boolean)
    .pop() as RegExpExecArray | undefined;
  return match ? match[1].trim().replace(/\s*!important$/, "") : null;
}

/** Coordinate pairs, independent of the `x y, x y` / `x,y x,y` notation. */
function coordinatePairs(text: string): string[] {
  const numbers = text.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const pairs: string[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.push(`${numbers[index]},${numbers[index + 1]}`);
  }
  return pairs;
}

/** Panel shapes plus the Advanced JSON Canvas outline set and its aliases. */
const POLYGON_SHAPES = [
  "diamond", "decision",
  "parallelogram", "input-output",
  "hexagon", "pentagon", "octagon", "triangle", "trapezoid", "chevron", "cloud", "document",
];

const RING_STYLES = ["solid", "dashed", "dotted"] as const;

const containerSelector = (shape: string) => `.canvas-node[data-bc-shape="${shape}"] .canvas-node-container`;
const ringSelector = (shape: string) => `.canvas-node[data-bc-shape="${shape}"]::after`;
const anchorSelector = (shape: string) => `.canvas-node[data-bc-shape="${shape}"]`;

function outlinePoints(shape: string): string[] | null {
  const outline = declaration(anchorSelector(shape), "--bc-shape-outline");
  return outline ? coordinatePairs(outline) : null;
}

function ringMaskPoints(shape: string, style: string): string[] | null {
  const value = declaration(anchorSelector(shape), `--bc-ring-${style}`);
  const match = value?.match(/points='([^']+)'/);
  return match ? coordinatePairs(match[1]) : null;
}

describe("shape border CSS contract", () => {
  it("targets the visible card, not the .canvas-node anchor", () => {
    expect(declaration(`.canvas-node[data-bc-shape="pill"] .canvas-node-container`, "border-radius")).toBe("999px");
    expect(declaration(`.canvas-node[data-bc-shape="square"] .canvas-node-container`, "border-radius")).toBe("0");
    expect(declaration(`.canvas-node[data-bc-shape="database"] .canvas-node-container`, "border-radius")).toBe("50% / 12%");
    expect(declaration(`.canvas-node[data-bc-border="dashed"] .canvas-node-container`, "border-style")).toBe("dashed");
    expect(declaration(`.canvas-node[data-bc-border="invisible"] .canvas-node-container`, "border-color")).toBe("transparent");
  });

  it("keeps no shape or border rule on the anchor element", () => {
    const anchorRules = rules.filter(rule =>
      /\.canvas-node\[data-bc-(shape|border)="[a-z-]+"\]/.test(rule.selectors) &&
      !/::after/.test(rule.selectors) &&
      !/canvas-node-container/.test(rule.selectors) &&
      /(clip-path|border-radius|border-style|border-width|border-left|border-right)/.test(rule.body)
    );
    expect(anchorRules.map(rule => rule.selectors)).toEqual([]);
  });

  it("hides the rectangular container border for every polygon shape", () => {
    for (const shape of POLYGON_SHAPES) {
      expect(declaration(containerSelector(shape), "border-color"), shape).toBe("transparent");
      expect(declaration(containerSelector(shape), "border-radius"), shape).toBe("0");
      expect(declaration(containerSelector(shape), "clip-path"), shape).toBe("var(--bc-shape-outline)");
    }
  });

  it("strokes a ring for every polygon shape and border style", () => {
    for (const shape of POLYGON_SHAPES) {
      const ring = rulesFor(ringSelector(shape));
      expect(ring.length, shape).toBeGreaterThan(0);
      expect(ring.some(rule => /mask-image/.test(rule.body)), shape).toBe(true);
      expect(declaration(ringSelector(shape), "pointer-events"), shape).toBe("none");
    }
    expect(declaration(`.canvas-node[data-bc-border="dashed"]::after`, "mask-image")).toContain("--bc-ring-dashed");
    expect(declaration(`.canvas-node[data-bc-border="dotted"]::after`, "mask-image")).toContain("--bc-ring-dotted");
    expect(declaration(`.canvas-node[data-bc-border="double"]::after`, "mask-image")).toContain("--bc-ring-solid");
    expect(declaration(`.canvas-node[data-bc-border="invisible"]::after`, "display")).toBe("none");
    expect(declaration(`.canvas-node[data-bc-border="none"]::after`, "display")).toBe("none");
  });

  it("paints the ring with the node state colour", () => {
    expect(declaration(ringSelector("diamond"), "background-color")).toBe("var(--canvas-color)");
    expect(declaration(".canvas-node[data-bc-shape].is-themed::after", "background-color")).toContain("--canvas-color");
    expect(declaration(".canvas-node[data-bc-shape].is-selected::after", "background-color")).toBe("var(--color-accent)");
    expect(declaration(".canvas-node[data-bc-shape].is-focused::after", "background-color")).toBe("var(--color-accent)");
  });

  it("keeps the outline mask aligned with the outline clip", () => {
    for (const shape of POLYGON_SHAPES) {
      const outline = outlinePoints(shape);
      expect(outline, shape).not.toBeNull();
      for (const style of RING_STYLES) {
        expect(ringMaskPoints(shape, style), `${shape}/${style}`).toEqual(outline);
      }
    }
  });

  it("keeps every outline coordinate a percentage", () => {
    // Chromium drops the whole `clip-path` when a polygon mixes percentages
    // with unitless non-zero lengths, which silently turns the shape back into
    // a rectangle. Requiring `%` (or a zero length) keeps the clip valid.
    for (const shape of POLYGON_SHAPES) {
      const outline = declaration(anchorSelector(shape), "--bc-shape-outline");
      expect(outline, shape).not.toBeNull();
      const coordinates = outline!.match(/polygon\((.*)\)/)![1].split(",");
      for (const pair of coordinates) {
        for (const token of pair.trim().split(/\s+/)) {
          expect(token, `${shape}: ${outline}`).toMatch(/^(0%?|[\d.]+%)$/);
        }
      }
    }
  });

  it("shares the outline and ring constants with the panel previews", () => {
    for (const shape of ["diamond", "hexagon", "document"]) {
      const preview = `.bc-node-shape-preview.shape-${shape}`;
      expect(declaration(preview, "clip-path"), shape).toBe("var(--bc-shape-outline)");
      expect(declaration(preview, "border"), shape).toBe("0");
      expect(declaration(`${preview}::after`, "mask-image"), shape).toBe("var(--bc-ring-solid)");
      const ownRules = rulesFor(preview).filter(rule => rule.selectors === preview);
      expect(ownRules.every(rule => !rule.body.includes("polygon(")), `${shape} duplicates geometry`).toBe(true);
    }
    expect(declaration(".bc-node-style-preset-preview.shape-diamond", "clip-path")).toBe("var(--bc-shape-outline)");
    expect(declaration(".bc-node-style-preset-preview.shape-diamond::after", "mask-image")).toBe("var(--bc-ring-solid)");
  });
});
