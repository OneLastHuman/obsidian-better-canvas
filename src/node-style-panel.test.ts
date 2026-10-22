import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Notice: class { constructor(public message: string) {} },
  // The host injects the icon SVG. This stub deliberately draws nothing so the
  // panel's own icon fallback is the branch under test.
  setIcon: vi.fn()
}));

vi.mock("./enhancements", () => ({ decorateCanvas: vi.fn() }));

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
  disabled = false;
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

  private readonly listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(handler => handler !== listener));
  }

  click(): void {
    if (this.disabled) return;
    const event = {
      preventDefault: () => undefined,
      stopPropagation: () => undefined
    } as unknown as MouseEvent;
    for (const listener of this.listeners.get("click") ?? []) listener.call(this, event);
  }

  remove(): void {}
  focus(): void {}

  private classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }
}

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

type PanelHarness = {
  showStylePanel: (canvas: unknown, nodeIds: string | string[]) => void;
  dismissPanel: () => void;
  activePanel: { surface: FakeElement } | null;
};

type TestCanvasData = {
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
};

function createStylePanel(
  nodePatches: Array<Record<string, unknown>> = [{}],
  selectedCount = nodePatches.length,
  theme?: string
): {
  surface: FakeElement;
  canvas: {
    readonly: boolean;
    importData: ReturnType<typeof vi.fn>;
    requestSave: ReturnType<typeof vi.fn>;
    requestFrame: ReturnType<typeof vi.fn>;
  };
  getData: () => TestCanvasData;
  close: () => void;
} {
  const unifier = new NodeMenuUnifier({ app: {} } as never);
  const harness = unifier as unknown as PanelHarness;
  let data: TestCanvasData = {
    ...(theme ? { bcTheme: theme } : {}),
    nodes: nodePatches.map((patch, index) => ({
      id: "n" + (index + 1),
      type: "text",
      x: index * 400,
      y: 0,
      width: 280,
      height: 140,
      text: "节点 " + (index + 1),
      color: "#3b82f6",
      ...patch
    })),
    edges: []
  };
  const canvas = {
    readonly: false,
    getData: () => data,
    importData: vi.fn((next: TestCanvasData) => {
      data = next;
    }),
    requestSave: vi.fn(),
    requestFrame: vi.fn(),
    nodes: new Map(data.nodes.map(node => [node.id, node]))
  };
  const nodeIds = data.nodes.slice(0, selectedCount).map(node => String(node.id));
  harness.showStylePanel(canvas, nodeIds);
  const surface = harness.activePanel?.surface;
  expect(surface).toBeDefined();
  return {
    surface: surface as FakeElement,
    canvas,
    getData: () => data,
    close: () => harness.dismissPanel()
  };
}

function renderStylePanel(nodePatch: Record<string, unknown> = {}, additionalNodePatches: Array<Record<string, unknown>> = []): FakeElement {
  const panel = createStylePanel([nodePatch, ...additionalNodePatches]);
  const surface = panel.surface;
  panel.close();
  return surface;
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
  it("opens without a selection", () => {
    const panel = createStylePanel([{}], 0);

    expect(panel.surface.textContent).toContain("未选择节点");
    expect(descendants(panel.surface).some(element => element.className === "bc-node-style-empty")).toBe(false);
    panel.close();
  });

  it("disables style options until a node is selected", () => {
    const panel = createStylePanel([{}], 0);
    const options = buttons(panel.surface).filter(button => button.dataset.styleOption);

    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option.disabled).toBe(true);
    expect(optionButton(panel.surface, "preset-flow").getAttribute("aria-pressed")).toBe("false");

    optionButton(panel.surface, "preset-flow").click();
    expect(panel.canvas.importData).not.toHaveBeenCalled();
    panel.close();
  });

  it("shows scrapbook treatments and applies them to the full selection preserving explicit styles", () => {
    const panel = createStylePanel([{ bcShape: "diamond" }, {}], 2, "scrapbook");
    const tape = optionButton(panel.surface, "paper-tape");
    expect(tape.getAttribute("aria-label")).toContain("胶带便签");
    optionButton(panel.surface, "paper-lined").click();
    expect(panel.getData().nodes.map(node => node.bcScrapbookPreset)).toEqual(["lined", "lined"]);
    expect(panel.getData().nodes[0].bcShape).toBe("diamond");
    expect(panel.getData().nodes[0].color).toBe("#3b82f6");
    panel.close();
  });

  it("rejects paper changes on a read-only canvas", () => {
    const panel = createStylePanel([{}], 1, "scrapbook");
    (panel.canvas as any).readonly = true;
    optionButton(panel.surface, "paper-photo").click();
    expect(panel.getData().nodes[0].bcScrapbookPreset).toBeUndefined();
    panel.close();
  });
  it("shows six sketch presets, applies them in batch and keeps explicit styles editable", () => {
    const panel = createStylePanel([{ bcShape: "diamond" }, {}], 2, "sketch");
    for (const id of ["heading", "concept", "action", "decision", "annotation", "risk"]) {
      expect(optionButton(panel.surface, "sketch-" + id)).toBeDefined();
    }
    optionButton(panel.surface, "sketch-concept").click();
    expect(panel.getData().nodes.map(node => node.bcSketchPreset)).toEqual(["concept", "concept"]);
    expect(panel.getData().nodes[0]).toMatchObject({
      bcShape: "ellipse", bcSketchFill: "hachure", bcBorderStyle: "solid",
      bcTextAlign: "center", color: "#719cf4"
    });
    expect(panel.getData().nodes[0].text).toBe("节点 1");

    optionButton(panel.surface, "sketch-fill-cross-hatch").click();
    expect(panel.getData().nodes.map(node => node.bcSketchFill)).toEqual(["cross-hatch", "cross-hatch"]);
    optionButton(panel.surface, "shape-square").click();
    expect(panel.getData().nodes.map(node => node.bcShape)).toEqual(["square", "square"]);
    panel.close();
  });

  it("applies six research presets and intensity to cards, with mixed state and readonly guards", () => {
    const panel = createStylePanel([{ bcResearchPreset: "quote" }, { bcResearchPreset: "source" }, { type: "group" }], 3, "research");
    expect(buttons(panel.surface).filter(button => button.className.includes("bc-research-preset"))).toHaveLength(6);
    expect(optionButton(panel.surface, "research-quote").getAttribute("aria-pressed")).toBe("mixed");
    optionButton(panel.surface, "research-argument").click();
    expect(panel.getData().nodes.map(node => node.bcResearchPreset)).toEqual(["argument", "argument", undefined]);
    expect(panel.getData().nodes[0].text).toBe("节点 1");
    expect(panel.canvas.requestSave).toHaveBeenCalledWith(false);
    optionButton(panel.surface, "research-40").click();
    expect(panel.getData().nodes.map(node => node.bcResearchIntensity)).toEqual([40, 40, undefined]);
    optionButton(panel.surface, "color-blue").click();
    expect(panel.getData().nodes[0].color).toBe("#416879");
    panel.canvas.readonly = true;
    optionButton(panel.surface, "research-section").click();
    expect(panel.getData().nodes[0].bcResearchPreset).toBe("argument");
    panel.close();
  });

  it("disables research presets for empty or group-only selection", () => {
    for (const selectedCount of [0, 1]) {
      const panel = createStylePanel([{ type: "group" }], selectedCount, "research");
      expect(optionButton(panel.surface, "research-source").disabled).toBe(true);
      expect(optionButton(panel.surface, "research-26").disabled).toBe(true);
      panel.close();
    }
  });

  it("shows mixed sketch fill state and rejects changes on a read-only canvas", () => {
    const panel = createStylePanel([
      { bcSketchFill: "hachure" },
      { bcSketchFill: "solid" }
    ], 2, "sketch");
    expect(optionButton(panel.surface, "sketch-fill-hachure").getAttribute("aria-pressed")).toBe("mixed");
    panel.canvas.readonly = true;
    optionButton(panel.surface, "sketch-fill-none").click();
    expect(panel.getData().nodes.map(node => node.bcSketchFill)).toEqual(["hachure", "solid"]);
    panel.close();
  });

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

  it("shows mixed values for properties that differ across selected nodes", () => {
    const surface = renderStylePanel(
      {
        color: "#e8798f",
        bcShape: "default",
        bcBorderStyle: "solid",
        bcTextAlign: "left"
      },
      [{
        color: "#719cf4",
        bcShape: "diamond",
        bcBorderStyle: "dashed",
        bcTextAlign: "right"
      }]
    );

    expect(surface.textContent).toContain("2 个节点 · 部分样式不同");
    expect(optionButton(surface, "color-red").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "color-blue").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "color-green").getAttribute("aria-pressed")).toBe("false");
    expect(optionButton(surface, "shape-default").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "shape-diamond").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "border-solid").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "align-left").getAttribute("aria-pressed")).toBe("mixed");
    expect(optionButton(surface, "preset-flow").getAttribute("aria-pressed")).toBe("false");
  });

  it("applies a selected preset to every targeted node and leaves unselected nodes unchanged", () => {
    const panel = createStylePanel(
      [
        { color: "#e8798f", text: "First node" },
        { color: "#719cf4", text: "Second node" },
        { color: "#d4c75b", text: "Unselected node" }
      ],
      2
    );

    optionButton(panel.surface, "preset-flow").click();

    const nodes = panel.getData().nodes;
    expect(panel.canvas.importData).toHaveBeenCalledTimes(1);
    expect(panel.canvas.requestSave).toHaveBeenCalledTimes(1);
    expect(nodes[0]).toMatchObject({
      id: "n1", text: "First node", color: "#65b9a7",
      bcShape: "pill", bcBorderStyle: "solid", bcTextAlign: "center"
    });
    expect(nodes[1]).toMatchObject({
      id: "n2", text: "Second node", color: "#65b9a7",
      bcShape: "pill", bcBorderStyle: "solid", bcTextAlign: "center"
    });
    expect(nodes[2]).toMatchObject({ id: "n3", text: "Unselected node", color: "#d4c75b" });
    expect(nodes[2].bcShape).toBeUndefined();
    panel.close();
  });

  it("does not expose an auto-resize switch", () => {
    const surface = renderStylePanel();
    expect(surface.textContent).not.toContain("自适应");
    expect(surface.textContent).not.toContain("自动调整");
  });
});
