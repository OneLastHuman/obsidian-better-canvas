import { loadPdfJs, TFile } from "obsidian";

export interface PdfPageContext {
  pageNumber: number;
  text: string;
  imageDataUrl?: string;
}

const documents = new Map<string, Promise<any>>();
const pageCache = new Map<string, Promise<PdfPageContext>>();

function documentCacheKey(file: TFile): string {
  return file.path + "|" + file.stat.mtime + "|" + file.stat.size;
}

async function getPdfDocument(app: any, file: TFile): Promise<any> {
  const key = documentCacheKey(file);
  const existing = documents.get(key);
  if (existing) return existing;

  const task = (async () => {
    if (!(window as any).pdfjsLib) await loadPdfJs();
    const bytes = await app.vault.readBinary(file);
    return (window as any).pdfjsLib.getDocument({ data: bytes }).promise;
  })();
  documents.set(key, task);
  try {
    return await task;
  } catch (error) {
    documents.delete(key);
    throw error;
  }
}

function pageFromSubpath(subpath?: string): number | null {
  if (typeof subpath !== "string") return null;
  const match = subpath.match(/[?#&]page=(\d+)/i);
  const value = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function decodeText(content: any): string {
  const items = Array.isArray(content?.items) ? content.items : [];
  return items
    .map((item: any) => typeof item?.str === "string" ? item.str : "")
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

async function getPageContext(app: any, file: TFile, pageNumber: number, includeImage: boolean): Promise<PdfPageContext> {
  const key = documentCacheKey(file) + "|page=" + pageNumber + "|image=" + includeImage;
  const cached = pageCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    const pdf = await getPdfDocument(app, file);
    if (pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error("PDF 页面编号超出范围：" + pageNumber + " / " + pdf.numPages);
    }
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = decodeText(content);
    let imageDataUrl: string | undefined;

    if (includeImage) {
      const rawViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.25, 1400 / Math.max(1, rawViewport.width), 1800 / Math.max(1, rawViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (context) {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        imageDataUrl = canvas.toDataURL("image/png");
      }
      canvas.width = 0;
      canvas.height = 0;
    }

    return { pageNumber, text: text.slice(0, 12000), ...(imageDataUrl ? { imageDataUrl } : {}) };
  })();

  pageCache.set(key, task);
  try {
    return await task;
  } catch (error) {
    pageCache.delete(key);
    throw error;
  }
}

export async function extractPdfPages(
  app: any,
  file: TFile,
  subpath?: string,
  maxPages = 3,
  includeImages = false
): Promise<PdfPageContext[]> {
  const pdf = await getPdfDocument(app, file);
  const requestedPage = pageFromSubpath(subpath);
  const pageNumbers = requestedPage
    ? [requestedPage]
    : Array.from({ length: Math.min(Math.max(1, maxPages), pdf.numPages) }, (_, index) => index + 1);

  const pages: PdfPageContext[] = [];
  for (const pageNumber of pageNumbers) {
    if (pageNumber > pdf.numPages) continue;
    pages.push(await getPageContext(app, file, pageNumber, includeImages));
  }
  return pages;
}

export function clearPdfContextCache(filePath?: string): void {
  if (!filePath) {
    documents.clear();
    pageCache.clear();
    return;
  }
  for (const key of documents.keys()) if (key.startsWith(filePath + "|")) documents.delete(key);
  for (const key of pageCache.keys()) if (key.startsWith(filePath + "|")) pageCache.delete(key);
}
