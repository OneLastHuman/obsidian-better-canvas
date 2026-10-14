import { Component, loadPdfJs, TFile } from "obsidian";

const PINNED_MARKER = "pinned=true";
const PDF_CACHE = new Map<string, Promise<any>>();

function getPageNumber(subpath?: string): number | null {
  if (!subpath || !subpath.includes(PINNED_MARKER)) return null;
  const match = subpath.match(/[?#&]page=(\d+)/i);
  const page = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isInteger(page) && page > 0 ? page : null;
}

async function getPdfDocument(app: any, file: TFile): Promise<any> {
  const cached = PDF_CACHE.get(file.path);
  if (cached) return cached;
  const promise = (async () => {
    if (!(window as any).pdfjsLib) await loadPdfJs();
    const bytes = await app.vault.readBinary(file);
    return (window as any).pdfjsLib.getDocument({ data: bytes }).promise;
  })();
  PDF_CACHE.set(file.path, promise);
  try {
    return await promise;
  } catch (error) {
    PDF_CACHE.delete(file.path);
    throw error;
  }
}

class PinnedPdfPageEmbed extends Component {
  private plugin: any;
  private context: any;
  private file: TFile;
  private subpath?: string;
  private canvas: HTMLCanvasElement | null = null;
  private textDetails: HTMLDetailsElement | null = null;
  private textContentEl: HTMLDivElement | null = null;
  private excerptButton: HTMLButtonElement | null = null;
  private cancelled = false;

  constructor(plugin: any, context: any, file: TFile, subpath?: string) {
    super();
    this.plugin = plugin;
    this.context = context;
    this.file = file;
    this.subpath = subpath;
  }

  onload(): void {
    const container = this.context?.containerEl as HTMLElement | undefined;
    if (!container) return;
    container.classList.add("bc-pinned-pdf-embed-container");
    const canvas = document.createElement("canvas");
    canvas.className = "bc-pinned-pdf-page";
    canvas.setAttribute("aria-label", "Pinned PDF page");
    container.appendChild(canvas);
    this.canvas = canvas;

    const details = document.createElement("details");
    details.className = "bc-pdf-text-selection";
    const summary = document.createElement("summary");
    summary.textContent = "PDF 文本（选择文字后可创建摘录节点）";
    details.appendChild(summary);
    const textContent = document.createElement("div");
    textContent.className = "bc-pdf-selectable-text";
    textContent.textContent = "正在提取页面文本…";
    details.appendChild(textContent);
    const excerptButton = document.createElement("button");
    excerptButton.type = "button";
    excerptButton.className = "bc-pdf-create-excerpt";
    excerptButton.textContent = "从选中文本创建摘录节点";
    excerptButton.addEventListener("pointerdown", event => {
      event.stopPropagation();
    });
    excerptButton.addEventListener("mousedown", event => {
      // Keep the text selection anchored when the action button receives focus.
      event.preventDefault();
      event.stopPropagation();
    });
    excerptButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const text = String(window.getSelection()?.toString() ?? "").trim();
      container.dispatchEvent(new CustomEvent("better-canvas-pdf-selection", {
        bubbles: true,
        detail: { text }
      }));
    });
    details.appendChild(excerptButton);
    container.appendChild(details);
    this.textDetails = details;
    this.textContentEl = textContent;
    this.excerptButton = excerptButton;
  }

  async loadFile(): Promise<void> {
    const target = this.canvas;
    const pageNumber = getPageNumber(this.subpath);
    if (!target || !pageNumber) return;

    target.dataset.loading = "true";
    try {
      const pdf = await getPdfDocument(this.plugin.app, this.file);
      if (this.cancelled || !this.canvas) return;
      if (pageNumber > pdf.numPages) {
        target.dataset.error = "true";
        target.title = "PDF contains only " + pdf.numPages + " pages; requested page " + pageNumber + ".";
        return;
      }

      const page = await pdf.getPage(pageNumber);
      // Render at enough resolution for normal Canvas zoom, then scale to node width.
      const viewport = page.getViewport({ scale: 1.5 });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      target.style.width = "100%";
      target.style.height = "auto";
      target.style.display = "block";
      target.style.background = "white";
      target.dataset.page = String(pageNumber);

      const context = target.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not create a 2D canvas context.");
      await page.render({ canvasContext: context, viewport }).promise;

      // Expose selectable text without modifying the original PDF or relying on
      // undocumented native PDF selection internals. The details panel is
      // collapsed by default so the page preview remains compact.
      try {
        const textContent = await page.getTextContent();
        const selectableText = Array.isArray(textContent?.items)
          ? textContent.items
              .map((item: any) => typeof item?.str === "string" ? item.str : "")
              .filter(Boolean)
              .join(" ")
              .replace(/\\s+/g, " ")
              .trim()
          : "";
        if (this.textContentEl) {
          this.textContentEl.textContent = selectableText || "此页没有可提取的文本。扫描版页面需要 OCR 后才能选择文字。";
          this.textContentEl.dataset.extracted = String(Boolean(selectableText));
        }
        if (this.excerptButton) this.excerptButton.disabled = !selectableText;
      } catch (error) {
        if (this.textContentEl) this.textContentEl.textContent = "无法提取页面文本；如果这是扫描件，请先进行 OCR。";
        if (this.excerptButton) this.excerptButton.disabled = true;
        console.warn("Better Canvas PDF text extraction failed:", this.file.path, error);
      }
      if (!this.cancelled) delete target.dataset.loading;
    } catch (error) {
      if (this.cancelled || !target.isConnected) return;
      delete target.dataset.loading;
      target.dataset.error = "true";
      target.title = error instanceof Error ? error.message : String(error);
      const container = this.context?.containerEl as HTMLElement | undefined;
      if (container && !container.querySelector(".bc-pinned-pdf-error")) {
        const message = document.createElement("div");
        message.className = "bc-pinned-pdf-error";
        message.textContent = "PDF 页面加载失败。请打开开发者控制台查看详情。";
        container.appendChild(message);
      }
      console.error("Better Canvas pinned PDF page render failed:", this.file.path, error);
    }
  }

  onunload(): void {
    this.cancelled = true;
    this.canvas?.remove();
    this.canvas = null;
    this.textDetails?.remove();
    this.textDetails = null;
    this.textContentEl = null;
    this.excerptButton = null;
  }
}

/**
 * Overrides only PDF subpaths marked with pinned=true. Ordinary PDF embeds
 * continue to use Obsidian's original factory.
 */
export class PinnedPdfPageRenderer {
  private plugin: any;
  private originalEmbed: any;
  private wrappedEmbed: any;
  private registry: any;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  start(): void {
    this.registry = (this.plugin.app as any).embedRegistry;
    const entries = this.registry?.embedByExtension;
    const original = entries?.pdf;
    if (!entries || typeof original !== "function") {
      console.warn("Better Canvas: Obsidian PDF embed registry is unavailable; pinned PDF rendering is disabled.");
      return;
    }

    this.originalEmbed = original;
    const plugin = this.plugin;
    this.wrappedEmbed = function (context: any, file: TFile, subpath?: string) {
      if (file instanceof TFile && getPageNumber(subpath) !== null) {
        return new PinnedPdfPageEmbed(plugin, context, file, subpath);
      }
      return original.call(this, context, file, subpath);
    };
    entries.pdf = this.wrappedEmbed;
    this.plugin.register(() => this.stop());
  }

  stop(): void {
    const entries = this.registry?.embedByExtension;
    if (entries?.pdf === this.wrappedEmbed && this.originalEmbed) entries.pdf = this.originalEmbed;
    this.wrappedEmbed = null;
    this.originalEmbed = null;
  }
}

export function pinnedPdfSubpath(pageNumber: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error("PDF page number must be a positive integer.");
  }
  return "#page=" + pageNumber + "&" + PINNED_MARKER;
}
