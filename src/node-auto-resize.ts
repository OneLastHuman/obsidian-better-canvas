export type TextMeasure = (text: string) => number;

export interface AutoResizeLayout {
  width: number;
  height: number;
  lines: number;
  alignment: "center" | "left";
}

/**
 * Final product values for content-aware text-node layout.
 *
 * The outer width is the measured text width plus 48 pixels. Those 48 pixels
 * cover 16px horizontal padding on both sides, the node border and the space
 * Obsidian reserves for its scrollbar gutter. The remaining two pixels keep a
 * full final character from being pushed onto the next line by rounding.
 */
export const AUTO_RESIZE_LAYOUT = Object.freeze({
  minWidth: 80,
  maxWidth: 440,
  minHeight: 44,
  maxHeight: 560,
  fontSize: 16,
  lineHeight: 24,
  widthOverhead: 48,
  wrapOverhead: 46,
  heightPadding: 20
});

const MEASURE_FONT_FALLBACK = '16px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const measurerCache = new Map<string, TextMeasure>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isWideCharacter(char: string): boolean {
  return /[\u1100-\u11ff\u2e80-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff00-\uffef]/.test(char);
}

/**
 * Estimate a plain-text width when the DOM/canvas measuring surface is not
 * available (for example in unit tests). The runtime path measures with the
 * actual node font through a canvas context.
 */
export function estimateTextWidth(text: string, fontSize = AUTO_RESIZE_LAYOUT.fontSize): number {
  let width = 0;
  for (const char of Array.from(text)) {
    if (/\s/.test(char)) width += fontSize * 0.25;
    else if (isWideCharacter(char)) width += fontSize;
    else if (/[A-Z]/.test(char)) width += fontSize * 0.62;
    else if (/[a-z0-9]/.test(char)) width += fontSize * 0.55;
    else width += fontSize * 0.45;
  }
  return width;
}

/**
 * Create a reusable text measurer from a CSS font shorthand. Returns null when
 * no canvas context is available, so callers can fall back to estimation.
 */
export function createCanvasTextMeasurer(font = MEASURE_FONT_FALLBACK): TextMeasure | null {
  const cached = measurerCache.get(font);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.font = font;
    const measure: TextMeasure = text => context.measureText(text).width;
    measurerCache.set(font, measure);
    return measure;
  } catch {
    return null;
  }
}

function tokenize(text: string): string[] {
  const units: string[] = [];
  let word = "";
  const flush = (): void => {
    if (word) {
      units.push(word);
      word = "";
    }
  };

  for (const char of Array.from(text)) {
    if (/\s/.test(char)) {
      flush();
      units.push(" ");
    } else if (/[A-Za-z0-9_'’-]/.test(char)) {
      word += char;
    } else {
      flush();
      units.push(char);
    }
  }
  flush();
  return units;
}

/**
 * Greedy line wrapping with word awareness for Latin text and per-character
 * wrapping for CJK text. A single oversized word is split by characters.
 */
export function wrapTextToWidth(text: string, maxWidth: number, measure: TextMeasure): string[] {
  const limit = Math.max(1, maxWidth);
  const lines: string[] = [];

  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const unit of tokenize(paragraph)) {
      if (line && measure(line + unit) > limit) {
        lines.push(line.trimEnd());
        line = unit.trimStart();
        if (!line) continue;
      } else {
        line += unit;
      }

      if (line && measure(line) > limit) {
        const characters = Array.from(line);
        if (characters.length > 1) {
          let chunk = "";
          for (const char of characters) {
            if (chunk && measure(chunk + char) > limit) {
              lines.push(chunk);
              chunk = char;
            } else {
              chunk += char;
            }
          }
          line = chunk;
        }
      }
    }

    if (line || lines.length === 0) lines.push(line.trimEnd());
  }

  return lines;
}

/**
 * Calculate the final outer box and alignment for a text node.
 *
 * - Width: text width + 48, clamped to 80..440.
 * - Height: line count × 24 + 20, clamped to 44..560.
 * - Alignment: one line is centered; two or more lines are left-aligned.
 *
 * Empty or whitespace-only text returns null so blank cards keep the size they
 * were created with.
 */
export function calculateTextNodeLayout(
  text: string,
  measure: TextMeasure = estimateTextWidth
): AutoResizeLayout | null {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return null;

  const paragraphs = normalized.split("\n");
  let widest = 0;
  for (const paragraph of paragraphs) {
    widest = Math.max(widest, measure(paragraph));
  }

  const width = clamp(
    Math.ceil(widest) + AUTO_RESIZE_LAYOUT.widthOverhead,
    AUTO_RESIZE_LAYOUT.minWidth,
    AUTO_RESIZE_LAYOUT.maxWidth
  );
  const innerWidth = Math.max(1, width - AUTO_RESIZE_LAYOUT.wrapOverhead);
  const lines = wrapTextToWidth(normalized, innerWidth, measure).length;
  const height = clamp(
    Math.round(lines * AUTO_RESIZE_LAYOUT.lineHeight + AUTO_RESIZE_LAYOUT.heightPadding),
    AUTO_RESIZE_LAYOUT.minHeight,
    AUTO_RESIZE_LAYOUT.maxHeight
  );

  return {
    width,
    height,
    lines,
    alignment: lines <= 1 ? "center" : "left"
  };
}
