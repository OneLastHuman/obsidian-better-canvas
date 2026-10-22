import { beforeEach, describe, expect, it, vi } from "vitest";

const { prompts } = vi.hoisted(() => ({
  prompts: [] as Array<{ sourceLabel: string; modelLabel: string; onSubmit: (value: string) => Promise<void> }>
}));

vi.mock("obsidian", () => ({
  App: class {},
  Plugin: class {},
  Component: class {},
  ItemView: class {},
  Modal: class {},
  SuggestModal: class {},
  PluginSettingTab: class {},
  TFile: class {},
  TFolder: class {},
  Notice: class { hide() {} },
  Platform: { isDesktopApp: true },
  MarkdownRenderer: {},
  requestUrl: vi.fn()
}));
vi.mock("./ai-prompt-modal", () => ({
  AIPromptModal: class {
    constructor(_app: unknown, options: typeof prompts[number]) { prompts.push(options); }
    open() {}
  }
}));
vi.mock("./ai", () => ({
  chatCompletion: vi.fn(),
  chatCompletionStream: vi.fn(),
  generateImage: vi.fn()
}));

import { TFile } from "obsidian";
import { chatCompletion, chatCompletionStream, generateImage } from "./ai";
import { insertCanvasNode, type CanvasData, type CanvasNodeData } from "./canvas";
import BetterCanvasFeatures from "./feature-integrator";
import BetterCanvasPlugin from "./main";

function node(id: string, x = 0, y = 0): CanvasNodeData {
  return { id, type: "text", text: `Notes ${id}`, x, y, width: 200, height: 100 };
}

function makeCanvas() {
  const canvas = {
    data: {
      nodes: [node("a"), node("b", 500, 200), node("shared"), node("unrelated")],
      edges: [
        { id: "as", fromNode: "a", toNode: "shared", fromSide: "right", toSide: "left" },
        { id: "bs", fromNode: "b", toNode: "shared", fromSide: "right", toSide: "left" }
      ],
      metadata: { custom: "preserved" }
    } as CanvasData,
    selection: new Set<any>([{ id: "a" }, { id: "b" }, { id: "as" }]),
    nodes: new Map<string, any>(),
    readonly: false,
    wrapperEl: { classList: { contains: (_name: string) => false } },
    getData() { return this.data; },
    importData(data: CanvasData) {
      this.data = data;
      this.nodes = new Map(data.nodes.map(item => [item.id, { id: item.id }]));
    },
    requestSave: vi.fn(),
    requestFrame: vi.fn()
  };
  canvas.wrapperEl.classList.contains = name => name === "bc-readonly" && canvas.readonly;
  canvas.importData(canvas.data);
  return canvas;
}

function setup() {
  const canvas = makeCanvas();
  const workspace = {
    getActiveViewOfType: vi.fn(() => ({ getViewType: () => "canvas", canvas })),
    on: vi.fn()
  };
  const vault = {
    getAbstractFileByPath: vi.fn((_path: string) => null as TFile | null),
    cachedRead: vi.fn(async (_file: TFile) => "File text"),
    readBinary: vi.fn(async (_file: TFile) => new Uint8Array([1, 2]).buffer),
    createFolder: vi.fn(async () => {}),
    createBinary: vi.fn(async () => {}),
    create: vi.fn(async () => {}),
    getFiles: vi.fn(() => [])
  };
  const plugin = {
    app: { workspace, vault },
    register: vi.fn(),
    settings: {
      backend: "api",
      activeProviderId: "default",
      providerProfiles: [{ id: "default", protocol: "openai", model: "test-model" }]
    } as Record<string, any>
  };
  const features = new BetterCanvasFeatures(plugin);
  return { canvas, plugin, features, workspace, vault };
}

beforeEach(() => {
  vi.clearAllMocks();
  prompts.length = 0;
  vi.mocked(chatCompletionStream).mockResolvedValue("Combined answer");
  vi.mocked(chatCompletion).mockResolvedValue('{"cards":[{"question":"Q","answer":"A"}]}');
  vi.mocked(generateImage).mockResolvedValue({ bytes: new Uint8Array([1, 2]), extension: "png" });
});

describe("AI selection menu", () => {
  function menuHarness(canvas = makeCanvas()) {
    const handlers = new Map<string, (...args: any[]) => void>();
    const features = {
      askSelectedNode: vi.fn(),
      generateImageFromSelection: vi.fn(),
      generateFlashcardsFromSelection: vi.fn(),
      regenerateNode: vi.fn()
    };
    const plugin = Object.assign(Object.create(BetterCanvasPlugin.prototype), {
      app: { workspace: { on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler) } },
      registerEvent: vi.fn(),
      features,
      getCanvas: () => canvas
    });
    plugin.registerCanvasContextMenu();
    const items = new Map<string, () => void>();
    const menu = {
      addItem(callback: (item: any) => void) {
        let title = "";
        const item = {
          setTitle(value: string) { title = value; return item; },
          setIcon() { return item; },
          onClick(handler: () => void) { items.set(title, handler); return item; }
        };
        callback(item);
      },
      addSeparator: vi.fn()
    };
    return { handlers, features, items, menu, canvas };
  }

  it("captures all selected nodes and the originating canvas, ignoring selected edges", () => {
    const { handlers, features, items, menu, canvas } = menuHarness();
    handlers.get("canvas:selection-menu")!(menu, canvas);
    expect([...items.keys()]).toEqual(["问 AI", "生成图片", "生成闪卡"]);
    canvas.selection = new Set([{ id: "unrelated" }]);
    items.forEach(handler => handler());
    const target = { canvas, nodeIds: ["a", "b"] };
    expect(features.askSelectedNode).toHaveBeenCalledExactlyOnceWith(target);
    expect(features.generateImageFromSelection).toHaveBeenCalledExactlyOnceWith(target);
    expect(features.generateFlashcardsFromSelection).toHaveBeenCalledExactlyOnceWith(target);
    expect(features.regenerateNode).not.toHaveBeenCalled();
  });

  it.each([{ selection: [] }, { selection: [{ id: "as" }] }])("does not offer AI for empty or edge-only selections: $selection", ({ selection }) => {
    const { handlers, items, menu, canvas } = menuHarness();
    canvas.selection = new Set(selection);
    handlers.get("canvas:selection-menu")!(menu, canvas);
    expect(items.size).toBe(0);
  });

  it("retains regeneration in the single generated node menu", () => {
    const { handlers, features, items, menu, canvas } = menuHarness();
    canvas.data.nodes[0].bcGenerated = true;
    handlers.get("canvas:node-menu")!(menu, { id: "a" });
    items.get("重生成")!();
    expect(features.regenerateNode).toHaveBeenCalledWith("a");
  });
});

describe("AI generation from multiple nodes", () => {
  it("combines selected nodes and deduplicates direct neighbors in one request", async () => {
    const { canvas, features } = setup();
    const original = structuredClone(canvas.data);
    features.askSelectedNode();
    expect(prompts[0]).toMatchObject({ sourceLabel: "已选 2 个节点", modelLabel: "test-model" });
    await prompts[0].onSubmit("Compare these notes");

    expect(chatCompletionStream).toHaveBeenCalledOnce();
    const prompt = String(vi.mocked(chatCompletionStream).mock.calls[0][1][1].content);
    expect(prompt).toContain("[Node a — selected]");
    expect(prompt).toContain("[Node b — selected]");
    expect(prompt.match(/\[Node shared\]/g)).toHaveLength(1);
    expect(prompt).not.toContain("Notes unrelated");
    const result = canvas.data.nodes.find(item => item.bcGenerated)!;
    expect(result).toMatchObject({
      text: "Combined answer", x: 800, y: 0, bcSourceNode: "a", bcSourceNodes: ["a", "b"]
    });
    expect(canvas.data.edges.filter(edge => edge.toNode === result.id).map(edge => edge.fromNode)).toEqual(["a", "b"]);
    expect(canvas.data.nodes.slice(0, 4)).toEqual(original.nodes);
    expect(canvas.data.metadata).toEqual(original.metadata);
    expect([...canvas.selection].map(item => item.id)).toEqual(["a", "b", "as"]);
    expect(canvas.requestSave).toHaveBeenCalled();
  });

  it("pins the canvas and source nodes while the prompt is open", async () => {
    const { canvas, features, workspace } = setup();
    features.askSelectedNode();
    const other = makeCanvas();
    workspace.getActiveViewOfType.mockReturnValue({ getViewType: () => "canvas", canvas: other });
    canvas.selection.clear();
    await prompts[0].onSubmit("Summarize");
    expect(canvas.data.nodes).toHaveLength(5);
    expect(other.data.nodes).toHaveLength(4);
  });

  it("keeps single-node targeting and per-node model overrides", async () => {
    const { canvas, features } = setup();
    canvas.data.nodes[1].bcAIModel = "node-model";
    features.askSelectedNode("b");
    expect(prompts[0].modelLabel).toBe("node-model");
    await prompts[0].onSubmit("Explain");
    expect(vi.mocked(chatCompletionStream).mock.calls[0][0].model).toBe("node-model");
    const result = canvas.data.nodes.find(item => item.bcGenerated)!;
    expect(result.bcSourceNodes).toBeUndefined();
    expect(canvas.data.edges.filter(edge => edge.toNode === result.id).map(edge => edge.fromNode)).toEqual(["b"]);
  });

  it.each(["readonly", "deleted"] as const)("rejects a %s source before submission sends data", async state => {
    const { canvas, features } = setup();
    features.askSelectedNode();
    if (state === "readonly") canvas.readonly = true;
    else canvas.data.nodes = canvas.data.nodes.filter(item => item.id !== "b");
    await prompts[0].onSubmit("Summarize");
    expect(chatCompletionStream).not.toHaveBeenCalled();
    expect(canvas.requestSave).not.toHaveBeenCalled();
  });

  it("does not open a prompt or send requests for readonly or edge-only selections", () => {
    const { canvas, features } = setup();
    canvas.readonly = true;
    features.askSelectedNode();
    features.generateFlashcardsFromSelection();
    features.generateImageFromSelection();
    canvas.readonly = false;
    canvas.selection = new Set([{ id: "as" }]);
    features.askSelectedNode();
    expect(prompts).toHaveLength(0);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("regenerates with every original source after selection changes", async () => {
    const { canvas, features } = setup();
    features.askSelectedNode();
    await prompts[0].onSubmit("Compare");
    const original = canvas.data.nodes.find(item => item.bcGenerated)!;
    canvas.selection = new Set([{ id: original.id }]);
    await (features as any).regenerate();
    expect(chatCompletionStream).toHaveBeenCalledTimes(2);
    const prompt = String(vi.mocked(chatCompletionStream).mock.calls[1][1][1].content);
    expect(prompt).toContain("[Node a — selected]");
    expect(prompt).toContain("[Node b — selected]");
    expect(canvas.data.nodes.some(item => item.id === original.id)).toBe(false);
    expect(canvas.data.nodes.find(item => item.bcGenerated)?.bcSourceNodes).toEqual(["a", "b"]);
  });

  it("removes the old response even when the host importData only adds or updates nodes", async () => {
    const { canvas, features } = setup();
    features.askSelectedNode();
    await prompts[0].onSubmit("Compare");
    const original = canvas.data.nodes.find(item => item.bcGenerated)!;
    const replaceData = canvas.importData.bind(canvas);
    Object.assign(canvas, { setData: vi.fn(replaceData) });
    canvas.importData = next => replaceData({
      ...next,
      nodes: [...new Map([...canvas.data.nodes, ...next.nodes].map(item => [item.id, item])).values()],
      edges: [...new Map([...canvas.data.edges, ...next.edges].map(item => [item.id, item])).values()]
    });
    canvas.selection = new Set([{ id: original.id }]);
    await (features as any).regenerate();
    expect(canvas.data.nodes.filter(item => item.bcGenerated)).toHaveLength(1);
    expect(canvas.data.nodes.some(item => item.id === original.id)).toBe(false);
    expect(canvas.data.edges.some(edge => edge.toNode === original.id)).toBe(false);
  });

  it("removes the placeholder and all its source edges when a request fails", async () => {
    const { canvas, features } = setup();
    const original = structuredClone(canvas.data);
    vi.mocked(chatCompletionStream).mockRejectedValueOnce(new Error("offline"));
    features.askSelectedNode();
    await prompts[0].onSubmit("Compare");
    expect(canvas.data).toEqual(original);
  });

  it("retains partial output and all source links when cancelled", async () => {
    const { canvas, features } = setup();
    vi.mocked(chatCompletionStream).mockImplementationOnce(async (_settings, _messages, signal, onDelta) => {
      onDelta("Partial");
      (features as any).stopAI();
      expect(signal.aborted).toBe(true);
      throw new DOMException("Stopped", "AbortError");
    });
    features.askSelectedNode();
    await prompts[0].onSubmit("Compare");
    const result = canvas.data.nodes.find(item => item.bcStopped)!;
    expect(result).toMatchObject({ text: "Partial", bcGenerating: false, bcSourceNodes: ["a", "b"] });
    expect(canvas.data.edges.filter(edge => edge.toNode === result.id)).toHaveLength(2);
  });

  it("includes files and images from all selected roots, with a global four-image cap", async () => {
    const { canvas, features, vault } = setup();
    canvas.data.nodes = [
      node("md"), ...Array.from({ length: 5 }, (_, i) => ({ ...node(`image${i}`), type: "file", file: `${i}.png` }))
    ];
    Object.assign(canvas.data.nodes[0], { type: "file", file: "source.md" });
    canvas.data.edges = [];
    canvas.selection = new Set(canvas.data.nodes.map(item => ({ id: item.id })));
    vault.getAbstractFileByPath.mockImplementation(path =>
      Object.assign(new TFile(), { path, extension: path.split(".").pop(), stat: { size: 2 } }));
    features.askSelectedNode();
    await prompts[0].onSubmit("Explain");
    const content = vi.mocked(chatCompletionStream).mock.calls[0][1][1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: "text", text: expect.stringContaining("File text") });
    expect((content as any[]).filter(item => item.type === "image_url")).toHaveLength(4);
    expect(vault.readBinary).toHaveBeenCalledTimes(4);
  });

  it("creates one set of flashcards using all selected notes", async () => {
    const { canvas, features } = setup();
    features.generateFlashcardsFromSelection();
    await vi.waitFor(() => expect(canvas.data.nodes).toHaveLength(5));
    expect(chatCompletion).toHaveBeenCalledOnce();
    const prompt = String(vi.mocked(chatCompletion).mock.calls[0][1][1].content);
    expect(prompt).toContain("[Node a — selected]");
    expect(prompt).toContain("[Node b — selected]");
    const card = canvas.data.nodes[4];
    expect(card).toMatchObject({ text: "问题：Q\n\n答案：A", x: 800, y: 0 });
    expect(canvas.data.edges.filter(edge => edge.toNode === card.id).map(edge => edge.fromNode)).toEqual(["a", "b"]);
  });

  it("keeps the Spaced Repetition output mode for combined notes", async () => {
    const { canvas, features, plugin, vault } = setup();
    plugin.settings.flashcardOutputMode = "spaced-repetition";
    features.generateFlashcardsFromSelection();
    await vi.waitFor(() => expect(vault.create).toHaveBeenCalledOnce());
    expect(canvas.data.nodes).toHaveLength(4);
    expect(vault.create.mock.calls[0]).toEqual([
      expect.stringMatching(/\.md$/), expect.stringContaining("Q\n?\nA")
    ]);
  });

  it("generates one image and links it to every source", async () => {
    const { canvas, features, vault } = setup();
    features.generateImageFromSelection();
    await vi.waitFor(() => expect(canvas.data.nodes).toHaveLength(5));
    expect(generateImage).toHaveBeenCalledOnce();
    const prompt = vi.mocked(generateImage).mock.calls[0][1];
    expect(prompt).toContain("[Node a — selected]");
    expect(prompt).toContain("[Node b — selected]");
    expect(vault.createBinary).toHaveBeenCalledOnce();
    const image = canvas.data.nodes[4];
    expect(image).toMatchObject({ type: "file", x: 800, y: 0 });
    expect(canvas.data.edges.filter(edge => edge.toNode === image.id).map(edge => edge.fromNode)).toEqual(["a", "b"]);
  });
});

describe("multi-source insertion", () => {
  it("creates one edge per existing source and saves the insertion once", () => {
    const canvas = makeCanvas();
    insertCanvasNode(canvas, node("result"), ["a", "b", "a", "missing", "result"]);
    expect(canvas.data.edges.filter(edge => edge.toNode === "result").map(edge => edge.fromNode)).toEqual(["a", "b"]);
    expect(canvas.requestSave).toHaveBeenCalledOnce();
    expect(canvas.requestFrame).toHaveBeenCalledOnce();
  });
});
