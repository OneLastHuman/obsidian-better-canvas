export interface PdfAnnotationBundleSummary {
  markdown: string;
  pageCount: number;
  highlightCount: number;
  strokeCount: number;
  truncated: boolean;
}

interface Point { x: number; y: number; }
interface Rect { x: number; y: number; width: number; height: number; }
interface ExportHighlight {
  text: string;
  rects: Rect[];
  color: string;
  opacity: number;
  createdAt?: number;
  textTruncated?: boolean;
}
interface ExportStroke {
  points: Point[];
  color: string;
  width: number;
  tool: "pen" | "highlighter";
  opacity?: number;
  createdAt?: number;
}
interface ExportPage {
  id: string;
  file: string;
  page: number;
  highlights: ExportHighlight[];
  strokes: ExportStroke[];
}
interface ExportBudget {
  truncated: boolean;
  totalPoints: number;
  totalRects: number;
}

const MAX_PAGES = 100;
const MAX_HIGHLIGHTS_PER_PAGE = 100;
const MAX_STROKES_PER_PAGE = 100;
const MAX_RECTS_PER_HIGHLIGHT = 100;
const MAX_POINTS_PER_STROKE = 1000;
const MAX_TOTAL_POINTS = 10000;
const MAX_TOTAL_RECTS = 10000;
const MAX_HIGHLIGHT_TEXT = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function getPageNumber(subpath: string): number | null {
  if (!subpath.includes("pinned=true")) return null;
  const match = subpath.match(/[?#&]page=(\d+)/i);
  if (!match) return null;
  const page = Number.parseInt(match[1], 10);
  return Number.isInteger(page) && page > 0 ? page : null;
}
function isPinnedPdf(node: Record<string, unknown>): boolean {
  return node.type === "file" &&
    typeof node.file === "string" &&
    node.file.toLowerCase().endsWith(".pdf") &&
    typeof node.subpath === "string" &&
    getPageNumber(node.subpath) !== null;
}
function validTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Number.isFinite(new Date(value).getTime()) ? value : undefined;
}
function normalizeRect(value: unknown): Rect | null {
  if (!isRecord(value) ||
      typeof value.x !== "number" || !Number.isFinite(value.x) ||
      typeof value.y !== "number" || !Number.isFinite(value.y) ||
      typeof value.width !== "number" || !Number.isFinite(value.width) ||
      typeof value.height !== "number" || !Number.isFinite(value.height) ||
      value.width <= 0 || value.height <= 0) return null;
  const x = clamp(value.x, 0, 1);
  const y = clamp(value.y, 0, 1);
  const width = clamp(value.width, 0, 1 - x);
  const height = clamp(value.height, 0, 1 - y);
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
function normalizeHighlights(value: unknown, budget: ExportBudget): ExportHighlight[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_HIGHLIGHTS_PER_PAGE) budget.truncated = true;
  const result: ExportHighlight[] = [];
  for (const item of value.slice(0, MAX_HIGHLIGHTS_PER_PAGE)) {
    if (!isRecord(item)) continue;
    const rawText = typeof item.text === "string" ? item.text : "";
    const textTruncated = rawText.length > MAX_HIGHLIGHT_TEXT;
    if (textTruncated) budget.truncated = true;
    const rects: Rect[] = [];
    const rawRects = Array.isArray(item.rects) ? item.rects : [];
    if (rawRects.length > MAX_RECTS_PER_HIGHLIGHT) budget.truncated = true;
    for (const rawRect of rawRects.slice(0, MAX_RECTS_PER_HIGHLIGHT)) {
      if (budget.totalRects >= MAX_TOTAL_RECTS) {
        budget.truncated = true;
        break;
      }
      const rect = normalizeRect(rawRect);
      if (!rect) continue;
      rects.push(rect);
      budget.totalRects++;
    }
    if (!rawText.trim() && rects.length === 0) continue;
    const createdAt = validTimestamp(item.createdAt);
    result.push({
      text: rawText.slice(0, MAX_HIGHLIGHT_TEXT),
      rects,
      color: typeof item.color === "string" ? item.color.slice(0, 64) : "#ffeb3b",
      opacity: typeof item.opacity === "number" && Number.isFinite(item.opacity)
        ? clamp(item.opacity, 0, 1)
        : 0.36,
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(textTruncated ? { textTruncated: true } : {})
    });
  }
  return result;
}
function normalizeStrokes(value: unknown, budget: ExportBudget): ExportStroke[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_STROKES_PER_PAGE) budget.truncated = true;
  const result: ExportStroke[] = [];
  for (const item of value.slice(0, MAX_STROKES_PER_PAGE)) {
    if (!isRecord(item) || !Array.isArray(item.points)) continue;
    const validPoints: Point[] = [];
    for (const rawPoint of item.points) {
      if (!isRecord(rawPoint) ||
          typeof rawPoint.x !== "number" || !Number.isFinite(rawPoint.x) ||
          typeof rawPoint.y !== "number" || !Number.isFinite(rawPoint.y)) continue;
      validPoints.push({ x: clamp(rawPoint.x, 0, 1), y: clamp(rawPoint.y, 0, 1) });
    }
    if (!validPoints.length) continue;
    const allowedByTotal = Math.max(0, MAX_TOTAL_POINTS - budget.totalPoints);
    const allowedPoints = Math.min(validPoints.length, MAX_POINTS_PER_STROKE, allowedByTotal);
    if (allowedPoints < validPoints.length) budget.truncated = true;
    if (allowedPoints === 0) continue;
    const createdAt = validTimestamp(item.createdAt);
    budget.totalPoints += allowedPoints;
    result.push({
      points: validPoints.slice(0, allowedPoints),
      color: typeof item.color === "string" ? item.color.slice(0, 64) : "#e53935",
      width: typeof item.width === "number" && Number.isFinite(item.width)
        ? clamp(item.width, 1, 64)
        : 5,
      tool: item.tool === "highlighter" ? "highlighter" : "pen",
      ...(typeof item.opacity === "number" && Number.isFinite(item.opacity)
        ? { opacity: clamp(item.opacity, 0, 1) }
        : {}),
      ...(createdAt !== undefined ? { createdAt } : {})
    });
  }
  return result;
}
function escapeMarkdownText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\*_{}\[\]()#+!|>~-])/g, "\\$1")
    .replace(new RegExp(String.fromCharCode(96), "g"), "&#96;");
}
function quoteText(value: string): string {
  return value.split(/\r?\n/).map(line => "> " + escapeMarkdownText(line)).join("\n");
}
function timestampLabel(value?: number): string {
  if (typeof value !== "number") return "时间未知";
  try { return new Date(value).toISOString(); }
  catch { return "时间未知"; }
}
function fencedCodeBlock(value: string, language: string): string {
  const backtick = String.fromCharCode(96);
  let currentRun = 0;
  let longestRun = 0;
  for (const char of value) {
    if (char === backtick) {
      currentRun++;
      longestRun = Math.max(longestRun, currentRun);
    } else currentRun = 0;
  }
  const fence = backtick.repeat(Math.max(3, longestRun + 1));
  return fence + language + "\n" + value + "\n" + fence;
}

/**
 * Builds a bounded Markdown report of pinned PDF annotations.
 * The source PDF and Canvas are never changed.
 */
export function buildPdfAnnotationMarkdown(
  nodes: unknown,
  sourceCanvasPath = "",
  generatedAt = new Date()
): PdfAnnotationBundleSummary | null {
  if (!Array.isArray(nodes)) return null;
  const candidates = nodes.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value) || !isPinnedPdf(value)) return false;
    return (Array.isArray(value.bcPdfTextHighlights) && value.bcPdfTextHighlights.length > 0) ||
      (Array.isArray(value.bcPdfStrokes) && value.bcPdfStrokes.length > 0);
  }).map(node => ({
    node,
    page: getPageNumber(String(node.subpath || "")) ?? 0,
    file: String(node.file || ""),
    id: typeof node.id === "string" ? node.id : ""
  })).sort((left, right) =>
    left.file.localeCompare(right.file) || left.page - right.page || left.id.localeCompare(right.id)
  );

  const budget: ExportBudget = {
    truncated: candidates.length > MAX_PAGES,
    totalPoints: 0,
    totalRects: 0
  };
  const pages: ExportPage[] = [];
  for (const candidate of candidates.slice(0, MAX_PAGES)) {
    const highlights = normalizeHighlights(candidate.node.bcPdfTextHighlights, budget);
    const strokes = normalizeStrokes(candidate.node.bcPdfStrokes, budget);
    if (!highlights.length && !strokes.length) continue;
    pages.push({ id: candidate.id, file: candidate.file, page: candidate.page, highlights, strokes });
  }
  if (!pages.length) return null;

  const highlightCount = pages.reduce((sum, page) => sum + page.highlights.length, 0);
  const strokeCount = pages.reduce((sum, page) => sum + page.strokes.length, 0);
  const generatedLabel = Number.isFinite(generatedAt.getTime())
    ? generatedAt.toISOString()
    : new Date(0).toISOString();
  const lines: string[] = [
    "# PDF 批注导出", "",
    "- 来源 Canvas：" + (sourceCanvasPath ? escapeMarkdownText(sourceCanvasPath) : "未指定"),
    "- 导出时间：" + generatedLabel,
    "- 页面数：" + pages.length,
    "- 文字高亮数：" + highlightCount,
    "- 手绘笔迹数：" + strokeCount, "",
    "> 本报告不会修改源 PDF 或 Canvas。每页包含有界的归一化批注 JSON；超出导出上限的数据会被截断，完整原始数据仍以源 Canvas 为准。", ""
  ];

  for (const page of pages) {
    lines.push("## " + escapeMarkdownText(page.file) + " — 第 " + page.page + " 页", "");
    lines.push("- 来源节点 ID：" + (page.id ? escapeMarkdownText(page.id) : "未记录"), "");
    lines.push("### 文字高亮（" + page.highlights.length + "）", "");
    if (!page.highlights.length) {
      lines.push("无文字高亮。", "");
    } else {
      page.highlights.forEach((highlight, index) => {
        lines.push((index + 1) + ". 颜色 " + escapeMarkdownText(highlight.color) +
          "；区域数 " + highlight.rects.length +
          "；时间 " + timestampLabel(highlight.createdAt) +
          (highlight.textTruncated ? "；文本已截断" : ""), "");
        lines.push(highlight.text ? quoteText(highlight.text) : "> （无可用文字内容）", "");
      });
    }

    lines.push("### 手绘笔迹（" + page.strokes.length + "）", "");
    if (!page.strokes.length) {
      lines.push("无手绘笔迹。", "");
    } else {
      lines.push("| 序号 | 工具 | 颜色 | 线宽 | 点数 | 时间 |");
      lines.push("| ---: | --- | --- | ---: | ---: | --- |");
      page.strokes.forEach((stroke, index) => {
        lines.push("| " + (index + 1) + " | " + stroke.tool + " | " +
          escapeMarkdownText(stroke.color) + " | " + stroke.width + " | " +
          stroke.points.length + " | " + timestampLabel(stroke.createdAt) + " |");
      });
      lines.push("");
    }
    const json = JSON.stringify({ highlights: page.highlights, strokes: page.strokes }, null, 2);
    lines.push("### 归一化坐标数据", "", fencedCodeBlock(json, "json"), "");
  }

  if (budget.truncated) {
    lines.push("## 导出限制", "",
      "由于批注数量或坐标点数超过安全上限，本报告包含截断数据。未包含的数据仍保留在源 Canvas 中。", "");
  }

  return {
    markdown: lines.join("\n"),
    pageCount: pages.length,
    highlightCount,
    strokeCount,
    truncated: budget.truncated
  };
}
