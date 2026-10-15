export interface SvgMarkdownRunStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

export interface SvgMarkdownRun {
  text: string;
  style: SvgMarkdownRunStyle;
}

export interface SvgMarkdownLine {
  runs: SvgMarkdownRun[];
  fontScale: number;
  bold: boolean;
}

function styleKey(style: SvgMarkdownRunStyle): string {
  return [style.bold, style.italic, style.strike, style.code, style.link].map(Boolean).join(":");
}

function appendRun(runs: SvgMarkdownRun[], text: string, style: SvgMarkdownRunStyle = {}): void {
  if (!text) return;
  const previous = runs[runs.length - 1];
  if (previous && styleKey(previous.style) === styleKey(style)) {
    previous.text += text;
  } else {
    runs.push({ text, style: { ...style } });
  }
}

function fileLabel(target: string): string {
  const clean = target.trim().split("#", 1)[0].split("?", 1)[0];
  const base = clean.split("/").pop() || clean;
  return base.replace(/\.(?:md|canvas)$/i, "");
}

function labelForTarget(target: string, alias?: string): string {
  return alias?.trim() || fileLabel(target);
}

function mergeStyle(base: SvgMarkdownRunStyle, extra: SvgMarkdownRunStyle): SvgMarkdownRunStyle {
  return {
    bold: Boolean(base.bold || extra.bold),
    italic: Boolean(base.italic || extra.italic),
    strike: Boolean(base.strike || extra.strike),
    code: Boolean(base.code || extra.code),
    link: Boolean(base.link || extra.link)
  };
}

/**
 * Tokenize common inline Markdown into style-bearing text runs. This is a
 * deliberately small static renderer: HTML is treated as text, and URLs are
 * labels only (nothing is fetched or evaluated).
 */
export function parseInlineMarkdownForSvg(value: string, inherited: SvgMarkdownRunStyle = {}): SvgMarkdownRun[] {
  const result: SvgMarkdownRun[] = [];
  const pattern = /!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|!\[([^\]]*)\]\((?:<([^>]+)>|([^)]+))\)|\[([^\]]+)\]\((?:<([^>]+)>|([^)]+))\)|<((?:https?:\/\/)[^>]+)>|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\x60([^\x60]+)\x60|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    appendRun(result, value.slice(cursor, match.index), inherited);
    if (match[1] !== undefined || match[2] !== undefined) {
      const body = match[1] ?? match[2];
      const parts = body.split("|", 2);
      appendRun(result, labelForTarget(parts[0], parts[1]), inherited);
    } else if (match[3] !== undefined) {
      const target = match[4] ?? match[5] ?? "";
      appendRun(result, match[3].trim() || fileLabel(target) || "[image]", inherited);
    } else if (match[6] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[6], mergeStyle(inherited, { link: true })));
    } else if (match[9] !== undefined) {
      appendRun(result, match[9], mergeStyle(inherited, { link: true }));
    } else if (match[10] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[10], mergeStyle(inherited, { bold: true })));
    } else if (match[11] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[11], mergeStyle(inherited, { bold: true })));
    } else if (match[12] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[12], mergeStyle(inherited, { strike: true })));
    } else if (match[13] !== undefined) {
      appendRun(result, match[13], mergeStyle(inherited, { code: true }));
    } else if (match[14] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[14], mergeStyle(inherited, { italic: true })));
    } else if (match[15] !== undefined) {
      appendRuns(result, parseInlineMarkdownForSvg(match[15], mergeStyle(inherited, { italic: true })));
    }
    cursor = pattern.lastIndex;
  }
  appendRun(result, value.slice(cursor), inherited);
  return result;
}

function appendRuns(target: SvgMarkdownRun[], source: SvgMarkdownRun[]): void {
  for (const run of source) appendRun(target, run.text, run.style);
}

function wrapCodeLine(value: string, maxChars: number): SvgMarkdownRun[][] {
  if (!value) return [[]];
  const result: SvgMarkdownRun[][] = [];
  for (let offset = 0; offset < value.length; offset += maxChars) {
    result.push([{ text: value.slice(offset, offset + maxChars), style: { code: true } }]);
  }
  return result.length ? result : [[]];
}

function wrapRuns(runs: SvgMarkdownRun[], maxChars: number): SvgMarkdownRun[][] {
  const lines: SvgMarkdownRun[][] = [];
  let line: SvgMarkdownRun[] = [];
  let length = 0;
  let pendingSpace = false;

  const flush = (): void => {
    lines.push(line);
    line = [];
    length = 0;
  };

  for (const run of runs) {
    const tokens = run.text.match(/\s+|\S+/g) ?? [];
    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (line.length) pendingSpace = true;
        continue;
      }

      let remaining = token;
      while (remaining) {
        if (length > 0 && length + (pendingSpace ? 1 : 0) + remaining.length > maxChars) {
          flush();
          pendingSpace = false;
        }
        if (pendingSpace && line.length) {
          appendRun(line, " ", run.style);
          length += 1;
          pendingSpace = false;
        }
        const available = Math.max(1, maxChars - length);
        if (remaining.length <= available) {
          appendRun(line, remaining, run.style);
          length += remaining.length;
          remaining = "";
        } else if (length === 0) {
          appendRun(line, remaining.slice(0, maxChars), run.style);
          length += Math.min(maxChars, remaining.length);
          remaining = remaining.slice(maxChars);
          if (remaining) flush();
        } else {
          flush();
          pendingSpace = false;
        }
      }
    }
  }
  if (line.length || lines.length === 0) lines.push(line);
  return lines;
}

interface BlockLine {
  text: string;
  fontScale: number;
  bold: boolean;
  code: boolean;
  prefix?: string;
}

/**
 * Convert Markdown block conventions and inline markup into bounded SVG text
 * lines. Content is always returned as text/style data and must be XML-escaped
 * by the SVG writer before insertion into markup.
 */
export function layoutMarkdownForSvg(
  value: string,
  maxChars: number,
  maxLines: number,
  baseFontSize: number
): SvgMarkdownLine[] {
  if (!value) return [];
  const width = Math.max(8, Math.floor(maxChars));
  const lineLimit = Math.max(1, Math.floor(maxLines));
  const normalized = value.replace(/\r\n?/g, "\n");
  const blocks: BlockLine[] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 3;

  for (const sourceLine of normalized.split("\n")) {
    const fence = sourceLine.match(/^\s*(\x60{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      blocks.push({ text: sourceLine.replace(/[ \t]+$/g, ""), fontScale: 1, bold: false, code: true });
      continue;
    }

    let text = sourceLine;
    let fontScale = 1;
    let bold = false;
    let prefix = "";
    const heading = text.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      text = heading[2];
      fontScale = [1.5, 1.35, 1.22, 1.12, 1.06, 1.03][heading[1].length - 1];
      bold = true;
    } else {
      const quote = text.match(/^\s{0,3}>\s?(.*)$/);
      if (quote) {
        text = quote[1];
        prefix = "› ";
      } else {
        const task = text.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
        const bullet = text.match(/^(\s*)[-*+]\s+(.*)$/);
        const ordered = text.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (task) {
          const indent = " ".repeat(Math.min(12, Math.floor(task[1].length / 2) * 2));
          prefix = indent + (task[2].toLowerCase() === "x" ? "☑ " : "☐ ");
          text = task[3];
        } else if (bullet) {
          const indent = " ".repeat(Math.min(12, Math.floor(bullet[1].length / 2) * 2));
          prefix = indent + "• ";
          text = bullet[2];
        } else if (ordered) {
          const indent = " ".repeat(Math.min(12, Math.floor(ordered[1].length / 2) * 2));
          prefix = indent + ordered[2] + ". ";
          text = ordered[3];
        }
      }
    }
    blocks.push({ text: text.replace(/[ \t]+$/g, ""), fontScale, bold, code: false, prefix });
  }

  const output: SvgMarkdownLine[] = [];
  let truncated = false;
  for (const block of blocks) {
    let wrapped: SvgMarkdownRun[][];
    if (block.code) {
      wrapped = wrapCodeLine(block.text, width);
    } else {
      const runs = parseInlineMarkdownForSvg(block.text);
      if (block.prefix) runs.unshift({ text: block.prefix, style: {} });
      const lineWidth = Math.max(8, Math.floor(width / block.fontScale));
      wrapped = wrapRuns(runs, lineWidth);
    }
    for (const runs of wrapped) {
      if (output.length >= lineLimit) {
        truncated = true;
        break;
      }
      output.push({ runs, fontScale: block.fontScale, bold: block.bold });
    }
    if (truncated) break;
  }

  if (output.length === 0) return [];
  if (truncated) {
    const last = output[output.length - 1];
    const lastRun = last.runs[last.runs.length - 1];
    if (lastRun) lastRun.text = lastRun.text.replace(/\s+$/g, "") + "…";
    else last.runs.push({ text: "…", style: {} });
  }
  return output;
}
