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

export function selectedNodeIds(canvas: any): string[] {
  const selection = canvas?.selection;
  if (!selection || typeof selection.values !== "function") return [];
  const ids: string[] = [];
  for (const selected of selection.values()) {
    const id = selected?.id ?? selected?.node?.id;
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
  connectFromId?: string
): void {
  const data = readCanvasData(canvas);
  const nodes = [...data.nodes.filter(existing => existing.id !== node.id), node];
  const edges = [...data.edges];

  if (connectFromId) {
    const source = nodes.find(existing => existing.id === connectFromId);
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
  const nodeMap = new Map(data.nodes.map(node => [node.id, node]));
  const root = nodeMap.get(rootId);
  if (!root) return 0;

  const children = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!nodeMap.has(edge.fromNode) || !nodeMap.has(edge.toNode)) continue;
    const list = children.get(edge.fromNode) ?? [];
    list.push(edge.toNode);
    children.set(edge.fromNode, list);
  }

  const horizontal = direction === "LR" || direction === "RL";
  const crossSize = (node: CanvasNodeData) => horizontal ? node.height : node.width;
  const maxWidth = Math.max(280, ...data.nodes.map(node => node.width));
  const maxHeight = Math.max(140, ...data.nodes.map(node => node.height));
  const stepX = maxWidth + gapX;
  const stepY = maxHeight + gapY;
  const positions = new Map<string, { x: number; y: number }>();

  const subtreeExtent = (id: string, ancestry: Set<string>): number => {
    const node = nodeMap.get(id);
    if (!node) return 0;
    if (ancestry.has(id)) return crossSize(node);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(id);
    const childIds = (children.get(id) ?? []).filter(childId => !nextAncestry.has(childId));
    if (childIds.length === 0) return crossSize(node);
    const childrenExtent = childIds.reduce(
      (sum, childId) => sum + subtreeExtent(childId, nextAncestry),
      0
    );
    const crossGap = horizontal ? gapY : gapX;
    return Math.max(crossSize(node), childrenExtent + crossGap * (childIds.length - 1));
  };

  const rootCenter = horizontal
    ? root.y + root.height / 2
    : root.x + root.width / 2;
  const place = (id: string, depth: number, center: number, ancestry: Set<string>): void => {
    const node = nodeMap.get(id);
    if (!node || ancestry.has(id) || positions.has(id)) return;

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(id);
    let x = node.x;
    let y = node.y;

    if (horizontal) {
      x = direction === "LR" ? root.x + depth * stepX : root.x - depth * stepX;
      y = center - node.height / 2;
    } else {
      x = center - node.width / 2;
      y = direction === "TB" ? root.y + depth * stepY : root.y - depth * stepY;
    }
    positions.set(id, { x, y });

    const childIds = (children.get(id) ?? []).filter(childId =>
      !nextAncestry.has(childId) && nodeMap.has(childId)
    );
    if (childIds.length === 0) return;

    const crossGap = horizontal ? gapY : gapX;
    const totalExtent = childIds.reduce(
      (sum, childId) => sum + subtreeExtent(childId, nextAncestry),
      0
    ) + crossGap * (childIds.length - 1);
    let cursor = center - totalExtent / 2;

    for (const childId of childIds) {
      const childExtent = subtreeExtent(childId, nextAncestry);
      place(childId, depth + 1, cursor + childExtent / 2, nextAncestry);
      cursor += childExtent + crossGap;
    }
  };

  place(rootId, 0, rootCenter, new Set());
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
