import { CanvasData, CanvasEdgeData, CanvasNodeData, createId, readCanvasData } from "./canvas";

export type NodeShape = "default" | "pill" | "diamond" | "parallelogram" | "hexagon";
export type BorderStyle = "solid" | "dashed" | "dotted" | "double";

export function patchNode(canvas: any, nodeId: string, patch: Record<string, unknown>): boolean {
  const data = readCanvasData(canvas);
  let found = false;
  const nodes = data.nodes.map(node => {
    if (node.id !== nodeId) return node;
    found = true;
    return { ...node, ...patch };
  });
  if (!found) return false;
  const internal = canvas?.nodes?.get?.(nodeId);
  if (internal && typeof internal.setData === "function" && typeof internal.getData === "function") {
    try {
      internal.setData({ ...internal.getData(), ...patch });
      canvas.requestSave?.();
      canvas.requestFrame?.();
      return true;
    } catch {
      // Fall back to importData when the internal Node API is unavailable.
    }
  }
  canvas.importData({ ...data, nodes, edges: data.edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
  return true;
}

export function reorderNode(canvas: any, nodeId: string, bringToFront: boolean): boolean {
  const data = readCanvasData(canvas);
  const node = data.nodes.find(item => item.id === nodeId);
  if (!node) return false;
  const remaining = data.nodes.filter(item => item.id !== nodeId);
  const nodes = bringToFront ? [...remaining, node] : [node, ...remaining];
  canvas.importData({ ...data, nodes, edges: data.edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
  return true;
}

export function flipIncidentEdges(canvas: any, nodeId: string): number {
  const data = readCanvasData(canvas);
  let count = 0;
  const edges = data.edges.map(edge => {
    if (edge.fromNode !== nodeId && edge.toNode !== nodeId) return edge;
    count += 1;
    return {
      ...edge,
      fromNode: edge.toNode,
      toNode: edge.fromNode,
      fromSide: edge.toSide,
      toSide: edge.fromSide,
      ...(edge.fromFloating !== undefined || edge.toFloating !== undefined
        ? { fromFloating: edge.toFloating, toFloating: edge.fromFloating }
        : {}),
      ...(edge.fromEnd !== undefined || edge.toEnd !== undefined
        ? { fromEnd: edge.toEnd, toEnd: edge.fromEnd }
        : {})
    };
  });
  if (count > 0) {
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }
  return count;
}

export function colorIncidentEdges(canvas: any, nodeId: string, color: string): number {
  const data = readCanvasData(canvas);
  let count = 0;
  const edges = data.edges.map(edge => {
    if (edge.fromNode !== nodeId && edge.toNode !== nodeId) return edge;
    count += 1;
    return { ...edge, color, bcColor: color };
  });
  if (count > 0) {
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }
  return count;
}

export function styleSelectedEdges(canvas: any, color: string, pathStyle: "solid" | "dashed" | "dotted"): number {
  const selected = canvas?.selection;
  if (!selected || typeof selected.values !== "function") return 0;
  const ids = new Set<string>();
  for (const item of selected.values()) {
    const id = item?.id ?? item?.getData?.()?.id;
    if (typeof id === "string") ids.add(id);
  }
  const data = readCanvasData(canvas);
  let count = 0;
  const edges = data.edges.map(edge => {
    if (!ids.has(edge.id)) return edge;
    count += 1;
    return {
      ...edge,
      color,
      bcColor: color,
      bcPathStyle: pathStyle,
      styleAttributes: {
        ...((edge as any).styleAttributes ?? {}),
        path: pathStyle === "solid" ? "solid" : pathStyle === "dashed" ? "short-dashed" : "dotted"
      }
    };
  });
  if (count > 0) {
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }
  return count;
}

export type EdgeArrowStyle = "default" | "triangle-outline" | "half-triangle" | "thin-triangle" | "diamond" | "diamond-outline" | "circle" | "circle-outline" | "blunt" | "none";

export function styleSelectedEdgeArrow(canvas: any, arrowStyle: EdgeArrowStyle): number {
  const selected = canvas?.selection;
  if (!selected || typeof selected.values !== "function") return 0;
  const ids = new Set<string>();
  for (const item of selected.values()) {
    const data = item?.getData?.();
    const id = data?.id ?? item?.id;
    if (typeof id === "string") ids.add(id);
  }
  const data = readCanvasData(canvas);
  let count = 0;
  const edges = data.edges.map(edge => {
    if (!ids.has(edge.id)) return edge;
    count += 1;
    const standardArrow = arrowStyle === "half-triangle" ? "halved-triangle" : arrowStyle === "default" ? "triangle" : arrowStyle;
    return {
      ...edge,
      bcArrowStyle: arrowStyle,
      styleAttributes: {
        ...((edge as any).styleAttributes ?? {}),
        ...(standardArrow === "none" ? { arrow: "triangle" } : { arrow: standardArrow })
      },
      ...(standardArrow === "none" ? { toEnd: "none" } : {})
    };
  });
  if (count > 0) {
    canvas.importData({ ...data, nodes: data.nodes, edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
  }
  return count;
}
export function toggleGroupCollapse(canvas: any, groupId: string): "collapsed" | "expanded" | "missing" | "not-group" {
  const data = readCanvasData(canvas);
  const group = data.nodes.find(node => node.id === groupId);
  if (!group) return "missing";
  if (group.type !== "group") return "not-group";

  const extended = group as CanvasNodeData & {
    bcCollapsed?: boolean;
    bcCollapsedNodes?: CanvasNodeData[];
    bcCollapsedEdges?: CanvasEdgeData[];
  };

  if (extended.bcCollapsed) {
    const hiddenNodes = Array.isArray(extended.bcCollapsedNodes) ? extended.bcCollapsedNodes : [];
    const hiddenEdges = Array.isArray(extended.bcCollapsedEdges) ? extended.bcCollapsedEdges : [];
    const nodeIds = new Set(data.nodes.map(node => node.id));
    const edgeIds = new Set(data.edges.map(edge => edge.id));
    const nodes = [
      ...data.nodes,
      ...hiddenNodes.filter(node => !nodeIds.has(node.id)).map(node => ({
        ...node,
        x: group.x + node.x,
        y: group.y + node.y
      }))
    ];
    const edges = [
      ...data.edges,
      ...hiddenEdges.filter(edge => !edgeIds.has(edge.id))
    ];
    const updatedGroup = { ...extended, bcCollapsed: false };
    delete updatedGroup.bcCollapsedNodes;
    delete updatedGroup.bcCollapsedEdges;
    canvas.importData({
      ...data,
      nodes: nodes.map(node => node.id === groupId ? updatedGroup : node),
      edges
    });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    return "expanded";
  }

  const left = group.x;
  const top = group.y;
  const right = group.x + group.width;
  const bottom = group.y + group.height;
  const containedNodes = data.nodes.filter(node =>
    node.id !== groupId &&
    node.x >= left && node.y >= top &&
    node.x + node.width <= right &&
    node.y + node.height <= bottom
  );
  if (containedNodes.length === 0) return "collapsed";

  const containedIds = new Set(containedNodes.map(node => node.id));
  const hiddenEdges = data.edges.filter(edge =>
    containedIds.has(edge.fromNode) || containedIds.has(edge.toNode)
  );
  const nodes = data.nodes
    .filter(node => !containedIds.has(node.id))
    .map(node => node.id === groupId
      ? { ...node, bcCollapsed: true, bcCollapsedNodes: containedNodes.map(child => ({ ...child, x: child.x - group.x, y: child.y - group.y })), bcCollapsedEdges: hiddenEdges }
      : node
    );
  const edges = data.edges.filter(edge => !hiddenEdges.some(hidden => hidden.id === edge.id));
  canvas.importData({ ...data, nodes, edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
  return "collapsed";
}

export function moveSelectionEdgesToTop(canvas: any, direction: "all" | "incoming" | "outgoing" = "all"): number {
  const selection = canvas?.selection;
  if (!selection || typeof selection.values !== "function") return 0;
  const ids = new Set<string>();
  for (const item of selection.values()) {
    const data = item?.getData?.();
    if (data?.type !== "group" && item?.id) ids.add(item.id);
  }
  const canvasData = readCanvasData(canvas);
  const edgeIds = canvasData.edges.filter(edge => {
    const fromSelected = ids.has(edge.fromNode);
    const toSelected = ids.has(edge.toNode);
    if (direction === "incoming") return toSelected && !fromSelected;
    if (direction === "outgoing") return fromSelected && !toSelected;
    return fromSelected || toSelected;
  }).map(edge => edge.id);
  if (!edgeIds.length || typeof canvas.select !== "function") return 0;
  canvas.deselectAll?.();
  for (const id of edgeIds) {
    const edge = canvas.edges?.get?.(id);
    if (edge) canvas.select(edge);
  }
  return edgeIds.length;
}

export function resizeNodeToText(canvas: any, nodeId: string): boolean {
  const data = readCanvasData(canvas);
  const node = data.nodes.find(item => item.id === nodeId);
  if (!node || node.type !== "text" || typeof node.text !== "string") return false;

  const lines = node.text.split("\n");
  const longest = Math.max(1, ...lines.map(line => line.length));
  const width = Math.max(220, Math.min(720, Math.round(longest * 7.2 + 52)));
  const wrappedLines = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(1, (width - 40) / 7.2))), 0);
  const height = Math.max(100, Math.min(1000, Math.round(wrappedLines * 24 + 44)));
  if (Math.abs(node.width - width) < 1 && Math.abs(node.height - height) < 1) return true;
  const nodes = data.nodes.map(item => item.id === nodeId ? { ...item, width, height } : item);
  canvas.importData({ ...data, nodes, edges: data.edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
  return true;
}

type RoutePoint = { x: number; y: number };
type RouteBox = { minX: number; minY: number; maxX: number; maxY: number };

function normalizeBBox(value: any): RouteBox | null {
  if (!value || typeof value !== "object") return null;
  const minX = Number(value.minX ?? value.x);
  const minY = Number(value.minY ?? value.y);
  const maxX = Number(value.maxX ?? (Number(value.x) + Number(value.width)));
  const maxY = Number(value.maxY ?? (Number(value.y) + Number(value.height)));
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function bboxSideCenter(box: RouteBox, side: string): RoutePoint {
  if (side === "left") return { x: box.minX, y: (box.minY + box.maxY) / 2 };
  if (side === "right") return { x: box.maxX, y: (box.minY + box.maxY) / 2 };
  if (side === "top") return { x: (box.minX + box.maxX) / 2, y: box.minY };
  return { x: (box.minX + box.maxX) / 2, y: box.maxY };
}

function sideVector(side: string): RoutePoint {
  if (side === "left") return { x: -1, y: 0 };
  if (side === "right") return { x: 1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function compactPath(points: RoutePoint[]): RoutePoint[] {
  const output: RoutePoint[] = [];
  for (const point of points) {
    const previous = output[output.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 0.01 && Math.abs(previous.y - point.y) < 0.01) continue;
    while (output.length >= 2) {
      const a = output[output.length - 2];
      const b = output[output.length - 1];
      const cross = (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x);
      if (Math.abs(cross) > 0.01) break;
      output.pop();
    }
    output.push(point);
  }
  return output;
}

function pointsToSvgPath(points: RoutePoint[]): string {
  return compactPath(points).map((point, index) =>
    (index === 0 ? "M " : "L ") + point.x.toFixed(2) + " " + point.y.toFixed(2)
  ).join(" ");
}

function directRoute(start: RoutePoint, end: RoutePoint): RoutePoint[] {
  return [start, end];
}

function squareRoute(start: RoutePoint, end: RoutePoint, fromSide: string, toSide: string): RoutePoint[] {
  const sourceHorizontal = fromSide === "left" || fromSide === "right";
  const targetHorizontal = toSide === "left" || toSide === "right";
  if (sourceHorizontal && targetHorizontal) {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (!sourceHorizontal && !targetHorizontal) {
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  if (sourceHorizontal) return [start, { x: end.x, y: start.y }, end];
  return [start, { x: start.x, y: end.y }, end];
}

function aStarGridRoute(
  start: RoutePoint,
  goal: RoutePoint,
  fromSide: string,
  toSide: string,
  obstacleBoxes: RouteBox[],
  step = 32
): RoutePoint[] | null {
  const fromVector = sideVector(fromSide);
  const toVector = sideVector(toSide);
  const startEscape = { x: start.x + fromVector.x * step, y: start.y + fromVector.y * step };
  const goalEscape = { x: goal.x + toVector.x * step, y: goal.y + toVector.y * step };
  const startCell = { x: Math.round(startEscape.x / step), y: Math.round(startEscape.y / step) };
  const goalCell = { x: Math.round(goalEscape.x / step), y: Math.round(goalEscape.y / step) };
  const key = (point: { x: number; y: number }) => point.x + "," + point.y;
  const startKey = key(startCell);
  const goalKey = key(goalCell);
  const corridor = 28;
  const minX = Math.min(startCell.x, goalCell.x) - corridor;
  const maxX = Math.max(startCell.x, goalCell.x) + corridor;
  const minY = Math.min(startCell.y, goalCell.y) - corridor;
  const maxY = Math.max(startCell.y, goalCell.y) + corridor;
  const blocked = (cell: { x: number; y: number }): boolean => {
    if (key(cell) === startKey || key(cell) === goalKey) return false;
    const x = cell.x * step;
    const y = cell.y * step;
    return obstacleBoxes.some(box =>
      x >= box.minX - 12 && x <= box.maxX + 12 &&
      y >= box.minY - 12 && y <= box.maxY + 12
    );
  };

  const open = new Map<string, { x: number; y: number; f: number }>();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  open.set(startKey, { ...startCell, f: Math.abs(startCell.x - goalCell.x) + Math.abs(startCell.y - goalCell.y) });
  const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let visited = 0;

  while (open.size && visited < 12000) {
    let currentKey = "";
    let current: { x: number; y: number; f: number } | null = null;
    for (const [candidateKey, candidate] of open) {
      if (!current || candidate.f < current.f) {
        current = candidate;
        currentKey = candidateKey;
      }
    }
    if (!current) break;
    if (currentKey === goalKey) {
      const cells: RoutePoint[] = [];
      let cursor = goalKey;
      while (cursor !== startKey) {
        const [x, y] = cursor.split(",").map(Number);
        cells.push({ x: x * step, y: y * step });
        const parent = cameFrom.get(cursor);
        if (!parent) return null;
        cursor = parent;
      }
      cells.push({ x: startCell.x * step, y: startCell.y * step });
      cells.reverse();
      return compactPath([start, startEscape, ...cells, goalEscape, goal]);
    }
    open.delete(currentKey);
    visited += 1;
    const baseCost = gScore.get(currentKey) ?? Infinity;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY || blocked(next)) continue;
      const nextKey = key(next);
      const tentative = baseCost + 1;
      if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentative);
      const heuristic = Math.abs(next.x - goalCell.x) + Math.abs(next.y - goalCell.y);
      open.set(nextKey, { ...next, f: tentative + heuristic });
    }
  }
  return null;
}

function setSvgPath(target: any, path: string): void {
  if (typeof target?.setAttr === "function") target.setAttr("d", path);
  else if (typeof target?.setAttribute === "function") target.setAttribute("d", path);
}

function applyConfiguredEdgePath(canvas: any, edge: any, edgeData: any, allNodes: CanvasNodeData[]): void {
  const method = edgeData?.styleAttributes?.pathfindingMethod;
  if (!["direct", "square", "a-star"].includes(method)) return;
  const fromNode = edge?.from?.node;
  const toNode = edge?.to?.node;
  if (!fromNode || !toNode) return;

  const fromBox = normalizeBBox(fromNode.getBBox?.()) ?? normalizeBBox(allNodes.find(node => node.id === edgeData.fromNode));
  const toBox = normalizeBBox(toNode.getBBox?.()) ?? normalizeBBox(allNodes.find(node => node.id === edgeData.toNode));
  if (!fromBox || !toBox) return;
  const fromSide = String(edge?.from?.side ?? edgeData.fromSide ?? "right");
  const toSide = String(edge?.to?.side ?? edgeData.toSide ?? "left");
  const sourceSideCenter = bboxSideCenter(fromBox, fromSide);
  const targetSideCenter = bboxSideCenter(toBox, toSide);
  const start = edge?.from?.end === "none" ? sourceSideCenter : edge?.bezier?.from ?? sourceSideCenter;
  const end = edge?.to?.end === "none" ? targetSideCenter : edge?.bezier?.to ?? targetSideCenter;

  let points: RoutePoint[];
  if (method === "direct") {
    points = directRoute(start, end);
  } else if (method === "square") {
    points = squareRoute(start, end, fromSide, toSide);
  } else {
    const obstacles = allNodes
      .filter(node => node.id !== edgeData.fromNode && node.id !== edgeData.toNode && node.type !== "group")
      .map(normalizeBBox)
      .filter((box): box is RouteBox => Boolean(box));
    points = aStarGridRoute(start, end, fromSide, toSide, obstacles) ?? squareRoute(start, end, fromSide, toSide);
  }

  const svgPath = pointsToSvgPath(points);
  edge.center = points[Math.floor(points.length / 2)] ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  setSvgPath(edge.path?.interaction, svgPath);
  setSvgPath(edge.path?.display, svgPath);
}

export function decorateCanvas(canvas: any): void {
  const data = readCanvasData(canvas);
  for (const nodeData of data.nodes) {
    const node = canvas?.nodes?.get?.(nodeData.id);
    const element = node?.nodeEl ?? node?.containerEl ?? node?.el;
    if (!(element instanceof HTMLElement)) continue;
    const styleAttributes = (nodeData as any).styleAttributes ?? {};
    const storedShape = typeof nodeData.bcShape === "string" ? nodeData.bcShape
      : typeof styleAttributes.shape === "string" ? styleAttributes.shape : "default";
    const shape = storedShape === "rectangle" ? "default" : storedShape === "circle" ? "circle" : storedShape;
    const borderStyle = typeof nodeData.bcBorderStyle === "string" ? nodeData.bcBorderStyle
      : typeof styleAttributes.border === "string" ? styleAttributes.border : "solid";
    element.dataset.bcShape = shape;
    element.dataset.bcBorder = borderStyle;
    element.dataset.bcTextAlign = typeof nodeData.bcTextAlign === "string" ? nodeData.bcTextAlign
      : typeof styleAttributes.textAlign === "string" ? styleAttributes.textAlign : "left";
    element.style.textAlign = element.dataset.bcTextAlign ?? "left";
    element.style.borderStyle = borderStyle;
    const contents = element.querySelectorAll<HTMLElement>(".canvas-node-content, .canvas-node-container, .canvas-node-iframe");
    contents.forEach(child => {
      child.style.textAlign = element.dataset.bcTextAlign ?? "left";
    });
  }

  for (const edgeData of data.edges as Array<CanvasEdgeData & { bcColor?: string; bcPathStyle?: string; bcArrowStyle?: EdgeArrowStyle }>) {
    const edge = canvas?.edges?.get?.(edgeData.id);
    applyConfiguredEdgePath(canvas, edge, edgeData, data.nodes);
    const path = edge?.path?.display ?? edge?.path?.el ?? edge?.path;
    const styleAttributes = (edgeData as any).styleAttributes ?? {};
    const storedPath = edgeData.bcPathStyle
      ?? (styleAttributes.path === "short-dashed" || styleAttributes.path === "long-dashed" ? "dashed"
        : styleAttributes.path === "dotted" ? "dotted" : "solid");
    const styleColor = typeof edgeData.bcColor === "string" ? edgeData.bcColor
      : typeof edgeData.color === "string" && /^#[0-9a-f]{3,8}$/i.test(edgeData.color) ? edgeData.color : "";
    if (path instanceof SVGElement) {
      if (styleColor) path.style.stroke = styleColor;
      path.style.strokeDasharray = storedPath === "dashed" ? "8 5"
        : storedPath === "dotted" ? "2 5" : "";
    }

    const storedArrow = edgeData.bcArrowStyle
      ?? (typeof styleAttributes.arrow === "string"
        ? styleAttributes.arrow === "halved-triangle" ? "half-triangle"
        : styleAttributes.arrow === "triangle" ? "default" : styleAttributes.arrow
        : undefined);
    if (!storedArrow) continue;
    const points: Record<string, string> = {
      "default": "0,0 6.5,10.4 -6.5,10.4",
      "triangle-outline": "0,0 6.5,10.4 -6.5,10.4",
      "half-triangle": "-2,0 7.5,12 -2,12",
      "thin-triangle": "0,0 7,10 0,0 0,10 0,0 -7,10",
      "diamond": "0,0 5,10 0,20 -5,10",
      "diamond-outline": "0,0 5,10 0,20 -5,10",
      "circle": "0,0 4.95,1.8 7.5,6.45 6.6,11.7 2.7,15 -2.7,15 -6.6,11.7 -7.5,6.45 -4.95,1.8",
      "circle-outline": "0,0 4.95,1.8 7.5,6.45 6.6,11.7 2.7,15 -2.7,15 -6.6,11.7 -7.5,6.45 -4.95,1.8",
      "blunt": "-10,8 10,8 10,6 -10,6"
    };
    for (const lineEnd of [edge?.fromLineEnd, edge?.toLineEnd]) {
      const polygon = lineEnd?.el?.querySelector?.("polygon");
      if (!(polygon instanceof SVGElement)) continue;
      if (storedArrow === "none") {
        polygon.style.display = "none";
        continue;
      }
      polygon.style.display = "";
      polygon.setAttribute("points", points[storedArrow] ?? points.default);
      if (styleColor) {
        polygon.style.stroke = styleColor;
      } else {
        polygon.style.removeProperty("stroke");
      }
      if (storedArrow.endsWith("-outline") || storedArrow === "thin-triangle") {
        polygon.style.fill = "var(--background-primary)";
      } else if (styleColor && ["diamond", "circle", "half-triangle", "default"].includes(storedArrow)) {
        polygon.style.fill = styleColor;
      } else {
        polygon.style.removeProperty("fill");
      }
    }
  }
}
