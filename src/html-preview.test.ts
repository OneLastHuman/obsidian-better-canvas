import { afterEach, describe, expect, it, vi } from "vitest";
import { clearHtmlPreviews, extractHtmlPreviewBlocks, HtmlPreviewManager, isHtmlPreviewCandidate, syncHtmlPreviews } from "./html-preview";

describe("HTML preview extraction", () => {
  it("extracts fenced HTML case-insensitively and leaves other languages alone", () => {
    expect(extractHtmlPreviewBlocks([
      "```ts",
      "const x = 1;",
      "```",
      "```HTML",
      "<h1>Hello</h1>",
      "```"
    ].join("\n"))).toEqual([{ language: "html", source: "<h1>Hello</h1>" }]);
  });

  it("supports multiple blocks and ignores empty or unlabeled fences", () => {
    const result = extractHtmlPreviewBlocks([
      "```",
      "<p>not labeled</p>",
      "```",
      "```html",
      "",
      "```",
      "```htm",
      "<p>one</p>",
      "```",
      "```html",
      "<p>two</p>",
      "```"
    ].join("\n"));
    expect(result).toEqual([
      { language: "htm", source: "<p>one</p>" },
      { language: "html", source: "<p>two</p>" }
    ]);
  });

  it("ignores non-text values and caps excessive source payloads", () => {
    expect(extractHtmlPreviewBlocks(null)).toEqual([]);
    expect(extractHtmlPreviewBlocks(42)).toEqual([]);
    const result = extractHtmlPreviewBlocks("```html\n" + "x".repeat(200_001) + "\n```");
    expect(result[0].source).toHaveLength(200_000);
  });
});

describe("HTML preview candidates", () => {
  it("supports text, Markdown and HTML/HTM file nodes, including uppercase extensions", () => {
    expect(isHtmlPreviewCandidate({ id: "t", type: "text", text: "```html\n<p>x</p>\n```" } as any)).toBe(true);
    expect(isHtmlPreviewCandidate({ id: "m", type: "file", file: "notes/idea.md" } as any)).toBe(true);
    for (const file of ["demo.html", "folder/demo.htm", "folder/DEMO.HTML", "demo.HTM"]) {
      expect(isHtmlPreviewCandidate({ id: "h", type: "file", file } as any)).toBe(true);
    }
    expect(isHtmlPreviewCandidate({ id: "b", type: "file", file: "demo.html.bak" } as any)).toBe(false);
    expect(isHtmlPreviewCandidate({ id: "p", type: "file", file: "docs/book.pdf" } as any)).toBe(false);
    expect(isHtmlPreviewCandidate({ id: "g", type: "group" } as any)).toBe(false);
  });
});

// Only the DOM surface used by the preview is simulated. Browser sandbox
// enforcement and native Canvas interaction are verified separately in Obsidian.
class Element {
  children: Element[] = [];
  parent?: Element;
  className = "";
  classList = { add: vi.fn(), remove: vi.fn() };
  attributes = new Map<string, string>();
  handlers = new Map<string, (event: any) => void>();
  isConnected = true;
  hidden = false;
  srcdoc = "";
  textContent = "";
  constructor(public tagName = "div", public ownerDocument: any = doc) {}
  appendChild(child: Element) { child.parent = this; this.children.push(child); return child; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = undefined;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener(name: string, handler: (event: any) => void) { this.handlers.set(name, handler); }
  click() { this.handlers.get("click")?.({ preventDefault() {}, stopPropagation() {} }); }
  querySelector(selector: string): Element | null {
    const direct = selector.startsWith(":scope > ");
    const pattern = selector.replace(":scope > ", "");
    for (const child of this.children) {
      if (pattern.startsWith(".") ? child.className.split(" ").includes(pattern.slice(1)) : child.tagName === pattern) return child;
      if (!direct) { const found = child.querySelector(selector); if (found) return found; }
    }
    return null;
  }
}
const observers: Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
const doc = {
  createElement: (tag: string) => new Element(tag),
  defaultView: {
    MutationObserver: class {
      disconnect = vi.fn();
      constructor(public callback: () => void) { observers.push(this); }
      observe() {}
    }
  }
};
afterEach(() => {
  observers.length = 0;
  vi.useRealTimers();
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(path = "demo.html", source = "<button onclick='this.textContent=2'>1</button>") {
  const element = new Element();
  const node = { id: "node", type: "file", file: path, x: 10, y: 20, width: 320, height: 240, custom: "preserve" };
  const data: any = { nodes: [node], edges: [], custom: "unchanged" };
  const canvas = {
    getData: () => data, nodes: new Map([["node", { nodeEl: element }]]),
    requestSave: vi.fn(), importData: vi.fn(), readonly: true
  };
  const file = { path, extension: path.split(".").pop(), stat: { mtime: 1, size: source.length } };
  const vault = { getAbstractFileByPath: vi.fn((): any => file), cachedRead: vi.fn(async () => source) };
  return { element, node, data, canvas, file, vault };
}

describe("file preview lifecycle", () => {
  it.each(["demo.html", "demo.htm", "DEMO.HTML"])("automatically renders %s without changing Canvas data, including readonly", async path => {
    const f = fixture(path);
    const before = JSON.stringify(f.data);
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    const frame = f.element.querySelector("iframe")!;
    expect(frame.srcdoc).toContain("<button");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(f.element.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(JSON.stringify(f.data)).toBe(before);
    expect(f.canvas.requestSave).not.toHaveBeenCalled();
    expect(f.canvas.importData).not.toHaveBeenCalled();
  });

  it("keeps Markdown fences opt-in and stops scripts by removing hidden frames", async () => {
    const f = fixture("notes.md", "```html\n<h1>Demo</h1>\n```");
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.element.querySelector("iframe")).toBeNull();
    f.element.querySelector("button")!.click();
    expect(f.element.querySelector("iframe")!.srcdoc).toBe("<h1>Demo</h1>");
    f.element.querySelector("button")!.click();
    expect(f.element.querySelector("iframe")).toBeNull();
  });

  it("keeps text fences opt-in and does not recognize unfenced HTML", () => {
    const f = fixture();
    f.data.nodes = [{ ...f.node, type: "text", text: "```html\n<p>Text</p>\n```" }];
    syncHtmlPreviews(f.canvas);
    expect(f.element.querySelector("button")).not.toBeNull();
    expect(f.element.querySelector("iframe")).toBeNull();
    f.data.nodes[0].text = "<p>Text</p>";
    syncHtmlPreviews(f.canvas);
    expect(f.element.querySelector("button")).toBeNull();
  });

  it("does not reload an unchanged interactive page or reread its file on decoration", async () => {
    const f = fixture();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    const frame = f.element.querySelector("iframe");
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.vault.cachedRead).toHaveBeenCalledTimes(1);
    expect(f.element.querySelector("iframe")).toBe(frame);
    f.element.querySelector("button")!.click();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.element.querySelector("iframe")).toBeNull();
  });

  it("refreshes a changed file but preserves the user's collapsed state", async () => {
    const f = fixture();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    f.element.querySelector("button")!.click();
    f.file.stat.mtime++;
    f.vault.cachedRead.mockResolvedValue("<p>Updated</p>");
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.element.querySelector("iframe")).toBeNull();
    f.element.querySelector("button")!.click();
    expect(f.element.querySelector("iframe")!.srcdoc).toBe("<p>Updated</p>");
  });

  it("deduplicates reads for multiple nodes referencing one file", async () => {
    const f = fixture();
    const second = new Element();
    f.data.nodes.push({ ...f.node, id: "second" });
    f.canvas.nodes.set("second", { nodeEl: second });
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.vault.cachedRead).toHaveBeenCalledTimes(1);
    expect(second.querySelector("iframe")).not.toBeNull();
  });

  it("restores controls removed by a native rerender of the same node element", async () => {
    const f = fixture();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    f.element.querySelector(".bc-html-preview-toolbar")!.remove();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.element.querySelector("button")).not.toBeNull();
    expect(f.element.querySelector("iframe")).not.toBeNull();
    expect(f.vault.cachedRead).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized and empty files without executing truncated source", async () => {
    for (const source of ["x".repeat(200_001), "   "]) {
      const f = fixture("demo.html", source);
      syncHtmlPreviews(f.canvas, undefined, f.vault);
      await flush();
      expect(f.element.querySelector("iframe")).toBeNull();
      expect(f.element.querySelector(".bc-html-preview-error")!.textContent).toMatch(/过大|为空/);
    }
    const f = fixture();
    f.file.stat.size = 900_000;
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.vault.cachedRead).not.toHaveBeenCalled();
  });

  it("shows read failures and missing files without retaining a stale running page", async () => {
    const f = fixture();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    f.file.stat.mtime++;
    f.vault.cachedRead.mockRejectedValue(new Error("private filesystem details"));
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    expect(f.element.querySelector("iframe")).toBeNull();
    expect(f.element.querySelector(".bc-html-preview-error")!.textContent).toContain("无法读取");
    expect(f.element.querySelector(".bc-html-preview-error")!.textContent).not.toContain("private");
    f.vault.getAbstractFileByPath.mockReturnValue(null);
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    expect(f.element.querySelector("iframe")).toBeNull();
  });

  it.each(["delete", "repoint", "unmount", "clear"])("ignores pending reads after %s", async action => {
    const f = fixture();
    let resolve!: (value: string) => void;
    f.vault.cachedRead.mockReturnValue(new Promise(r => { resolve = r; }));
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    if (action === "delete") f.data.nodes = [];
    if (action === "repoint") f.node.file = "other.html";
    if (action === "unmount") f.element.isConnected = false;
    if (action === "clear") clearHtmlPreviews(f.canvas);
    resolve("<p>Stale</p>");
    await flush();
    expect(f.element.querySelector("iframe")).toBeNull();
  });

  it("does not let an older read overwrite a newer version", async () => {
    const f = fixture();
    let resolve!: (value: string) => void;
    f.vault.cachedRead.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    f.file.stat.mtime++;
    f.vault.cachedRead.mockResolvedValue("<p>New</p>");
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    resolve("<p>Old</p>");
    await flush();
    expect(f.element.querySelector("iframe")!.srcdoc).toBe("<p>New</p>");
  });

  it("removes previews when a node changes to an unsupported type", async () => {
    const f = fixture();
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    await flush();
    f.node.file = "photo.png";
    syncHtmlPreviews(f.canvas, undefined, f.vault);
    expect(f.element.querySelector("iframe")).toBeNull();
  });
});

describe("preview manager", () => {
  it("refreshes on Vault changes and DOM remounts and cleans up on unload", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const events = new Map<string, (...args: any[]) => void>();
    const register = (name: string, handler: (...args: any[]) => void) => events.set(name, handler);
    const containerEl = new Element();
    const view = { canvas: f.canvas, containerEl };
    const workspace = { on: register, onLayoutReady: (callback: () => void) => callback(), getLeavesOfType: () => [{ view }] };
    const cleanups: Array<() => void> = [];
    const manager = new HtmlPreviewManager({
      app: { workspace, vault: { ...f.vault, on: register } },
      registerEvent() {}, register: (cleanup: () => void) => cleanups.push(cleanup)
    });
    manager.start();
    await flush();
    expect(f.element.querySelector("iframe")).not.toBeNull();
    f.vault.cachedRead.mockResolvedValue("<p>Modified without mtime change</p>");
    events.get("modify")!(f.file);
    await flush();
    expect(f.element.querySelector("iframe")!.srcdoc).toContain("Modified");
    const replacement = new Element();
    f.canvas.nodes.set("node", { nodeEl: replacement });
    observers[0].callback();
    await vi.advanceTimersByTimeAsync(50);
    expect(replacement.querySelector("iframe")).not.toBeNull();
    expect(f.vault.cachedRead).toHaveBeenCalledTimes(2);
    events.get("advanced-canvas:canvas-view-unloaded:before")!(view);
    expect(replacement.querySelector("iframe")).toBeNull();
    expect(observers[0].disconnect).toHaveBeenCalled();
    cleanups.forEach(cleanup => cleanup());
    manager.refresh();
    expect(replacement.querySelector("iframe")).toBeNull();
  });
});
