import type { CanvasData, CanvasEdgeData, CanvasNodeData } from "./canvas";
import { routePointsForMethod, type CanvasEdgeRouteMethod, type RouteBox } from "./enhancements";
import { layoutMarkdownForSvg, type SvgMarkdownRun } from "./svg-markdown";
import { SKETCH_FONT_CSS } from "./sketch-font";
import { renderSketchNodeSvg, SKETCH_EDGE_FILTER_ID } from "./sketch-renderer";
import { resolveSketchStyle } from "./sketch-style";
import { researchColor, researchFill, researchPreset, RESEARCH_SERIF } from "./research-style";
import { resolveCanvasNodeBorder, resolveCanvasNodeShape, type CanvasNodeStyleSource } from "./canvas-node-style";
import { roundedMapInsets, roundedMapPath, ROUNDED_MAP_INK, ROUNDED_MAP_PAPER, ROUNDED_MAP_STROKE } from "./rounded-map-style";

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

function safeSvgColor(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  if (/^(?:rgb|rgba|hsl|hsla)\([\d.\s,%+/-]+\)$/i.test(raw)) return raw;
  if (/^[a-z]{1,32}$/i.test(raw)) return raw;
  return fallback;
}

function nodeColor(node: CanvasNodeData): string {
  const attrs = (node as any).styleAttributes ?? {};
  const stored = node.color !== undefined && node.color !== null && node.color !== ""
    ? node.color
    : attrs.fillColor ?? attrs.backgroundColor;
  const raw = String(stored ?? "");
  if (canvasPalette[raw]) return canvasPalette[raw];
  return safeSvgColor(raw, "none");
}

function edgeColor(edge: CanvasEdgeData): string {
  const attrs = (edge as any).styleAttributes ?? {};
  const stored = edge.color !== undefined && edge.color !== null && edge.color !== ""
    ? edge.color
    : attrs.strokeColor ?? attrs.color;
  const raw = String(stored ?? "");
  if (canvasPalette[raw]) return canvasPalette[raw];
  return safeSvgColor(raw, "#7b8794");
}

function nodeText(node: CanvasNodeData): string {
  if (typeof node.text === "string" && node.text.trim()) return node.text;
  if (typeof node.file === "string") return node.file + (typeof (node as any).subpath === "string" ? String((node as any).subpath) : "");
  if (typeof node.url === "string") return node.url;
  return node.type === "group" ? "" : "[" + node.type + " node]";
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

function renderEdge(edge: CanvasEdgeData, nodes: Map<string, CanvasNodeData>, index: number, sketch = false, rounded = false, margin = 48): string {
  const from = nodes.get(edge.fromNode);
  const to = nodes.get(edge.toNode);
  if (!from || !to) return "";
  const sides = edgeSides(from, to);
  const start = sidePoint(from, String(edge.fromSide || sides[0]), true);
  const end = sidePoint(to, String(edge.toSide || sides[1]), false);
  const attrs = (edge as any).styleAttributes ?? {};
  const style = String(attrs.lineStyle ?? attrs.path ?? (edge as any).bcPathStyle ?? (edge as any).style ?? "");
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
  const color = rounded && !edge.color && !edge.bcColor && !attrs.strokeColor && !attrs.color
    ? ROUNDED_MAP_INK : edgeColor(rounded && !edge.color && edge.bcColor ? { ...edge, color: edge.bcColor } : edge);
  const lineWidth = Math.max(0.5, Math.min(10, number(attrs.strokeWidth ?? attrs.lineWidth ?? (edge as any).bcWidth, rounded ? 3 : 2)));
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
  const routeMethod = attrs.pathfindingMethod ?? (edge as any).bcPathfindingMethod;
  const routePoints = ["direct", "square", "a-star"].includes(String(routeMethod))
    ? routePointsForMethod(
        String(routeMethod) as CanvasEdgeRouteMethod,
        start,
        end,
        String(edge.fromSide || sides[0]),
        String(edge.toSide || sides[1]),
        routeMethod === "a-star"
          ? [...nodes.values()]
              .filter(node => node.id !== edge.fromNode && node.id !== edge.toNode && node.type !== "group")
              .map(node => ({
                minX: number(node.x),
                minY: number(node.y),
                maxX: number(node.x) + number(node.width, 280),
                maxY: number(node.y) + number(node.height, 140)
              } satisfies RouteBox))
          : []
      )
    : [start, end];
  let d = routePoints.map((point, pointIndex) =>
    (pointIndex === 0 ? "M " : "L ") + point.x.toFixed(2) + " " + point.y.toFixed(2)
  ).join(" ");
  let labelPoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (rounded && !routeMethod) {
    const fromSide = String(edge.fromSide || sides[0]), toSide = String(edge.toSide || sides[1]);
    const distance = fromSide === toSide ? Math.max(0, Math.min(80, margin * .8))
      : Math.min(140, Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 3));
    const control = (point: { x: number; y: number }, side: string) => ({
      x: point.x + (side === "left" ? -distance : side === "right" ? distance : 0),
      y: point.y + (side === "top" ? -distance : side === "bottom" ? distance : 0)
    });
    const c1 = control(start, fromSide), c2 = control(end, toSide);
    d = `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
    labelPoint = { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 };
  } else if (rounded && routePoints.length > 2) {
    const lengths = routePoints.slice(1).map((p, i) => Math.hypot(p.x - routePoints[i].x, p.y - routePoints[i].y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]) {
        const t = lengths[i] ? remaining / lengths[i] : 0;
        labelPoint = { x: routePoints[i].x + (routePoints[i + 1].x - routePoints[i].x) * t,
          y: routePoints[i].y + (routePoints[i + 1].y - routePoints[i].y) * t };
        break;
      }
      remaining -= lengths[i];
    }
  }
  const label = rounded && typeof edge.label === "string" && edge.label.trim()
    ? `<text x="${labelPoint.x}" y="${labelPoint.y}" dy=".35em" text-anchor="middle" font-size="14" font-family="sans-serif" fill="${xml(color)}" stroke="${ROUNDED_MAP_PAPER}" stroke-width="6" stroke-linejoin="round" paint-order="stroke fill">${xml(edge.label.slice(0, 512).replace(/\r?\n/g, " "))}</text>` : "";
  return (markers.length ? "<defs>" + markers.join("") + "</defs>" : "") +
    '<path id="bc-edge-' + index + '" d="' + xml(d) + '" fill="none" stroke="' + xml(color) +
    '" stroke-width="' + lineWidth + '" stroke-linecap="round"' +
    (sketch ? ' filter="url(#' + SKETCH_EDGE_FILTER_ID + ')"' : "") +
    (dash ? ' stroke-dasharray="' + dash + '"' : "") + markerAttrs.join("") + "/>" + label;
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

function wrapNodeText(node: CanvasNodeData, clipId: string, sketch = false, research = false): string {
  const hasMarkdownText = typeof node.text === "string" && node.text.trim().length > 0;
  const raw = research && node.type === "text" ? String(node.text ?? "") : hasMarkdownText ? String(node.text) : nodeText(node);
  if (!raw) return "";
  const attrs = (node as any).styleAttributes ?? {};
  const sketchStyle = sketch ? resolveSketchStyle(node) : null;
  const fontSize = sketchStyle
    ? sketchStyle.fontSize
    : Math.max(10, Math.min(28, number(attrs.fontSize, 16)));
  const alignRaw = sketchStyle?.align ?? String(attrs.textAlign ?? attrs.textAlignment ?? (node as any).bcTextAlign ?? "left");
  const anchor = alignRaw === "center" ? "middle" : alignRaw === "right" ? "end" : "start";
  const startX = anchor === "middle" ? node.x + node.width / 2 : anchor === "end" ? node.x + node.width - 12 : node.x + 12;
  const fontFamily = sketch
    ? "BC Sketch Hand, Segoe Print, cursive"
    : xml(String(attrs.fontFamily ?? attrs.font ?? (research ? RESEARCH_SERIF : "Inter,Arial,sans-serif")));
  const rawWeight = String(attrs.fontWeight ?? "normal");
  const resolvedWeight = /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(rawWeight) ? rawWeight : "normal";
  const fontWeight = sketch && resolvedWeight === "normal" ? "600" : resolvedWeight;
  const rawFontStyle = String(attrs.fontStyle ?? "normal");
  const fontStyle = /^(?:normal|italic|oblique)$/i.test(rawFontStyle) ? rawFontStyle : "normal";
  const rawDecoration = String(attrs.textDecoration ?? "none");
  const textDecoration = /^(?:none|underline|overline|line-through)$/i.test(rawDecoration) ? rawDecoration : "none";
  const textColor = sketch
    ? sketchStyle?.preset?.id === "annotation" ? "#696b65" : "#262520"
    : xml(safeSvgColor(attrs.textColor ?? attrs.fontColor ?? (node as any).bcTextColor, research ? "#303831" : "#202124"));
  const maxChars = Math.max(8, Math.floor((node.width - 24) / (fontSize * (sketch ? 0.95 : 0.58))));
  const maxLines = Math.max(1, Math.min(80, Math.floor((node.height - 26) / (fontSize * 1.35))));
  const lines = layoutMarkdownForSvg(raw, maxChars, maxLines, fontSize);

  const renderRuns = (runs: SvgMarkdownRun[]): string =>
    runs.map(run => {
      const style = run.style;
      const runAttrs: string[] = [];
      if (style.bold) runAttrs.push('font-weight="bold"');
      if (style.italic) runAttrs.push('font-style="italic"');
      if (style.code) runAttrs.push('font-family="ui-monospace,SFMono-Regular,Consolas,monospace"');
      if (style.link) runAttrs.push('fill="#3467a9"');
      const decorations: string[] = [];
      if (textDecoration !== "none") decorations.push(textDecoration);
      if (style.strike) decorations.push("line-through");
      if (style.link) decorations.push("underline");
      if (decorations.length) runAttrs.push('text-decoration="' + decorations.join(" ") + '"');
      return '<tspan' + (runAttrs.length ? " " + runAttrs.join(" ") : "") + '>' + xml(run.text) + "</tspan>";
    }).join("");

  if (research && !lines.some(line => line.tableRow)) {
    const preset = researchPreset(node.bcResearchPreset).id;
    const accent = researchColor(node);
    const leadingTitle = lines[0]?.fontScale > 1;
    let inTitle = leadingTitle;
    let cursorY = node.y + 24;
    const markup: string[] = [];
    for (const line of lines) {
      if (line.fontScale === 1) inTitle = false;
      const titleBand = inTitle && preset === "argument";
      const size = line.fontScale * fontSize * (preset === "section" ? 1.5 : 1);
      const lineHeight = Math.max(28, size * 1.55);
      if (cursorY + size > node.y + node.height - 8) break;
      if (titleBand) {
        markup.push(`<rect x="${node.x}" y="${cursorY - 16}" width="${node.width}" height="${lineHeight + 1}" fill="${accent}"/>`);
      } else if (preset === "annotation") {
        markup.push(`<path d="M${node.x + 35} ${cursorY + size + 4}H${node.x + node.width - 24}" stroke="${accent}" stroke-opacity=".22"/>`);
      } else if (inTitle && preset === "section") {
        markup.push(`<rect x="${node.x}" y="${cursorY + size - 6}" width="${node.width}" height="7" fill="${accent}" fill-opacity=".17"/>`);
      }
      const inset = preset === "annotation" ? 35 : preset === "section" ? 0 : 24;
      const textX = anchor === "middle" ? node.x + node.width / 2 : anchor === "end" ? node.x + node.width - inset : node.x + inset;
      markup.push(`<text x="${textX}" y="${cursorY + size}" font-family="${fontFamily}" font-size="${size}" font-weight="${line.bold ? "600" : fontWeight}" font-style="${fontStyle}" fill="${titleBand ? "#fffdf7" : textColor}" text-anchor="${anchor}">${renderRuns(line.runs)}</text>`);
      cursorY += lineHeight;
    }
    return `<g clip-path="url(#${clipId})">${markup.join("")}</g>`;
  }

  // Table rows require geometry, rather than a pipe-delimited text label.
  // Keep every cell clipped to the Canvas node bounds and use static SVG only.
  if (lines.some(line => Boolean(line.tableRow))) {
    let cursorY = node.y + 8;
    const tableMarkup: string[] = [];
    const nodeFont = fontFamily;
    const lineHeight = fontSize * 1.25;
    const cellPaddingX = 6;
    const cellPaddingY = 4;

    lines.forEach((line, lineIndex) => {
      if (line.tableRow) {
        const row = line.tableRow;
        const columnCount = Math.max(1, row.cells.length);
        const columnWidth = node.width / columnCount;
        const rowHeight = Math.max(1, row.lineCount) * lineHeight + cellPaddingY * 2;
        row.cells.forEach((cell, columnIndex) => {
          const cellX = node.x + columnIndex * columnWidth;
          const anchorForCell = cell.align === "center" ? "middle" : cell.align === "right" ? "end" : "start";
          const textX = cell.align === "center"
            ? cellX + columnWidth / 2
            : cell.align === "right"
              ? cellX + columnWidth - cellPaddingX
              : cellX + cellPaddingX;
          const clipIdForCell = clipId + "-table-" + lineIndex + "-" + columnIndex;
          tableMarkup.push(
            '<rect x="' + cellX + '" y="' + cursorY + '" width="' + columnWidth + '" height="' + rowHeight +
            '" fill="' + (row.isHeader ? "#7b8794" : "none") + '" fill-opacity="' + (row.isHeader ? "0.14" : "1") +
            '" stroke="#9aa3ad" stroke-width="0.7"/>'
          );
          tableMarkup.push(
            '<defs><clipPath id="' + clipIdForCell + '"><rect x="' + (cellX + 1) + '" y="' + (cursorY + 1) +
            '" width="' + Math.max(1, columnWidth - 2) + '" height="' + Math.max(1, rowHeight - 2) + '"/></clipPath></defs>'
          );
          const cellLines = cell.lines.length ? cell.lines : [[]];
          const content = cellLines.map((runs, runIndex) =>
            '<tspan x="' + textX + '" dy="' + (runIndex === 0 ? 0 : lineHeight) + '">' + renderRuns(runs) + "</tspan>"
          ).join("");
          tableMarkup.push(
            '<text clip-path="url(#' + clipIdForCell + ')" x="' + textX + '" y="' + (cursorY + cellPaddingY + fontSize) +
            '" font-family="' + nodeFont + '" font-size="' + fontSize + '" font-weight="' + (row.isHeader ? "bold" : fontWeight) +
            '" font-style="' + fontStyle + '" fill="' + textColor + '" text-anchor="' + anchorForCell + '">' + content + "</text>"
          );
        });
        cursorY += rowHeight;
        return;
      }

      const lineFontSize = Math.max(8, fontSize * line.fontScale);
      const lineWeight = line.bold ? "bold" : fontWeight;
      const lineY = cursorY + lineFontSize;
      tableMarkup.push(
        '<text clip-path="url(#' + clipId + ')" x="' + startX + '" y="' + lineY +
        '" font-family="' + fontFamily + '" font-size="' + lineFontSize + '" font-weight="' + lineWeight +
        '" font-style="' + fontStyle + '" text-decoration="' + textDecoration +
        '" fill="' + textColor + '" text-anchor="' + anchor + '">' + renderRuns(line.runs) + "</text>"
      );
      cursorY += Math.max(lineHeight, lineFontSize * 1.2);
    });
    return '<g clip-path="url(#' + clipId + ')">' + tableMarkup.join("") + "</g>";
  }

  const startY = node.y + 18 + fontSize;
  const markup = lines.map((line, index) => {
    const lineFontSize = Math.max(8, fontSize * line.fontScale);
    const dy = index === 0 ? 0 : Math.max(fontSize * 1.35, lineFontSize * 1.2);
    const lineWeight = line.bold ? "bold" : fontWeight;
    return '<tspan x="' + startX + '" dy="' + dy + '" font-size="' + lineFontSize +
      '" font-weight="' + lineWeight + '">' + renderRuns(line.runs) + "</tspan>";
  }).join("");
  return '<text clip-path="url(#' + clipId + ')" x="' + startX + '" y="' + startY +
    '" font-family="' + fontFamily + '" font-size="' + fontSize + '" font-weight="' + fontWeight +
    '" font-style="' + fontStyle + '" text-decoration="' + textDecoration + '" fill="' + textColor +
    '" text-anchor="' + anchor + '">' + markup + "</text>";
}

function boxPolygonPoints(
  x: number,
  y: number,
  width: number,
  height: number,
  points: Array<[number, number]>
): string {
  return points.map(([px, py]) => (x + px * width) + "," + (y + py * height)).join(" ");
}

function renderSketchExportNode(node: CanvasNodeData, index: number): string {
  const x = number(node.x), y = number(node.y);
  const width = Math.max(1, number(node.width, 280)), height = Math.max(1, number(node.height, 140));
  const clipId = "bc-clip-" + index;
  const clipPath = '<clipPath id="' + clipId + '"><rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height + '" rx="5"/></clipPath>';
  const ink = resolveSketchStyle(node).preset?.id === "annotation" ? "#696b65" : "#262520";
  const geometry = '<g transform="translate(' + x + ' ' + y + ')">' +
    renderSketchNodeSvg(node, { ink }) + "</g>";
  const imageDataUrl = typeof (node as any).bcExportImageDataUrl === "string"
    ? String((node as any).bcExportImageDataUrl)
    : "";
  const imageMarkup = imageDataUrl.startsWith("data:image/") && node.type === "file"
    ? '<image x="' + (x + 6) + '" y="' + (y + 6) + '" width="' + Math.max(1, width - 12) +
      '" height="' + Math.max(1, height - 30) + '" href="' + xml(imageDataUrl) +
      '" preserveAspectRatio="xMidYMid meet" clip-path="url(#' + clipId + ')"/>'
    : "";
  const text = wrapNodeText(node, clipId, true);
  const displayedText = imageMarkup && typeof node.file === "string"
    ? '<text x="' + (x + 8) + '" y="' + (y + height - 8) +
      '" font-family="BC Sketch Hand, Segoe Print, cursive" font-size="12" font-weight="600" fill="#696b65">' +
      xml(node.file.split("/").pop() ?? node.file) + "</text>"
    : text;
  return clipPath + '<g class="bc-full-node bc-full-sketch-node">' + geometry + imageMarkup + displayedText + "</g>";
}

function renderRoundedMapExportNode(node: CanvasNodeData, index: number): string | null {
  if (node.type === "group") return null;
  const shape = resolveCanvasNodeShape(node as CanvasNodeStyleSource);
  const path = roundedMapPath(shape, node.width, node.height);
  if (!path) return null;
  const { x, y, width, height } = node;
  const inset = roundedMapInsets(shape, width, height);
  const clipId = "bc-clip-" + index;
  const attrs = (node.styleAttributes ?? {}) as Record<string, unknown>;
  const border = resolveCanvasNodeBorder(node as CanvasNodeStyleSource);
  const stroke = border === "none" || border === "invisible" ? "none" : ROUNDED_MAP_INK;
  const dash = border === "dashed" ? ' stroke-dasharray="10 6"' : border === "dotted" ? ' stroke-dasharray="1 8"' : "";
  const rawFill = nodeColor(node);
  const fill = rawFill === "none" ? "#c8dff3" : rawFill;
  const outline = `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${ROUNDED_MAP_STROKE}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
  const inner = border === "double"
    ? `<g transform="translate(6 6) scale(${Math.max(.1, (width - 12) / width)} ${Math.max(.1, (height - 12) / height)})">${outline.replace(`fill="${fill}"`, 'fill="none"')}</g>` : "";
  const clip = `<clipPath id="${clipId}"><path d="${path}" transform="translate(${x} ${y})"/></clipPath>`;
  const textNode = {
    ...node, x: x + inset.x - 12, y: y + inset.y - 18,
    width: Math.max(1, width - inset.x - inset.right + 24),
    height: Math.max(1, height - inset.y - inset.bottom + 26),
    styleAttributes: { ...attrs, fontSize: attrs.fontSize ?? 18, textColor: attrs.textColor ?? ROUNDED_MAP_INK,
      fontFamily: attrs.fontFamily ?? "Avenir Next, PingFang SC, Microsoft YaHei, sans-serif",
      textAlign: node.bcTextAlign ?? attrs.textAlign ?? "left" }
  };
  const image = typeof node.bcExportImageDataUrl === "string" && node.bcExportImageDataUrl.startsWith("data:image/") && node.type === "file"
    ? `<image x="${x + inset.x}" y="${y + inset.y}" width="${Math.max(1, width - inset.x - inset.right)}" height="${Math.max(1, height - inset.y - inset.bottom)}" href="${xml(node.bcExportImageDataUrl)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>`
    : "";
  return clip + `<g class="bc-full-node bc-full-rounded-node"><g transform="translate(${x} ${y})">${outline}${inner}</g>` +
    (image || wrapNodeText(textNode, clipId)) + "</g>";
}

function renderNode(node: CanvasNodeData, index: number, sketch = false, rounded = false, research = false): string {
  if (sketch) return renderSketchExportNode(node, index);
  if (rounded) {
    const result = renderRoundedMapExportNode(node, index);
    if (result) return result;
  }
  const x = number(node.x), y = number(node.y);
  const width = Math.max(1, number(node.width, 280)), height = Math.max(1, number(node.height, 140));
  const attrs = (node as any).styleAttributes ?? {};
  const shape = String(attrs.shape ?? (node as any).bcShape ?? (node as any).shape ?? "rectangle").toLowerCase();
  research = research && node.type !== "group";
  const fill = research ? researchFill(node) : nodeColor(node);
  const border = research ? researchColor(node) : String(attrs.borderColor ?? "#858b93");
  const borderStyle = String((node as any).bcBorderStyle ?? attrs.borderStyle ?? attrs.border ?? "");
  const dash = borderStyle.includes("dash") ? ' stroke-dasharray="8 5"' : borderStyle.includes("dot") ? ' stroke-dasharray="2 5"' : "";
  const stroke = borderStyle === "invisible" ? "none" : border;
  const clipId = "bc-clip-" + index;
  const clip = "";

  let geometry: string;
  const strokeWidth = Math.max(0.5, Math.min(10, number(attrs.borderWidth, 1.5)));
  const polygon = (points: Array<[number, number]>): string =>
    '<polygon points="' + boxPolygonPoints(x, y, width, height, points) + '" fill="' + fill +
    '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  if (node.type === "group") {
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="4" fill="' + (fill === "none" ? "#9aa3ad" : fill) + '" fill-opacity="0.10" stroke="' + stroke +
      '" stroke-width="1.6"' + dash + "/>";
  } else if (["ellipse", "circle", "reference"].includes(shape)) {
    geometry = '<ellipse cx="' + (x + width / 2) + '" cy="' + (y + height / 2) + '" rx="' + width / 2 +
      '" ry="' + height / 2 + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  } else if (["pill", "terminal"].includes(shape)) {
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="' + Math.min(width / 2, height / 2) + '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  } else if (["diamond", "decision"].includes(shape)) {
    geometry = polygon([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
  } else if (shape === "hexagon") {
    geometry = polygon([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
  } else if (shape === "pentagon") {
    geometry = polygon([[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]]);
  } else if (shape === "octagon") {
    geometry = polygon([[0.28, 0], [0.72, 0], [1, 0.28], [1, 0.72], [0.72, 1], [0.28, 1], [0, 0.72], [0, 0.28]]);
  } else if (shape === "triangle") {
    geometry = polygon([[0.5, 0], [1, 1], [0, 1]]);
  } else if (shape === "trapezoid") {
    geometry = polygon([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
  } else if (shape === "chevron") {
    geometry = polygon([[0, 0], [0.78, 0], [1, 0.5], [0.78, 1], [0, 1], [0.22, 0.5]]);
  } else if (shape === "right-arrow") {
    geometry = polygon([[0, .2], [.68, .2], [.68, 0], [1, .5], [.68, 1], [.68, .8], [0, .8]]);
  } else if (shape === "cloud") {
    geometry = polygon([
      [0.22, 0.18], [0.28, 0.05], [0.44, 0.08], [0.55, 0.02], [0.69, 0.13],
      [0.84, 0.11], [0.94, 0.27], [0.9, 0.43], [1, 0.55], [0.88, 0.72],
      [0.84, 0.87], [0.66, 0.91], [0.53, 1], [0.38, 0.91], [0.22, 0.94],
      [0.12, 0.78], [0, 0.7], [0.07, 0.51], [0.02, 0.35], [0.12, 0.2]
    ]);
  } else if (shape === "parallelogram" || shape === "input-output") {
    geometry = polygon([[0.14, 0], [1, 0], [0.86, 1], [0, 1]]);
  } else if (shape === "document") {
    const d = [
      "M", x, y,
      "L", x + width, y,
      "L", x + width, y + height * 0.88,
      "C", x + width * 0.84, y + height * 0.98, x + width * 0.72, y + height * 0.82, x + width * 0.6, y + height * 0.9,
      "C", x + width * 0.46, y + height * 0.98, x + width * 0.34, y + height * 0.82, x + width * 0.2, y + height * 0.9,
      "C", x + width * 0.1, y + height * 0.95, x + width * 0.05, y + height * 0.9, x, y + height * 0.9,
      "Z"
    ].join(" ");
    geometry = '<path d="' + d + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  } else if (shape === "database") {
    const ry = Math.min(height * 0.14, 16);
    const d = [
      "M", x, y + ry,
      "C", x, y - ry, x + width, y - ry, x + width, y + ry,
      "L", x + width, y + height - ry,
      "C", x + width, y + height + ry, x, y + height + ry, x, y + height - ry,
      "Z"
    ].join(" ");
    const topArc = ["M", x, y + ry, "C", x, y + ry * 3, x + width, y + ry * 3, x + width, y + ry].join(" ");
    geometry = '<path d="' + d + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>" +
      '<path d="' + topArc + '" fill="none" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  } else if (shape === "predefined-process") {
    const inset = Math.min(12, width * 0.12);
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="4" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>" +
      '<path d="M ' + (x + inset) + " " + y + " V " + (y + height) + " M " +
      (x + width - inset) + " " + y + " V " + (y + height) +
      '" fill="none" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  } else {
    const radius = shape.includes("round") ? 22 : research ? (shape === "square" || shape === "rectangle" ? 0 : 14) : 7;
    geometry = '<rect x="' + x + '" y="' + y + '" width="' + width + '" height="' + height +
      '" rx="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' + dash + "/>";
  }

  if (borderStyle === "double") {
    const sx = Math.max(0.45, (width - 8) / width);
    const sy = Math.max(0.45, (height - 8) / height);
    const tx = (x + width / 2) * (1 - sx);
    const ty = (y + height / 2) * (1 - sy);
    const inner = geometry.replace(/fill="[^"]*"/g, 'fill="none"').replace(/stroke-width="[^"]*"/g, 'stroke-width="1"');
    geometry += '<g transform="translate(' + tx + " " + ty + ') scale(' + sx + " " + sy + ')">' + inner + "</g>";
  }

  if (research) {
    const accent = researchColor(node);
    const preset = researchPreset(node.bcResearchPreset).id;
    if (preset === "source" && ["rectangle", "square", "default"].includes(shape)) {
      geometry += `<rect x="${x}" y="${y}" width="7" height="${height}" fill="${accent}"/>` +
        `<rect x="${x + 7}" y="${y + 7}" width="${Math.max(1, width - 14)}" height="${Math.max(1, height - 14)}" fill="none" stroke="${accent}" stroke-opacity=".2"/>`;
    }
    if (preset === "quote") geometry += `<path d="M${x} ${y + height - 2}H${x + width}" stroke="${accent}" stroke-width="4"/>`;
    if (preset === "annotation") geometry += `<path d="M${x + 21} ${y}V${y + height}" stroke="${accent}" stroke-opacity=".4"/>`;
    if (preset === "section") geometry += `<path d="M${x} ${y + 1}H${x + width}" stroke="${accent}" stroke-width="2"/>`;
  }
  const text = wrapNodeText(node, clipId, false, research);
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
/**
 * Extract a selected node subgraph for static image export. Edges are kept
 * only when both endpoints are selected; non-Canvas root metadata is retained.
 */
export function canvasDataForSelection(
  data: CanvasData,
  selectedNodeIds: Iterable<string>
): CanvasData {
  const selected = new Set(selectedNodeIds);
  const nodes = data.nodes.filter(node => selected.has(node.id));
  const includedIds = new Set(nodes.map(node => node.id));
  const edges = data.edges.filter(edge =>
    includedIds.has(edge.fromNode) && includedIds.has(edge.toNode)
  );
  return { ...data, nodes, edges };
}

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

  const sketch = data.bcTheme === "sketch";
  const research = data.bcTheme === "research";
  const rounded = data.bcTheme === "rounded-map";
  const sketchFilter = '<filter id="' + SKETCH_EDGE_FILTER_ID + '" x="-8%" y="-20%" width="116%" height="140%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="7" result="noise"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="noise" scale="0.75" xChannelSelector="R" yChannelSelector="G"/>' +
    "</filter>";
  const fontStyle = sketch && SKETCH_FONT_CSS ? "<style>" + SKETCH_FONT_CSS + "</style>" : "";
  const defs = '<defs><marker id="bc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7b8794"/></marker>' +
    (sketch ? sketchFilter + fontStyle : "") + "</defs>";
  const background = options.backgroundColor
    ? '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + xml(options.backgroundColor) + '"/>'
    : sketch || research
      ? '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="' + (research ? "#eeece5" : "#fffefb") + '"/>'
      : rounded ? `<rect width="${width}" height="${height}" fill="${ROUNDED_MAP_PAPER}"/>` : "";
  const nodeMap = new Map(translatedNodes.map(node => [node.id, node]));
  const edgeMarkup = translatedEdges.map((edge, index) => renderEdge(edge, nodeMap, index, sketch, rounded, margin)).join("");
  const nodeMarkup = translatedNodes.map((node, index) => renderNode(node, index, sketch, rounded, research)).join("");

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + " " + height + '">' +
    defs + background + edgeMarkup + nodeMarkup + "</svg>";
  return { svg, width, height };
}
