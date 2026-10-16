import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, Notice, TFile } from "obsidian";
import { CanvasPortalManager, hasMovedOpenPortal } from "./canvas-portals";

vi.mock("obsidian", () => ({
  ItemView: class ItemView {},
  Modal: class Modal {
    app: unknown;
    constructor(app: unknown) { this.app = app; }
    open() { return this; }
    close() {}
  },
  Notice: vi.fn(),
  TFile: class TFile {
    extension: string;
    constructor(path: string) {
      this.extension = path.split(".").pop() ?? "";
    }
  }
}));

function makeTFile(extension: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  Object.defineProperty(file, "extension", { value: extension, configurable: true });
  return file;
}

function makeHarness(portalOpen = false) {
  const canvas: any = {
    data: {
      nodes: [{
        id: "portal",
        type: "file",
        file: "target.canvas",
        x: 0,
        y: 0,
        width: 200,
        height: 160,
        ...(portalOpen ? { portal: true } : {})
      }],
      edges: []
    },
    wrapperEl: { classList: { contains: () => false } },
    nodes: new Map<string, any>(),
    getData() { return this.data; },
    importData(next: any) { this.data = next; },
    removeNode(liveNode: any) {
      this.data.nodes = this.data.nodes.filter((node: any) => node.id !== liveNode.id);
      this.data.edges = this.data.edges.filter((edge: any) => edge.fromNode !== liveNode.id && edge.toNode !== liveNode.id);
      this.nodes.delete(liveNode.id);
    },
    requestSave: vi.fn(),
    requestFrame: vi.fn(),
    selection: { size: 1, values: () => new Set([{ id: "portal" }]).values() }
  };
  for (const node of canvas.data.nodes) canvas.nodes.set(node.id, { id: node.id });
  const view = { getViewType: () => "canvas", canvas, file: { path: "host.canvas" } };
  const plugin: any = {
    app: {
      workspace: { getActiveViewOfType: vi.fn(() => view) },
      vault: { getAbstractFileByPath: vi.fn(), cachedRead: vi.fn(), modify: vi.fn() }
    }
  };
  const manager = new CanvasPortalManager(plugin);
  vi.spyOn(manager, "refreshView").mockResolvedValue();
  return { canvas, view, plugin, manager };
}

describe("Canvas Portal target validation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("does not mark or save a Portal when its target file is missing", () => {
    const { canvas, plugin, manager } = makeHarness();
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

    manager.togglePortalForNode("portal");

    expect(canvas.data.nodes[0].portal).toBeUndefined();
    expect(canvas.requestSave).not.toHaveBeenCalled();
    expect(canvas.requestFrame).not.toHaveBeenCalled();
    expect(Notice as any).toHaveBeenCalledWith("找不到 Portal 对应的 Canvas 文件。");
  });

  it("rejects a target that is not a Canvas file", () => {
    const { canvas, plugin, manager } = makeHarness();
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(makeTFile("md"));

    manager.togglePortalForNode("portal");

    expect(canvas.data.nodes[0].portal).toBeUndefined();
    expect(canvas.requestSave).not.toHaveBeenCalled();
    expect(Notice as any).toHaveBeenCalledWith("找不到 Portal 对应的 Canvas 文件。");
  });

  it("can close a Portal even after its source file has been deleted", () => {
    const { canvas, plugin, manager } = makeHarness(true);
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

    manager.togglePortalForNode("portal");

    expect(canvas.data.nodes[0].portal).toBe(false);
    expect(canvas.requestSave).toHaveBeenCalledOnce();
    expect(Notice as any).toHaveBeenCalledWith("Portal 已关闭。");
  });


  it("removes mirror nodes and mirror/cross edges from the live Canvas when closing a Portal", () => {
    const { canvas, plugin, manager } = makeHarness(true);
    const mirrorOne = "bcportal||portal||source-one";
    const mirrorTwo = "bcportal||portal||source-two";
    canvas.data.nodes.push(
      { id: mirrorOne, type: "text", text: "one", x: 48, y: 48, width: 100, height: 100 },
      { id: mirrorTwo, type: "text", text: "two", x: 248, y: 48, width: 100, height: 100 }
    );
    canvas.nodes.set(mirrorOne, { id: mirrorOne });
    canvas.nodes.set(mirrorTwo, { id: mirrorTwo });
    canvas.data.edges.push(
      { id: "bcportal||portal||source-edge", fromNode: mirrorOne, fromSide: "right", toNode: mirrorTwo, toSide: "left" },
      { id: "cross-edge", fromNode: mirrorOne, fromSide: "left", toNode: "portal", toSide: "right" }
    );
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(null);

    manager.togglePortalForNode("portal");

    expect(canvas.data.nodes.map((item: any) => item.id)).toEqual(["portal"]);
    expect(canvas.data.edges).toEqual([]);
    expect(canvas.data.nodes[0].portal).toBe(false);
    expect(canvas.requestSave).toHaveBeenCalledOnce();
    expect(Notice as any).toHaveBeenCalledWith("Portal 已关闭。");
  });

  it("does not write source positions when an open Portal moved before its mirrors refresh", async () => {
    const { canvas, view, plugin, manager } = makeHarness(true);
    const mirror = "bcportal||portal||source-one";
    canvas.data.nodes[0].x = 200;
    canvas.data.nodes.push({
      id: mirror, type: "text", text: "source", x: 48, y: 48, width: 100, height: 100
    });
    const file = makeTFile("canvas");
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(file);
    plugin.app.vault.cachedRead.mockResolvedValue(JSON.stringify({
      nodes: [{ id: "source-one", type: "text", text: "source", x: 0, y: 0, width: 100, height: 100 }],
      edges: []
    }));
    (manager as any).readyPortalIds.set(view, new Set(["portal"]));
    (manager as any).lastPortalPositions.set(view, new Map([["portal", { x: 0, y: 0 }]]));

    await (manager as any).syncPortalFiles(view);

    expect(manager.refreshView).toHaveBeenCalledWith(view, true);
    expect(plugin.app.vault.modify).not.toHaveBeenCalled();
  });

  it("detects movement of any open Portal independently of the current selection", () => {
    const previous = new Map([
      ["portal-a", { x: 0, y: 0 }],
      ["portal-b", { x: 400, y: 300 }]
    ]);
    const nodes: any[] = [
      { id: "portal-a", type: "file", file: "a.canvas", x: 0, y: 0, width: 200, height: 160, portal: true },
      { id: "portal-b", type: "file", file: "b.canvas", x: 600, y: 320, width: 200, height: 160, portal: true }
    ];

    expect(hasMovedOpenPortal(previous, nodes)).toBe(true);
    expect(hasMovedOpenPortal(previous, nodes.slice(0, 1))).toBe(false);
  });

  it("registers a command and context-menu action for open Portals", () => {
    const { plugin, manager } = makeHarness(true);
    const commands: any[] = [];
    const handlers = new Map<string, (...args: any[]) => void>();
    plugin.addCommand = (command: any) => commands.push(command);
    plugin.registerEvent = vi.fn();
    plugin.register = vi.fn();
    plugin.app.workspace.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return {};
    });
    plugin.app.workspace.onLayoutReady = vi.fn();
    plugin.app.workspace.getLeavesOfType = vi.fn(() => []);
    plugin.app.vault.on = vi.fn();

    manager.start();

    const command = commands.find(item => item.id === "bc-create-text-node-in-portal");
    expect(command).toBeDefined();
    const openModal = vi.spyOn(Modal.prototype, "open");
    command.callback();
    expect(openModal).toHaveBeenCalledOnce();

    openModal.mockClear();
    const items: any[] = [];
    const menu = {
      addItem: vi.fn((configure: (item: any) => unknown) => {
        const item: any = {
          setTitle(value: string) { this.title = value; return this; },
          setIcon() { return this; },
          onClick(callback: () => void) { this.action = callback; return this; }
        };
        configure(item);
        items.push(item);
        return item;
      })
    };
    const nodeMenuHandler = handlers.get("canvas:node-menu");
    expect(nodeMenuHandler).toBeDefined();
    nodeMenuHandler?.(menu, {
      id: "portal",
      getData: () => ({
        id: "portal", type: "file", file: "target.canvas",
        x: 0, y: 0, width: 200, height: 160, portal: true
      })
    });
    expect(menu.addItem).toHaveBeenCalledOnce();
    expect(items[0].title).toBe("在 Portal 源画布中创建文本节点");
    items[0].action();
    expect(openModal).toHaveBeenCalledOnce();

    openModal.mockClear();
    menu.addItem.mockClear();
    nodeMenuHandler?.(menu, {
      id: "closed",
      getData: () => ({
        id: "closed", type: "file", file: "target.canvas",
        x: 0, y: 0, width: 200, height: 160, portal: false
      })
    });
    expect(menu.addItem).not.toHaveBeenCalled();
  });

  it("opens and saves a Portal only when the target Canvas file exists", () => {
    const { canvas, plugin, manager } = makeHarness();
    plugin.app.vault.getAbstractFileByPath.mockReturnValue(makeTFile("canvas"));

    manager.togglePortalForNode("portal");

    expect(canvas.data.nodes[0].portal).toBe(true);
    expect(canvas.requestSave).toHaveBeenCalledOnce();
    expect(canvas.requestFrame).toHaveBeenCalledOnce();
    expect(Notice as any).toHaveBeenCalledWith("Portal 已打开。");
  });
});
