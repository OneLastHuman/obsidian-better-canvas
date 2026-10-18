import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Notice: class { constructor(public message: string) {} },
  // The host injects the icon SVG. This stub deliberately draws nothing so the
  // panel's own icon fallback is the branch under test.
  setIcon: vi.fn()
}));

import NodeMenuUnifier from "./node-menu-unifier";
import {
  NODE_STYLE_ALIGNMENTS,
  NODE_STYLE_BORDERS,
  NODE_STYLE_COLORS,
  NODE_STYLE_PRESET_LIST,
  NODE_STYLE_PRESETS,
  NODE_STYLE_SHAPES
} from "./node-visual-style";

/**
 * Minimal DOM stub. It is not a browser or jsdom: it only implements the node
 * surface the style panel touches, so it can assert what the panel prints and
 * which elements it creates. Real rendering still needs Obsidian Desktop.
 */
class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {
    setProperty: (name: string, value: string): void => {
      this.style[name] = value;
    }
  };
  private readonly attributes = new Map<string, string>();
  private ownText = "";
  className = "";
  type = "";
  offsetParent: FakeElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  readonly classList = {
    add: (...names: string[]): void => {
      for (const name of names) {
        if (!this.classes().includes(name)) this.className = [...this.classes(), name].join(" ");
      }
    },
    remove: (...names: string[]): void => {
      const removed = new Set(names);
      this.className = this.classes().filter(name => !removed.has(name)).join(" ");
    },
    contains: (name: string): boolean => this.classes().includes(name)
  };

  /** Mirrors the real DOM, where the `title` property reflects to the attribute. */
  get title(): string {
    return this.attributes.get("title") ?? "";
  }

  set title(value: string) {
    this.attributes.set("title", String(value ?? ""));
  }

  /** Aggregates descendant text like the real DOM does. */
  get textContent(): string {
    return this.ownText + this.children.map(child => child.textContent).join("");
  }

  set textContent(value: string) {
    this.ownText = value ?? "";
  }

  appendChild<T extends FakeElement>(child: T): T {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.children.push(...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector(): null {
    return null;
  }

  getBoundingClientRect(): { width: number; height: number; left: number; top: number; right: number; bottom: number } {
    return { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  }

  addEventListener(): void {}
  remove(): void {}
  focus(): void {}

  private classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }
}

type PanelHarness = {
  showStylePanel: (canvas: unknown, nodeId: string) => void;
  dismissPanel: () => void;
  activePanel: { surface: FakeElement } | null;
};

const originalGlobals = {
  document: (globalThis as Record<string, unknown>).document,
  window: (globalThis as Record<string, unknown>).window,
  HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
  getComputedStyle: (globalThis as Record<string, unknown>).getComputedStyle
};

let body: FakeElement;

function installFakeDom(): void {
  body = new FakeElement("body");
  const documentStub = {
    body,
    documentElement: new FakeElement("html"),
    createElement: (tagName: string) => new FakeElement(tagName),
    createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
  const globals = globalThis as Record<string, unknown>;
  globals.document = documentStub;
  globals.window = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
  globals.HTMLElement = FakeElement;
  globals.getComputedStyle = () => ({
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px"
  });
}

function renderStylePanel(nodePatch: Record<string, unknown> = {}): FakeElement {
  const unifier = new NodeMenuUnifier({ app: {} } as never);
  const harness = unifier as unknown as PanelHarness;
  const canvas = {
    getData: () => ({
      nodes: [{
        id: "n1", type: "text", x: 0, y: 0, width: 280, height: 140, text: "节点", color: "#3b82f6",
        ...nodePatch
      }],
      edges: []
    })
  };
  harness.showStylePanel(canvas, "n1");
  const surface = harness.activePanel?.surface;
  expect(surface).toBeDefined();
  harness.dismissPanel();
  return surface as FakeElement;
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

function buttons(root: FakeElement): FakeElement[] {
  return descendants(root).filter(element => element.tagName === "button");
}

function optionButton(root: FakeElement, styleOption: string): FakeElement {
  const button = buttons(root).find(candidate => candidate.dataset.styleOption === styleOption);
  expect(button, "missing option button " + styleOption).toBeDefined();
  return button as FakeElement;
}

beforeEach(() => {
  installFakeDom();
});

afterEach(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.document = originalGlobals.document;
  globals.window = originalGlobals.window;
  globals.HTMLElement = originalGlobals.HTMLElement;
  globals.getComputedStyle = originalGlobals.getComputedStyle;
});

describe("node style panel rendering", () => {
  it("renders every option instead of printing its name", () => {
    const surface = renderStylePanel();

    const expectedOptions = NODE_STYLE_COLORS.length + NODE_STYLE_SHAPES.length +
      NODE_STYLE_BORDERS.length + NODE_STYLE_ALIGNMENTS.length + Object.keys(NODE_STYLE_PRESETS).length;
    const options = buttons(surface).filter(button => button.dataset.styleOption);
    expect(options).toHaveLength(expectedOptions);

    for (const button of options) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.getAttribute("title")).toBeTruthy();
    }
  });

  it("keeps individual option names out of the visible panel text", () => {
    const surface = renderStylePanel();

    expect(descendants(surface).some(element => element.className.includes("bc-node-style-option-label"))).toBe(false);

    // Presets are the deliberate exception: their names are the only text
    // besides the section titles and the "Aa" sample inside each preview.
    const text = surface.textContent;
    expect(text).toContain("预设");
    expect(text).not.toContain("菱形");
    expect(text).not.toContain("实线");
    expect(text).not.toContain("左对齐");
    expect(text.replace(/Aa/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("shows shapes as previews only", () => {
    const surface = renderStylePanel();

    for (const shape of NODE_STYLE_SHAPES) {
      const button = optionButton(surface, "shape-" + shape.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].className).toBe("bc-node-shape-preview shape-" + shape.id);
    }
  });

  it("uses icons for borders and text alignment instead of text labels", () => {
    const surface = renderStylePanel();

    for (const border of NODE_STYLE_BORDERS) {
      const button = optionButton(surface, "border-" + border.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].tagName).toBe("svg");
    }

    for (const align of NODE_STYLE_ALIGNMENTS) {
      const button = optionButton(surface, "align-" + align.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].tagName).toBe("svg");
    }
  });

  it("omits the reset footer", () => {
    const surface = renderStylePanel();
    expect(descendants(surface).some(element => element.className === "bc-node-style-footer")).toBe(false);
    expect(surface.textContent).not.toContain("恢复默认");
  });

  it("previews each preset with its own colour, shape, border and alignment", () => {
    const surface = renderStylePanel();

    for (const preset of NODE_STYLE_PRESET_LIST) {
      const button = optionButton(surface, "preset-" + preset.id);
      expect(button.getAttribute("aria-label")).toBe(preset.label + "预设");
      // The tile is the whole preview: no printed name competes with it.
      expect(button.children).toHaveLength(1);

      const preview = button.children[0];
      expect(preview.className).toBe(
        "bc-node-style-preset-preview shape-" + preset.style.shape +
        " border-" + preset.style.border + " align-" + preset.style.align
      );
      expect(preview.style["--bc-preset-color"]).toBe(preset.style.color);
      expect(preview.children[0].className).toBe("bc-node-style-preset-sample");
      expect(button.textContent).toBe("Aa");
    }
  });

  it("marks the preset that matches the current node style", () => {
    const flowPreset = NODE_STYLE_PRESETS.flow;
    const surface = renderStylePanel({
      color: flowPreset.color,
      bcShape: flowPreset.shape,
      bcBorderStyle: flowPreset.border,
      bcTextAlign: flowPreset.align
    });

    const flow = optionButton(surface, "preset-flow");
    expect(flow.getAttribute("aria-pressed")).toBe("true");
    expect(flow.className).toContain("is-selected");
    expect(optionButton(surface, "preset-warning").getAttribute("aria-pressed")).toBe("false");
  });

  it("offers the expanded preset set before the manual controls", () => {
    const surface = renderStylePanel();

    expect(NODE_STYLE_PRESET_LIST.length).toBeGreaterThanOrEqual(6);
    const sections = descendants(surface)
      .filter(element => element.className === "bc-node-style-section");
    expect(sections[0].textContent).toContain("预设");
  });

  it("does not expose an auto-resize switch", () => {
    const surface = renderStylePanel();
    expect(surface.textContent).not.toContain("自适应");
    expect(surface.textContent).not.toContain("自动调整");
  });
});
