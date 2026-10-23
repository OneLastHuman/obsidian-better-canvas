import type { CanvasData, CanvasNodeData } from "./canvas";

export interface HtmlPreviewBlock {
  source: string;
  language: string;
}

export const MAX_HTML_PREVIEW_LENGTH = 200_000;
const controls = new WeakMap<HTMLElement, { source: string; file: boolean; error: string; open: boolean }>();
interface FileRead {
  file: any;
  stamp: string;
  result: Promise<string>;
}
interface PreviewState {
  reads: Map<string, FileRead>;
  pending: Map<string, { read: FileRead; element: HTMLElement }>;
}
const states = new WeakMap<object, PreviewState>();

export function isHtmlFile(path: unknown): path is string {
  return typeof path === "string" && /\.html?$/i.test(path);
}

/** Extract HTML fences from a Canvas text node without evaluating them in Obsidian's DOM. */
export function extractHtmlPreviewBlocks(text: unknown): HtmlPreviewBlock[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const blocks: HtmlPreviewBlock[] = [];
  const fence = /```([a-zA-Z0-9_-]+)[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const language = match[1].toLowerCase();
    if (language !== "html" && language !== "htm") continue;
    const source = match[2].trim();
    if (!source) continue;
    // Limit iframe payload size to prevent accidentally mounting multi-megabyte data URLs/code.
    blocks.push({ language, source: source.slice(0, MAX_HTML_PREVIEW_LENGTH) });
    if (blocks.length >= 8) break;
  }
  return blocks;
}

function nodeElement(canvas: any, nodeId: string): HTMLElement | null {
  const internal = canvas?.nodes?.get?.(nodeId);
  const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
  return element?.ownerDocument && element.isConnected ? element : null;
}

function removeControls(element: HTMLElement): void {
  element.querySelector(":scope > .bc-html-preview-toolbar")?.remove();
  element.classList.remove("bc-has-html-preview");
  controls.delete(element);
}

function renderControls(element: HTMLElement, source: string, file = false, error = ""): void {
  let toolbar = element.querySelector<HTMLElement>(":scope > .bc-html-preview-toolbar");
  const previous = controls.get(element);
  if (toolbar && previous?.source === source && previous.file === file && previous.error === error) return;
  const open = previous?.file === file ? previous.open : file;
  toolbar?.remove();
  const controlState = { source, file, error, open };
  controls.set(element, controlState);

  const doc = element.ownerDocument;
  toolbar = doc.createElement("div");
  toolbar.className = "bc-html-preview-toolbar" + (file ? " bc-html-file-preview" : "");

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "bc-html-preview-toggle";
  button.title = "在沙盒中预览 HTML";
  let frame: HTMLIFrameElement | undefined;
  const message = doc.createElement("div");
  message.className = "bc-html-preview-error";
  message.setAttribute("role", "status");
  message.textContent = error;
  if (error) toolbar.appendChild(message);

  // Create srcdoc only when visible; closing the preview also stops its scripts.
  const show = (visible: boolean): void => {
    controlState.open = visible;
    if (visible && !frame && !error) {
      frame = doc.createElement("iframe");
      frame.className = "bc-html-preview-frame";
      frame.title = "HTML 预览";
      // Never grant same-origin, forms, popups, downloads or top navigation.
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.srcdoc = source;
      toolbar!.appendChild(frame);
    } else if (!visible) {
      frame?.remove();
      frame = undefined;
    }
    message.hidden = !visible;
    button.textContent = visible ? "隐藏预览" : "HTML 预览";
    button.setAttribute("aria-expanded", String(visible));
  };
  button.addEventListener("pointerdown", event => event.stopPropagation());
  button.addEventListener("mousedown", event => event.stopPropagation());
  button.addEventListener("dblclick", event => event.stopPropagation());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    show(button.getAttribute("aria-expanded") !== "true");
  });

  toolbar.appendChild(button);
  show(open);
  element.appendChild(toolbar);
  element.classList.add("bc-has-html-preview");
}

export function syncHtmlPreviewNode(canvas: any, node: CanvasNodeData): void {
  const element = nodeElement(canvas, node.id);
  if (!element) return;
  const blocks = extractHtmlPreviewBlocks(node.text);
  if (!blocks.length) {
    removeControls(element);
    return;
  }

  // Keep the first HTML block as the preview target; source text remains untouched.
  renderControls(element, blocks[0].source);
}

export function isHtmlPreviewCandidate(node: CanvasNodeData): boolean {
  if (node.type === "text") return typeof node.text === "string";
  return node.type === "file" && typeof node.file === "string" && (isHtmlFile(node.file) || /\.md$/i.test(node.file));
}

/**
 * Cache reads across decoration/DOM events. Each completion must still match the
 * current node, DOM element and cache entry, including after unload or invalidation.
 */
export function syncHtmlPreviews(canvas: any, data?: CanvasData, vault?: any): void {
  if (!canvas) return;
  let state = states.get(canvas);
  if (!state) {
    state = { reads: new Map(), pending: new Map() };
    states.set(canvas, state);
  }
  const nodes = data?.nodes ?? (canvas?.getData?.()?.nodes ?? []);
  const livePaths = new Set<string>();
  const liveIds = new Set<string>();
  for (const node of nodes) {
    const element = nodeElement(canvas, node.id);
    if (!element) continue;
    liveIds.add(node.id);
    if (node.type === "text" && typeof node.text === "string") {
      state.pending.delete(node.id);
      syncHtmlPreviewNode(canvas, node);
      continue;
    }
    if (node.type !== "file" || !isHtmlPreviewCandidate(node)) {
      state.pending.delete(node.id);
      removeControls(element);
      continue;
    }

    const path = node.file!;
    const html = isHtmlFile(path);
    livePaths.add(path);
    const file = vault?.getAbstractFileByPath?.(path);
    const fail = (message: string): void => {
      if (html) renderControls(element, "", true, message);
      else removeControls(element);
    };
    if (!file || typeof file.extension !== "string" || typeof vault?.cachedRead !== "function") {
      state.reads.delete(path);
      state.pending.delete(node.id);
      fail("无法读取 HTML 文件。请确认文件仍在仓库中。");
      continue;
    }
    if (html && file.stat?.size > MAX_HTML_PREVIEW_LENGTH * 4) {
      state.reads.delete(path);
      state.pending.delete(node.id);
      fail("HTML 文件过大，预览最多支持 200,000 个字符。");
      continue;
    }

    const stamp = `${file.stat?.mtime}:${file.stat?.size}`;
    let read = state.reads.get(path);
    if (!read || read.file !== file || read.stamp !== stamp) {
      read = {
        file, stamp,
        result: Promise.resolve().then(() => vault.cachedRead(file)).then((text: unknown) => {
          if (typeof text !== "string") throw new Error("File content was not text.");
          return text;
        })
      };
      state.reads.set(path, read);
    }
    const pending = state.pending.get(node.id);
    if (pending?.read === read && pending.element === element &&
        (!controls.has(element) || element.querySelector(":scope > .bc-html-preview-toolbar"))) continue;
    state.pending.set(node.id, { read, element });
    const currentNode = (): CanvasNodeData | undefined => {
      if (states.get(canvas) !== state || state.reads.get(path) !== read ||
          state.pending.get(node.id)?.read !== read || nodeElement(canvas, node.id) !== element) return;
      return readCanvasNodes(canvas).find(candidate => candidate.id === node.id && candidate.type === "file" && candidate.file === path);
    };
    void read.result.then(text => {
      const current = currentNode();
      if (!current) return;
      if (!html) syncHtmlPreviewNode(canvas, { ...current, type: "text", text });
      else if (text.length > MAX_HTML_PREVIEW_LENGTH) fail("HTML 文件过大，预览最多支持 200,000 个字符。");
      else if (!text.trim()) fail("HTML 文件为空。");
      else renderControls(element, text, true);
    }).catch(() => {
      if (currentNode()) fail("无法读取 HTML 文件。请检查文件后重新打开画布。");
    });
  }
  for (const path of state.reads.keys()) if (!livePaths.has(path)) state.reads.delete(path);
  for (const id of state.pending.keys()) if (!liveIds.has(id)) state.pending.delete(id);
}

function readCanvasNodes(canvas: any): CanvasNodeData[] {
  const nodes = canvas?.getData?.()?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

export function clearHtmlPreviews(canvas: any): void {
  states.delete(canvas);
  for (const internal of canvas?.nodes?.values?.() ?? []) {
    const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
    if (element?.querySelector) removeControls(element);
  }
}

/** File and DOM lifecycle is independent of text auto-resize and readonly mode. */
export class HtmlPreviewManager {
  private views = new Map<any, { container: HTMLElement; observer: MutationObserver; timer?: ReturnType<typeof setTimeout> }>();
  private stopped = false;

  constructor(private readonly plugin: any) {}

  start(): void {
    const { workspace, vault } = this.plugin.app;
    for (const name of ["layout-change", "active-leaf-change"]) {
      this.plugin.registerEvent(workspace.on(name, () => this.refresh()));
    }
    for (const name of ["advanced-canvas:node-changed", "advanced-canvas:node-text-content-changed",
      "advanced-canvas:data-loaded:after"]) {
      this.plugin.registerEvent(workspace.on(name, (canvas: any) => {
        if (this.views.has(canvas)) syncHtmlPreviews(canvas, undefined, vault);
      }));
    }
    for (const name of ["create", "modify", "delete", "rename"]) {
      this.plugin.registerEvent(vault.on(name, (file: any, oldPath?: string) => {
        for (const canvas of this.views.keys()) {
          // Folder renames/deletes invalidate descendant paths too.
          for (const path of states.get(canvas)?.reads.keys() ?? []) {
            if ([file?.path, oldPath].some(prefix => typeof prefix === "string" &&
                (path === prefix || path.startsWith(prefix + "/")))) states.get(canvas)?.reads.delete(path);
          }
          syncHtmlPreviews(canvas, undefined, vault);
        }
      }));
    }
    this.plugin.registerEvent(workspace.on("advanced-canvas:canvas-view-unloaded:before", (view: any) => this.remove(view.canvas)));
    this.plugin.register(() => this.stop());
    workspace.onLayoutReady(() => this.refresh());
  }

  refresh(): void {
    if (this.stopped) return;
    const live = new Set<any>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
      const { canvas, containerEl } = leaf.view ?? {};
      if (!canvas || !containerEl?.ownerDocument) continue;
      live.add(canvas);
      if (this.views.get(canvas)?.container !== containerEl) {
        this.remove(canvas);
        const Observer = containerEl.ownerDocument.defaultView?.MutationObserver;
        if (!Observer) continue;
        const observer = new Observer(() => {
          const entry = this.views.get(canvas);
          if (!entry || entry.timer !== undefined) return;
          entry.timer = setTimeout(() => {
            entry.timer = undefined;
            syncHtmlPreviews(canvas, undefined, this.plugin.app.vault);
          }, 50);
        });
        this.views.set(canvas, { container: containerEl, observer });
        observer.observe(containerEl, { childList: true, subtree: true });
      }
      syncHtmlPreviews(canvas, undefined, this.plugin.app.vault);
    }
    for (const canvas of this.views.keys()) if (!live.has(canvas)) this.remove(canvas);
  }

  private remove(canvas: any): void {
    const entry = this.views.get(canvas);
    entry?.observer.disconnect();
    if (entry?.timer !== undefined) clearTimeout(entry.timer);
    this.views.delete(canvas);
    clearHtmlPreviews(canvas);
  }

  stop(): void {
    this.stopped = true;
    for (const canvas of this.views.keys()) this.remove(canvas);
  }
}
