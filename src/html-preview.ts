import type { CanvasData, CanvasNodeData } from "./canvas";

export interface HtmlPreviewBlock {
  source: string;
  language: string;
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
    blocks.push({ language, source: source.slice(0, 200_000) });
    if (blocks.length >= 8) break;
  }
  return blocks;
}

function nodeElement(canvas: any, nodeId: string): HTMLElement | null {
  const internal = canvas?.nodes?.get?.(nodeId);
  const element = internal?.nodeEl ?? internal?.containerEl ?? internal?.el;
  return element instanceof HTMLElement ? element : null;
}

function renderControls(element: HTMLElement, block: HtmlPreviewBlock): void {
  let toolbar = element.querySelector<HTMLElement>(":scope > .bc-html-preview-toolbar");
  if (toolbar?.dataset.source === block.source) return;
  if (toolbar) toolbar.remove();

  toolbar = document.createElement("div");
  toolbar.className = "bc-html-preview-toolbar";
  toolbar.dataset.source = block.source;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bc-html-preview-toggle";
  button.textContent = "HTML 预览";
  button.title = "在隔离的沙盒 iframe 中运行此 HTML";
  button.setAttribute("aria-expanded", "false");

  const frame = document.createElement("iframe");
  frame.className = "bc-html-preview-frame";
  frame.title = "Isolated HTML preview";
  // No allow-same-origin, forms, popups, downloads, or top-navigation permissions.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "lazy");
  frame.hidden = true;
  frame.srcdoc = block.source;

  button.addEventListener("pointerdown", event => event.stopPropagation());
  button.addEventListener("mousedown", event => event.stopPropagation());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    frame.hidden = !frame.hidden;
    button.textContent = frame.hidden ? "HTML 预览" : "隐藏预览";
    button.setAttribute("aria-expanded", String(!frame.hidden));
  });

  toolbar.append(button, frame);
  element.appendChild(toolbar);
}

export function syncHtmlPreviewNode(canvas: any, node: CanvasNodeData): void {
  const element = nodeElement(canvas, node.id);
  if (!element) return;
  const blocks = extractHtmlPreviewBlocks(node.text);
  let existing = element.querySelector<HTMLElement>(":scope > .bc-html-preview-toolbar");

  if (!blocks.length) {
    existing?.remove();
    element.classList.remove("bc-has-html-preview");
    return;
  }

  // Keep the first HTML block as the preview target; source text remains untouched.
  renderControls(element, blocks[0]);
  element.classList.add("bc-has-html-preview");
}

export function isHtmlPreviewCandidate(node: CanvasNodeData): boolean {
  if (node.type === "text") return typeof node.text === "string";
  return node.type === "file" && typeof node.file === "string" && /\.md$/i.test(node.file);
}

/**
 * Sync text nodes immediately and load Markdown file-node contents from Vault.
 * Re-check node identity after async reads so deleted/repointed nodes aren't decorated.
 */
export function syncHtmlPreviews(canvas: any, data?: CanvasData, vault?: any): void {
  const nodes = data?.nodes ?? (canvas?.getData?.()?.nodes ?? []);
  const currentNodes = () => readCanvasNodes(canvas);
  const fileReads = new Map<string, Promise<string>>();

  for (const node of nodes) {
    if (node.type === "text" && typeof node.text === "string") {
      syncHtmlPreviewNode(canvas, node);
      continue;
    }
    if (node.type !== "file" || !isHtmlPreviewCandidate(node)) continue;

    const path = node.file;
    const file = vault?.getAbstractFileByPath?.(path);
    if (!file || String(file.extension ?? path.split(".").pop() ?? "").toLowerCase() !== "md" ||
        typeof vault?.cachedRead !== "function") {
      syncHtmlPreviewNode(canvas, { ...node, type: "text", text: "" } as CanvasNodeData);
      continue;
    }

    let read = fileReads.get(path);
    if (!read) {
      read = Promise.resolve(vault.cachedRead(file)).then((text: unknown) => {
        if (typeof text !== "string") throw new Error("Markdown file content was not text.");
        return text;
      });
      fileReads.set(path, read);
    }
    void read.then(text => {
      const current = currentNodes().find(candidate => candidate.id === node.id);
      if (!current || current.type !== "file" || current.file !== path) return;
      syncHtmlPreviewNode(canvas, { ...current, type: "text", text } as CanvasNodeData);
    }).catch(() => {
      const current = currentNodes().find(candidate => candidate.id === node.id);
      if (current?.type === "file" && current.file === path) {
        syncHtmlPreviewNode(canvas, { ...current, type: "text", text: "" } as CanvasNodeData);
      }
    });
  }
}

function readCanvasNodes(canvas: any): CanvasNodeData[] {
  const nodes = canvas?.getData?.()?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}
