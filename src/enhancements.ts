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
