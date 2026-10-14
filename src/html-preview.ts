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

export function syncHtmlPreviews(canvas: any, data?: CanvasData): void {
  const nodes = data?.nodes ?? (canvas?.getData?.()?.nodes ?? []);
  for (const node of nodes) {
    if (node.type === "text" && typeof node.text === "string") {
      syncHtmlPreviewNode(canvas, node);
    }
  }
}
