import type { CanvasData, CanvasEdgeData, CanvasNodeData } from "./canvas";

export interface FullCanvasSvg {
  svg: string;
  width: number;
  height: number;
}

export interface FullCanvasSvgOptions {
  backgroundColor?: string;
  margin?: number;
}

function number(value: unknown, fallback = 0): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const canvasPalette: Record<string, string> = {
  "1": "#e64b55",
  "2": "#e88931",
  "3": "#d8bd36",
  "4": "#43a875",
  "5": "#38a9b6",
  "6": "#8f70ce"
};

function nodeColor(node: CanvasNodeData): string {
  const raw = String(node.color ?? "");
  if (canvasPalette[raw]) return canvasPalette[raw];
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  return "none";
}

function edgeColor(edge: CanvasEdgeData): string {
  const raw = String(edge.color ?? "");
  if (canvasPalette[raw]) return canvasPalette[raw];
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : "#7b8794";
}

function nodeText(node: CanvasNodeData): string {
  if (typeof node.text === "string" && node.text.trim()) return node.text;
  if (typeof node.file === "string") return node.file + (typeof (node as any).subpath === "string" ? String((node as any).subpath) : "");
  if (typeof node.url === "string") return node.url;
  return node.type === "group" ? "" : "[" + node.type + " node]";
}

function wrapLines(value: string, maxChars: number, maxLines: number): string[] {
  const result: string[] = [];
  const paragraphs = value.replace(/\r/g, "").split("\n");
  let truncated = false;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex++) {
    let remaining = paragraphs[paragraphIndex];
    if (!remaining) {
      if (result.length >= maxLines) {
        truncated = true;
        break;
      }
      result.push("");
      continue;
    }

    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(" ", maxChars);
      if (breakAt < Math.floor(maxChars * 0.55)) breakAt = maxChars;
      result.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
      if (result.length >= maxLines) {
        truncated = Boolean(remaining) || paragraphIndex < paragraphs.length - 1;
        break;
      }
    }
    if (truncated) break;

    if (remaining && result.length < maxLines) result.push(remaining);
    else if (remaining) {
      truncated = true;
      break;
    }

    if (result.length >= maxLines && paragraphIndex < paragraphs.length - 1) {
      truncated = true;
      break;
    }
  }

  if (result.length === 0) result.push("");
  if (truncated) {
    const index = result.length - 1;
    result[index] = (result[index].length >= maxChars
      ? result[index].slice(0, Math.max(0, maxChars - 1))
      : result[index]) + "…";
  }
  return result;
}

function sidePoint(node: CanvasNodeData, side: string, from = false): { x: number; y: number } {
  switch (side) {
    case "left": return { x: node.x, y: node.y + node.height / 2 };
    case "right": return { x: node.x + node.width, y: node.y + node.height / 2 };
    case "top": return { x: node.x + node.width / 2, y: node.y };
    case "bottom": return { x: node.x + node.width / 2, y: node.y + node.height };
    default: return { x: node.x + node.width / 2, y: node.y + (from ? node.height : 0) };
  }
}

function edgeSides(from: CanvasNodeData, to: CanvasNodeData): [string, string] {
  const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
  const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function arrowStyleFor(edge: CanvasEdgeData): string {
  const attrs = (edge as any).styleAttributes ?? {};
  const raw = String((edge as any).bcArrowStyle ?? attrs.arrow ?? "default");
  if (raw === "triangle") return "default";
  if (raw === "halved-triangle") return "half-triangle";
  return [
    "default", "triangle-outline", "half-triangle", "thin-triangle",
    "diamond", "diamond-outline", "circle", "circle-outline", "blunt", "none"
  ].includes(raw) ? raw : "default";
}

function arrowMarker(id: string, style: string, color: string): string {
  let path = "M1 1 L11 6 L1 11 Z";
  let fill = color;
  let stroke = color;
  let strokeWidth = 1;
  if (style === "triangle-outline") {
    fill = "none";
    strokeWidth = 1.4;
  } else if (style === "half-triangle") {
    path = "M1 1 L11 6 L1 11 Z M1 1 L1 11";
    strokeWidth = 1.2;
  } else if (style === "thin-triangle") {
    path = "M1 1 L11 6 L1 11";
    fill = "none";
    strokeWidth = 1.5;
  } else if (style === "diamond" || style === "diamond-outline") {
    path = "M1 6 L6 1 L11 6 L6 11 Z";
    if (style === "diamond-outline") fill = "none";
  } else if (style === "circle" || style === "circle-outline") {
    const circle = '<circle cx="6" cy="6" r="4.3" fill="' +
      (style === "circle-outline" ? "none" : xml(color)) + '" stroke="' + xml(color) +
      '" stroke-width="' + (style === "circle-outline" ? "1.4" : "1") + '"/>';
    return '<marker id="' + xml(id) +
      '" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" viewBox="0 0 12 12" refX="10" refY="6" orient="auto-start-reverse">' +
      circle + "</marker>";
  } else if (style === "blunt") {
    path = "M8 1 L8 11";
    fill = "none";
    strokeWidth = 2;
  }
  return '<marker id="' + xml(id) +
    '" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" viewBox="0 0 12 12" refX="10" refY="6" orient="auto-start-reverse">' +
    '<path d="' + path + '" fill="' + fill + '" stroke="' + xml(stroke) +
    '" stroke-width="' + strokeWidth + '" stroke-linejoin="round" stroke-linecap="round"/></marker>';
}

function renderEdge(edge: CanvasEdgeData, nodes: Map<string, CanvasNodeData>, index: number): string {
  const from = nodes.get(edge.fromNode);
  const to = nodes.get(edge.toNode);
  if (!from || !to) return "";
  const sides = edgeSides(from, to);
  const start = sidePoint(from, String(edge.fromSide || sides[0]), true);
  const end = sidePoint(to, String(edge.toSide || sides[1]), false);
  const attrs = (edge as any).styleAttributes ?? {};
  const style = String(attrs.lineStyle ?? (edge as any).style ?? "");
  const dash = style.includes("dot") ? "2 5" : style.includes("dash") ? "8 5" : "";
  const rawArrowStyle = (edge as any).bcArrowStyle ?? attrs.arrow;
  const arrowStyle = arrowStyleFor(edge);
  const noArrows = String(rawArrowStyle ?? "").toLowerCase() === "none";
  const fromEnd = String((edge as any).fromEnd ?? attrs.startArrowhead ?? "");
  const toEnd = String((edge as any).toEnd ?? attrs.endArrowhead ?? "");
  const startVisible = !noArrows && (fromEnd
    ? fromEnd !== "none" && fromEnd !== "null"
    : Boolean(rawArrowStyle));
  const endVisible = !noArrows && (toEnd
    ? toEnd !== "none" && toEnd !== "null"
    : true);
  const color = edgeColor(edge);
  const markers: string[] = [];
  const markerAttrs: string[] = [];
  if (startVisible && arrowStyle !== "none") {
    const id = "bc-arrow-" + index + "-start";
    markers.push(arrowMarker(id, arrowStyle, color));
    markerAttrs.push(' marker-start="url(#' + id + ')"');
  }
  if (endVisible && arrowStyle !== "none") {
    const id = "bc-arrow-" + index + "-end";
    markers.push(arrowMarker(id, arrowStyle, color));
    markerAttrs.push(' marker-end="url(#' + id + ')"');
  }
  const d = "M " + start.x + " " + start.y + " L " + end.x + " " + end.y;
  return (markers.length ? "<defs>" + markers.join("") + "</defs>" : "") +
    '<path id="bc-edge-' + index + '" d="' + xml(d) + '" fill="none" stroke="' + xml(color) +
    '" stroke-width="2" stroke-linecap="round"' +
    (dash ? ' stroke-dasharray="' + dash + '"' : "") + markerAttrs.join("") + "/>";
}

function polygonPoints(x: number, y: number, w: number, h: number, sides: number, rotate = -Math.PI / 2): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const points: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i * Math.PI * 2) / sides;
    points.push((cx + Math.cos(a) * w * 0.46) + "," + (cy + Math.sin(a) * h * 0.46));
  }
  return points.join(" ");
}

function wrapNodeText(node: CanvasNodeData, clipId: string): string {
  const raw = nodeText(node);
  if (!raw) return "";
  const attrs = (node as any).styleAttributes ?? {};
  const fontSize = Math.max(10, Math.min(28, number(attrs.fontSize, 16)));
  const alignRaw = String(attrs.textAlign ?? attrs.textAlignment ?? "left");
  const anchor = alignRaw === "center" ? "middle" : alignRaw === "right" ? "end" : "start";
  const startX = anchor === "middle" ? node.x + node.width / 2 : anchor === "end" ? node.x + node.width - 12 : node.x + 12;
  const maxChars = Math.max(8, Math.floor((node.width - 24) / (fontSize * 0.58)));
  const maxLines = Math.max(1, Math.min(80, Math.floor((node.height - 26) / (fontSize * 1.35))));
  const lines = wrapLines(raw, maxChars, maxLines);
  const startY = node.y + 18 + fontSize;
  return '<text clip-path="url(#' + clipId + ')" x="' + startX + '" y="' + startY +
    '" font-family="Inter,Arial,sans-serif" font-size="' + fontSize + '" fill="' + xml(attrs.textColor ?? "#202124") +
    '" text-anchor="' + anchor + '">' +
    lines.map((line, index) => '<tspan x="' + startX + '" dy="' + (index === 0 ? 0 : fontSize * 1.35) + '">' + xml(line) + "</tspan>").join("") +
    "</text>";
}

function renderNode(node: CanvasNodeData, index: number): string {
  const x = number(node.x), y = number(node.y);
  const width = Math.max(1, number(node.width, 280)), height = Math.max(1, number(node.height, 140));
  const attrs = (node as any).styleAttributes ?? {};
  const shape = String(attrs.shape ?? (node as any).shape ?? "rectangle").toLowerCase();
  const fill = nodeColor(node);
  const border = String(attrs.borderColor ?? "#858b93");
  const borderStyle = String(attrs.borderStyle ?? "");
  const dash = borderStyle.includes("dash") ? ' stroke-dasharray="8 5"' : borderStyle.includes("dot") ? ' stroke-dasharray="2 5"' : "";
  const stroke = borderStyle === "invisible" ? "none" : border;
  const clipId = "bc-clip-" + index;
  const clip = "";

  let geometry: string;
  if (node.type === "group") {
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="4" fill="' + (fill === "none" ? "#9aa3ad" : fill) + '" fill-opacity="0.10" stroke="' + stroke +
      '" stroke-width="1.6"' + dash + "/>";
  } else if (shape.includes("ellipse") || shape.includes("circle") || shape.includes("terminal")) {
    geometry = '<ellipse cx="' + (x + width / 2) + '" cy="' + (y + height / 2) + '" rx="' + width / 2 +
      '" ry="' + height / 2 + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
  } else if (shape.includes("diamond") || shape.includes("decision")) {
    geometry = '<polygon points="' + polygonPoints(x, y, width, height, 4, 0) + '" fill="' + fill +
      '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
  } else if (shape.includes("hexagon")) {
    geometry = '<polygon points="' + polygonPoints(x, y, width, height, 6) + '" fill="' + fill +
      '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
  } else if (shape.includes("parallelogram") || shape.includes("input")) {
    const inset = Math.min(24, width * 0.16);
    geometry = '<polygon points="' + (x + inset) + "," + y + " " + (x + width) + "," + y + " " +
      (x + width - inset) + "," + (y + height) + " " + x + "," + (y + height) +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
  } else {
    const radius = shape.includes("round") ? 22 : 7;
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"' + dash + "/>";
  }

  const text = wrapNodeText(node, clipId);
  const clipPath = '<clipPath id="' + clipId + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="5"/></clipPath>';
  const imageDataUrl = typeof (node as any).bcExportImageDataUrl === "string"
    ? String((node as any).bcExportImageDataUrl)
    : "";
  const imageMarkup = imageDataUrl.startsWith("data:image/") && node.type === "file"
    ? '<image x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + Math.max(1, width - 12) +
      '" height="' + Math.max(1, height - 30) + '" href="' + xml(imageDataUrl) +
      '" preserveAspectRatio="xMidYMid meet" clip-path="url(#' + clipId + ')"/>'
    : "";
  const displayedText = imageMarkup && typeof node.file === "string"
    ? '<text x="' + (x + 8) + '" y="' + (y + height - 8) + '" font-family="Inter,Arial,sans-serif" font-size="11" fill="#5b6470">' +
      xml(node.file.split("/").pop() ?? node.file) + "</text>"
    : text;
  return clipPath + '<g class="bc-full-node">' + geometry + imageMarkup + displayedText + "</g>";
}

/**
 * Serialize Canvas JSON into an SVG sized to the union of all nodes. This is
 * a static export and intentionally does not depend on the current viewport.
 * Media files are represented by labels unless the caller attaches a bounded raster preview data URL; live HTML is never evaluated.
 */
export function canvasDataToFullSvg(data: CanvasData, options: FullCanvasSvgOptions = {}): FullCanvasSvg {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const margin = Math.max(0, Math.min(300, number(options.margin, 48)));
  const minX = nodes.length ? Math.min(...nodes.map(node => number(node.x))) : 0;
  const minY = nodes.length ? Math.min(...nodes.map(node => number(node.y))) : 0;
  const maxX = nodes.length ? Math.max(...nodes.map(node => number(node.x) + number(node.width, 280))) : 800;
  const maxY = nodes.length ? Math.max(...nodes.map(node => number(node.y) + number(node.height, 140))) : 600;
  const width = Math.max(1, Math.ceil(maxX - minX + margin * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + margin * 2));
  if (width > 50_000 || height > 50_000 || width * height > 500_000_000) {
    throw new Error("Canvas 内容边界过大，无法安全导出；请先缩小或拆分画布。");
  }

  const translatedNodes = nodes.map(node => ({ ...node, x: number(node.x) - minX + margin, y: number(node.y) - minY + margin }));
  const translatedById = new Map(translatedNodes.map(node => [node.id, node]));
  const translatedEdges = edges.map(edge => {
    const fromInfo = translatedById.get(edge.fromNode);
    const toInfo = translatedById.get(edge.toNode);
    return { ...edge, fromNode: fromInfo?.id ?? edge.fromNode, toNode: toInfo?.id ?? edge.toNode };
  });

  const defs = '<defs><marker id="bc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7b8794"/></marker></defs>';
  const background = options.backgroundColor
    ? '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + xml(options.backgroundColor) + '"/>'
    : "";
  const nodeMap = new Map(translatedNodes.map(node => [node.id, node]));
  const edgeMarkup = translatedEdges.map((edge, index) => renderEdge(edge, nodeMap, index)).join("");
  const nodeMarkup = translatedNodes.map((node, index) => renderNode(node, index)).join("");

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + " " + height + '">' +
    defs + background + edgeMarkup + nodeMarkup + "</svg>";
  return { svg, width, height };
}
