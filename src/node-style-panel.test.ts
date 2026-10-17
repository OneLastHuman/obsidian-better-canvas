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
  readonly style: Record<string, string> = {};
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
  showStylePanel: (canvas: unknown, nodeId: string, source: "context", anchor: { x: number; y: number }) => void;
  dismissPanel: (restoreToolbar: boolean) => void;
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
  globals.window = { innerWidth: 1280, innerHeight: 800 };
  globals.HTMLElement = FakeElement;
  globals.getComputedStyle = () => ({
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px"
  });
}

function renderStylePanel(): FakeElement {
  const unifier = new NodeMenuUnifier({ app: {} } as never);
  const harness = unifier as unknown as PanelHarness;
  const canvas = {
    getData: () => ({
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 280, height: 140, text: "节点", color: "#3b82f6" }],
      edges: []
    })
  };
  harness.showStylePanel(canvas, "n1", "context", { x: 0, y: 0 });
  const surface = harness.activePanel?.surface;
  expect(surface).toBeDefined();
  harness.dismissPanel(false);
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

  it("keeps option names out of the visible panel text", () => {
    const surface = renderStylePanel();

    expect(descendants(surface).some(element => element.className.includes("bc-node-style-option-label"))).toBe(false);
    expect(descendants(surface).some(element => element.className.includes("bc-node-style-preset-label"))).toBe(false);

    // The only latin text left is the decorative "Aa" alignment sample inside
    // the preset previews.
    expect(surface.textContent.replace(/Aa/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("shows shapes and borders as previews only", () => {
    const surface = renderStylePanel();

    for (const shape of NODE_STYLE_SHAPES) {
      const button = optionButton(surface, "shape-" + shape.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].className).toBe("bc-node-shape-preview shape-" + shape.id);
    }

    for (const border of NODE_STYLE_BORDERS) {
      const button = optionButton(surface, "border-" + border.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].className).toBe("bc-node-border-preview border-" + border.id);
    }
  });

  it("uses icons for text alignment instead of text labels", () => {
    const surface = renderStylePanel();

    for (const align of NODE_STYLE_ALIGNMENTS) {
      const button = optionButton(surface, "align-" + align.id);
      expect(button.textContent).toBe("");
      expect(button.children).toHaveLength(1);
      expect(button.children[0].tagName).toBe("svg");
    }
  });

  it("drops the preset name from the preset button", () => {
    const surface = renderStylePanel();

    for (const id of Object.keys(NODE_STYLE_PRESETS)) {
      const button = optionButton(surface, "preset-" + id);
      expect(button.children).toHaveLength(1);
      expect(button.children[0].className).toContain("bc-node-style-preset-preview");
      expect(button.textContent).toBe("Aa");
    }
  });
});
