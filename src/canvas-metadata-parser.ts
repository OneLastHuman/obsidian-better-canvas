export interface CanvasMarkdownLoc {
  line: number;
  col: number;
  offset: number;
}

export interface CanvasMarkdownPosition {
  start: CanvasMarkdownLoc;
  end: CanvasMarkdownLoc;
}

export interface CanvasMarkdownReference {
  link: string;
  original: string;
  displayText?: string;
  position: CanvasMarkdownPosition;
  [key: string]: unknown;
}

export interface CanvasMarkdownMetadata {
  links: CanvasMarkdownReference[];
  embeds: CanvasMarkdownReference[];
  tags: Array<{ tag: string; position: CanvasMarkdownPosition; [key: string]: unknown }>;
  headings: Array<{ heading: string; level: number; position: CanvasMarkdownPosition; [key: string]: unknown }>;
  sections: Array<{ type: string; position: CanvasMarkdownPosition; [key: string]: unknown }>;
  listItems: Array<{ parent: number; task?: string; position: CanvasMarkdownPosition; [key: string]: unknown }>;
  footnotes: unknown[];
  footnoteRefs: unknown[];
  referenceLinks: unknown[];
  blocks: Record<string, unknown>;
}

interface SourceLine {
  text: string;
  start: number;
  end: number;
  number: number;
  fenced: boolean;
}

function sourceLines(text: string): SourceLine[] {
  const rawLines = text.split("\n");
  const lines: SourceLine[] = [];
  let offset = 0;
  let fenceChar = "";
  let fenceLength = 0;
  let inFence = false;

  rawLines.forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const start = offset;
    const end = start + line.length;
    const fence = line.match(/^\s*(\x60{3,}|~{3,})/);
    const isFence = Boolean(fence);
    const insideFence = inFence || isFence;

    lines.push({ text: line, start, end, number: index, fenced: insideFence });

    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false;
        fenceChar = "";
        fenceLength = 0;
      }
    }
    offset += raw.length + (index < rawLines.length - 1 ? 1 : 0);
  });
  return lines;
}

function locationAt(offset: number, lines: SourceLine[]): CanvasMarkdownLoc {
  let low = 0;
  let high = lines.length - 1;
  let selected = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].start <= offset) {
      selected = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const line = lines[selected];
  return { line: line.number, col: Math.max(0, offset - line.start), offset };
}

function positionBetween(start: number, end: number, lines: SourceLine[]): CanvasMarkdownPosition {
  return { start: locationAt(start, lines), end: locationAt(end, lines) };
}

function maskInlineCode(line: string): string {
  return line.replace(/(\x60+)(.*?)\1/g, matched => " ".repeat(matched.length));
}

function cleanLabel(value: string): string {
  return value
    .replace(/!?\[\[([^\]]+)\]\]/g, (_all, body: string) => {
      const parts = body.split("|", 2);
      return (parts[1] ?? parts[0]).split("#", 1)[0].replace(/\.(?:md|canvas)$/i, "").trim();
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/[*_]/g, "")
    .trim();
}

function classifyLine(line: string): string {
  if (/^\s{0,3}#{1,6}\s+/.test(line)) return "heading";
  if (/^\s{0,3}>/.test(line)) return "blockquote";
  if (/^\s*([-*_]\s*){3,}$/.test(line)) return "thematicBreak";
  if (/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) return "list";
  if (/^\s*\|.*\|\s*$/.test(line)) return "table";
  if (/^\s*<[^>]+>/.test(line)) return "html";
  if (/^\s*\[\^[^\]]+\]:/.test(line)) return "footnoteDefinition";
  return "paragraph";
}

/**
 * Parse the common Markdown constructs used inside Canvas text nodes.
 * Offsets are local to each node's text; the metadata indexer adds node IDs
 * when promoting these references to the Canvas-level cache.
 */
export function parseCanvasMarkdownMetadata(text: string): CanvasMarkdownMetadata {
  const lines = sourceLines(typeof text === "string" ? text : "");
  const metadata: CanvasMarkdownMetadata = {
    links: [],
    embeds: [],
    tags: [],
    headings: [],
    sections: [],
    listItems: [],
    footnotes: [],
    footnoteRefs: [],
    referenceLinks: [],
    blocks: {}
  };

  const listRootByLine = new Map<number, number>();
  const parentStack: Array<{ line: number; indent: number; root: number }> = [];
  let currentListRoot = -1;
  let previousLineWasList = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const source = line.text;
    if (line.fenced) {
      previousLineWasList = false;
      continue;
    }

    const heading = source.match(/^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
    if (heading) {
      const start = line.start + source.indexOf(heading[1]);
      metadata.headings.push({
        heading: cleanLabel(heading[2]),
        level: heading[1].length,
        position: positionBetween(start, line.end, lines)
      });
    }

    const visible = maskInlineCode(source);
    const tagPattern = /(^|[\s([{>,])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagPattern.exec(visible)) !== null) {
      const tagStart = line.start + tagMatch.index + tagMatch[1].length;
      const tagEnd = tagStart + tagMatch[2].length + 1;
      metadata.tags.push({
        tag: "#" + tagMatch[2],
        position: positionBetween(tagStart, tagEnd, lines)
      });
    }

    const referencePattern = /!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+['"][^'"]*['"])?\s*\)|\[([^\]]+)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+['"][^'"]*['"])?\s*\)|<(https?:\/\/[^>]+)>/gi;
    let reference: RegExpExecArray | null;
    while ((reference = referencePattern.exec(visible)) !== null) {
      const start = line.start + reference.index;
      const end = start + reference[0].length;
      const wikiEmbed = reference[1] !== undefined;
      const wikiLink = reference[2] !== undefined;
      const markdownEmbed = reference[3] !== undefined;
      const markdownLink = reference[5] !== undefined;
      const wikiBody = reference[1] ?? reference[2];
      const wikiParts = wikiBody?.split("|", 2);
      const destination = wikiBody !== undefined
        ? wikiParts![0].trim()
        : (reference[4] ?? reference[6] ?? reference[7] ?? "").replace(/^<|>$/g, "").trim();
      const display = wikiBody !== undefined
        ? (wikiParts![1] ?? wikiParts![0].split("#", 1)[0]).trim()
        : markdownEmbed
          ? reference[3]!.trim()
          : markdownLink
            ? reference[5]!.trim()
            : destination;
      if (!destination) continue;
      const record: CanvasMarkdownReference = {
        link: destination,
        original: reference[0],
        displayText: display,
        position: positionBetween(start, end, lines)
      };
      if (wikiEmbed || markdownEmbed) metadata.embeds.push(record);
      else if (wikiLink || markdownLink || reference[7] !== undefined) metadata.links.push(record);
    }

    const footnoteDefinition = source.match(/^\s{0,3}\[\^([^\]]+)\]:/);
    if (footnoteDefinition) {
      const start = line.start + source.indexOf("[^");
      metadata.footnotes.push({
        id: footnoteDefinition[1],
        position: positionBetween(start, line.end, lines)
      });
    }
    const footnoteRefs = /\[\^([^\]]+)\]/g;
    let footnoteRef: RegExpExecArray | null;
    while ((footnoteRef = footnoteRefs.exec(visible)) !== null) {
      if (/^\s{0,3}\[\^/.test(source) && footnoteRef.index === source.indexOf("[^")) continue;
      const start = line.start + footnoteRef.index;
      metadata.footnoteRefs.push({
        id: footnoteRef[1],
        position: positionBetween(start, start + footnoteRef[0].length, lines)
      });
    }

    const listItem = source.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (!listItem) {
      previousLineWasList = false;
      parentStack.length = 0;
      currentListRoot = -1;
      continue;
    }
    const indent = listItem[1].replace(/\t/g, "    ").length;
    const lineNumber = line.number;
    while (parentStack.length && parentStack[parentStack.length - 1].indent >= indent) parentStack.pop();
    const parent = parentStack.length ? parentStack[parentStack.length - 1].line : -(currentListRoot >= 0 && previousLineWasList ? currentListRoot : lineNumber);
    if (!previousLineWasList || parentStack.length === 0 && indent === 0) {
      if (!previousLineWasList || currentListRoot < 0) currentListRoot = lineNumber;
    }
    listRootByLine.set(lineNumber, currentListRoot);
    metadata.listItems.push({
      parent: parentStack.length ? parent : -currentListRoot,
      ...(listItem[3] !== undefined ? { task: listItem[3] } : {}),
      position: positionBetween(line.start, line.end, lines)
    });
    parentStack.push({ line: lineNumber, indent, root: currentListRoot });
    previousLineWasList = true;
  }

  // Group adjacent non-blank lines into root-level sections. Fenced code blocks
  // remain a single section even if their contents contain Markdown syntax.
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.text.trim()) {
      index += 1;
      continue;
    }
    if (/^\s*(?:\x60{3,}|~{3,})/.test(line.text)) {
      const start = line.start;
      let end = line.end;
      index += 1;
      while (index < lines.length) {
        end = lines[index].end;
        const closes = /^\s*(?:\x60{3,}|~{3,})/.test(lines[index].text) && !lines[index].fenced;
        index += 1;
        if (closes) break;
      }
      metadata.sections.push({ type: "code", position: positionBetween(start, end, lines) });
      continue;
    }
    if (line.fenced) {
      index += 1;
      continue;
    }
    const type = classifyLine(line.text);
    const start = line.start;
    let end = line.end;
    index += 1;
    while (index < lines.length && lines[index].text.trim() && !lines[index].fenced &&
      classifyLine(lines[index].text) === type) {
      end = lines[index].end;
      index += 1;
    }
    metadata.sections.push({ type, position: positionBetween(start, end, lines) });
  }

  return metadata;
}
