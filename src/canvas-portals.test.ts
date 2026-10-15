import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import { CanvasPortalManager } from "./canvas-portals";

vi.mock("obsidian", () => ({
  ItemView: class ItemView {},
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
    getData() { return this.data; },
    importData(next: any) { this.data = next; },
    requestSave: vi.fn(),
    requestFrame: vi.fn(),
    selection: { size: 1, values: () => [{ id: "portal" }] }
  };
  const view = { getViewType: () => "canvas", canvas, file: { path: "host.canvas" } };
  const plugin: any = {
    app: {
      workspace: { getActiveViewOfType: vi.fn(() => view) },
      vault: { getAbstractFileByPath: vi.fn() }
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
