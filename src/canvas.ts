import { computeMindMapLayout } from "./mindmap-layout";
export type LayoutDirection = "LR" | "RL" | "TB" | "BT";

export interface CanvasNodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  fromSide: string;
  toNode: string;
  toSide: string;
  [key: string]: unknown;
}

export interface CanvasData {
  nodes: CanvasNodeData[];
  edges: CanvasEdgeData[];
  [key: string]: unknown;
}

export function createId(): string {
  const alphabet = "0123456789abcdef";
  let output = "";
  for (let i = 0; i < 16; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

export function readCanvasData(canvas: any): CanvasData {
  const raw = (canvas?.getData?.() ?? {}) as Partial<CanvasData>;
  return {
    ...raw,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : []
  } as CanvasData;
}

/**
 * Remove a live Canvas node and its incident edges. Canvas.importData() in some
 * Obsidian versions only adds/updates items, so verify every removal and fall
 * back to setData when the node-level API is unavailable or ineffective.
 */
export function removeCanvasNode(canvas: any, nodeId: string): boolean {
  const containsNode = () => readCanvasData(canvas).nodes.some(node => node.id === nodeId);
  const containsIncidentEdges = () => readCanvasData(canvas).edges.some(edge =>
    edge.fromNode === nodeId || edge.toNode === nodeId
  );
  const isRemoved = () => !containsNode() && !containsIncidentEdges();
  if (isRemoved()) return true;

  const saveAndRefresh = () => {
    canvas.requestSave?.();
    canvas.requestFrame?.();
    return true;
  };

  const liveNode = canvas?.nodes?.get?.(nodeId);
  if (liveNode && typeof canvas.removeNode === "function") {
    try {
      canvas.removeNode(liveNode);
      if (isRemoved()) return saveAndRefresh();
    } catch {
      // Try the data-level APIs below if the internal node API is unavailable.
    }
  }

  const current = readCanvasData(canvas);
  const next: CanvasData = {
    ...current,
    nodes: current.nodes.filter(node => node.id !== nodeId),
    edges: current.edges.filter(edge => edge.fromNode !== nodeId && edge.toNode !== nodeId)
  };

  if (typeof canvas?.setData === "function") {
    try {
      canvas.setData(next);
      if (isRemoved()) return saveAndRefresh();
    } catch {
      // Fall back to importData, then verify rather than assuming it deleted.
    }
  }

  if (typeof canvas?.importData === "function") {
    try {
      canvas.importData(next);
      if (isRemoved()) return saveAndRefresh();
    } catch {
      // Do not report success unless the live Canvas confirms removal.
    }
  }

  return false;
}

export function selectedNodeIds(canvas: any): string[] {
  const selection = canvas?.selection;
  if (!selection || typeof selection.values !== "function") return [];
  const ids: string[] = [];
  for (const selected of selection.values()) {
    const id = selected?.id ?? selected?.node?.id ?? selected?.getData?.()?.id;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function getSelectedNode(canvas: any): CanvasNodeData | undefined {
  const ids = selectedNodeIds(canvas);
  if (ids.length !== 1) return undefined;
  return readCanvasData(canvas).nodes.find(node => node.id === ids[0]);
}

function edgeSides(source: CanvasNodeData, target: CanvasNodeData): [string, string] {
  const sourceX = source.x + source.width / 2;
  const sourceY = source.y + source.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ["right", "left"] : ["left", "right"];
  }
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function insertCanvasNode(
  canvas: any,
  node: CanvasNodeData,
  connectFromId?: string | readonly string[]
): void {
  const data = readCanvasData(canvas);
  const nodes = [...data.nodes.filter(existing => existing.id !== node.id), node];
  const edges = [...data.edges];

  const sourceIds = typeof connectFromId === "string" ? [connectFromId] : connectFromId ?? [];
  for (const sourceId of new Set(sourceIds)) {
    const source = nodes.find(existing => existing.id === sourceId);
    if (source && source.id !== node.id) {
      const [fromSide, toSide] = edgeSides(source, node);
      edges.push({
        id: createId(),
        fromNode: source.id,
        fromSide,
        toNode: node.id,
        toSide
      });
    }
  }

  canvas.importData({ ...data, nodes, edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
}

export function makeTextNode(
  text: string,
  x: number,
  y: number,
  options: Partial<Pick<CanvasNodeData, "width" | "height" | "color">> = {}
): CanvasNodeData {
  return {
    id: createId(),
    type: "text",
    x,
    y,
    width: options.width ?? 280,
    height: options.height ?? 140,
    text,
    ...(options.color ? { color: options.color } : {})
  };
}

export function layoutTree(
  canvas: any,
  rootId: string,
  direction: LayoutDirection,
  gapX = 100,
  gapY = 44
): number {
  const data = readCanvasData(canvas);
  const positions = computeMindMapLayout(data.nodes, data.edges, rootId, direction, gapX, gapY);
  if (positions.size === 0) return 0;

  const nodes = data.nodes.map(node => {
    const position = positions.get(node.id);
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
  canvas.importData({ ...data, nodes, edges: data.edges });
  canvas.requestSave?.();
  canvas.requestFrame?.();
  return positions.size;
}

export function descendantsOf(canvas: any, rootId: string): string[] {
  const data = readCanvasData(canvas);
  const adjacency = new Map<string, string[]>();
  for (const edge of data.edges) {
    const list = adjacency.get(edge.fromNode) ?? [];
    list.push(edge.toNode);
    adjacency.set(edge.fromNode, list);
  }

  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const child of adjacency.get(id) ?? []) visit(child);
  };
  visit(rootId);
  return [...seen];
}
