import { computeMindMapLayout } from "./mindmap-layout";
import type { CanvasRuntime } from "./canvas-runtime";

export interface CanvasStyleAttributes {
  shape?: string | null;
  border?: string | null;
  textAlign?: string | null;
  path?: string | null;
  pathfindingMethod?: string | null;
  arrow?: string | null;
  [key: string]: unknown;
}
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
  styleAttributes?: CanvasStyleAttributes;
  portal?: boolean;
  isPortalLoaded?: boolean;
  bcPortalEdges?: CanvasEdgeData[];
  bcCollapsed?: boolean;
  bcCollapsedNodes?: CanvasNodeData[];
  bcCollapsedEdges?: CanvasEdgeData[];
  bcOriginalHeight?: number;
  bcOriginalWidth?: number;
  bcShape?: string;
  bcBorderStyle?: string;
  bcTextAlign?: string;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  fromSide?: string;
  toNode: string;
  toSide?: string;
  color?: string;
  bcColor?: string;
  styleAttributes?: CanvasStyleAttributes;
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

function hasValidStyleAttributes(value: unknown): value is CanvasStyleAttributes {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (!("shape" in value) || value.shape === undefined || value.shape === null || typeof value.shape === "string") &&
    (!("border" in value) || value.border === undefined || value.border === null || typeof value.border === "string") &&
    (!("textAlign" in value) || value.textAlign === undefined || value.textAlign === null || typeof value.textAlign === "string") &&
    (!("path" in value) || value.path === undefined || value.path === null || typeof value.path === "string") &&
    (!("pathfindingMethod" in value) || value.pathfindingMethod === undefined || value.pathfindingMethod === null || typeof value.pathfindingMethod === "string") &&
    (!("arrow" in value) || value.arrow === undefined || value.arrow === null || typeof value.arrow === "string");
}

function hasValidNodeProperties(value: object): boolean {
  return (!("text" in value) || value.text === undefined || typeof value.text === "string") &&
    (!("file" in value) || value.file === undefined || typeof value.file === "string") &&
    (!("url" in value) || value.url === undefined || typeof value.url === "string") &&
    (!("color" in value) || value.color === undefined || typeof value.color === "string") &&
    (!("bcShape" in value) || value.bcShape === undefined || typeof value.bcShape === "string") &&
    (!("bcBorderStyle" in value) || value.bcBorderStyle === undefined || typeof value.bcBorderStyle === "string") &&
    (!("bcTextAlign" in value) || value.bcTextAlign === undefined || typeof value.bcTextAlign === "string") &&
    (!("portal" in value) || value.portal === undefined || typeof value.portal === "boolean") &&
    (!("isPortalLoaded" in value) || value.isPortalLoaded === undefined || typeof value.isPortalLoaded === "boolean") &&
    (!("bcCollapsed" in value) || value.bcCollapsed === undefined || typeof value.bcCollapsed === "boolean") &&
    (!("bcOriginalHeight" in value) || value.bcOriginalHeight === undefined || typeof value.bcOriginalHeight === "number") &&
    (!("bcOriginalWidth" in value) || value.bcOriginalWidth === undefined || typeof value.bcOriginalWidth === "number") &&
    (!("styleAttributes" in value) || value.styleAttributes === undefined || hasValidStyleAttributes(value.styleAttributes)) &&
    (!("bcCollapsedNodes" in value) || value.bcCollapsedNodes === undefined ||
      (Array.isArray(value.bcCollapsedNodes) && value.bcCollapsedNodes.every(isCanvasNodeData))) &&
    (!("bcPortalEdges" in value) || value.bcPortalEdges === undefined ||
      (Array.isArray(value.bcPortalEdges) && value.bcPortalEdges.every(isCanvasEdgeData))) &&
    (!("bcCollapsedEdges" in value) || value.bcCollapsedEdges === undefined ||
      (Array.isArray(value.bcCollapsedEdges) && value.bcCollapsedEdges.every(isCanvasEdgeData)));
}

function hasValidEdgeProperties(value: object): boolean {
  return (!("color" in value) || value.color === undefined || typeof value.color === "string") &&
    (!("bcColor" in value) || value.bcColor === undefined || typeof value.bcColor === "string") &&
    (!("styleAttributes" in value) || value.styleAttributes === undefined || hasValidStyleAttributes(value.styleAttributes));
}

export function isCanvasNodeData(value: unknown): value is CanvasNodeData {
  return value !== null && typeof value === "object" &&
    "id" in value && typeof value.id === "string" &&
    "type" in value && typeof value.type === "string" &&
    "x" in value && typeof value.x === "number" &&
    "y" in value && typeof value.y === "number" &&
    "width" in value && typeof value.width === "number" &&
    "height" in value && typeof value.height === "number" && hasValidNodeProperties(value);
}

export function isCanvasEdgeData(value: unknown): value is CanvasEdgeData {
  return value !== null && typeof value === "object" &&
    "id" in value && typeof value.id === "string" &&
    "fromNode" in value && typeof value.fromNode === "string" &&
    "toNode" in value && typeof value.toNode === "string" &&
    (!("fromSide" in value) || value.fromSide === undefined || typeof value.fromSide === "string") &&
    (!("toSide" in value) || value.toSide === undefined || typeof value.toSide === "string") && hasValidEdgeProperties(value);
}

export function isCanvasData(value: unknown): value is CanvasData {
  return value !== null && typeof value === "object" &&
    "nodes" in value && Array.isArray(value.nodes) && value.nodes.every(isCanvasNodeData) &&
    "edges" in value && Array.isArray(value.edges) && value.edges.every(isCanvasEdgeData);
}

export function normalizeCanvasData(value: unknown): CanvasData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { nodes: [], edges: [] };
  const nodes: unknown = "nodes" in value ? value.nodes : [];
  const edges: unknown = "edges" in value ? value.edges : [];
  if (!Array.isArray(nodes) || !nodes.every(isCanvasNodeData) ||
      !Array.isArray(edges) || !edges.every(isCanvasEdgeData)) {
    throw new Error("Invalid Canvas snapshot; refusing to discard unrecognized nodes or edges.");
  }
  return { ...value, nodes, edges };
}

interface CanvasDataReader {
  getData?(): unknown;
}

interface CanvasNodeRemovalRuntime extends CanvasDataReader,
  Pick<Partial<CanvasRuntime>, "nodes" | "removeNode" | "requestFrame"> {
  importData?(data: CanvasData, ...args: unknown[]): unknown;
  setData?(data: CanvasData, ...args: unknown[]): unknown;
  requestSave?(...args: unknown[]): unknown;
}

export function readCanvasData(canvas: CanvasDataReader | null | undefined): CanvasData {
  return normalizeCanvasData(canvas?.getData?.());
}

/**
 * Remove a live Canvas node and its incident edges. Canvas.importData() in some
 * Obsidian versions only adds/updates items, so verify every removal and fall
 * back to setData when the node-level API is unavailable or ineffective.
 */
export function removeCanvasNode(canvas: CanvasNodeRemovalRuntime, nodeId: string): boolean {
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

export function selectedNodeIds(canvas: Pick<Partial<CanvasRuntime>, "selection"> | null | undefined): string[] {
  const selection = canvas?.selection;
  if (!selection || typeof selection.values !== "function") return [];
  const ids: string[] = [];
  for (const selected of selection.values()) {
    const id = selected?.id ?? selected?.node?.id ?? selected?.getData?.()?.id;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function getSelectedNode(canvas: Partial<CanvasRuntime>): CanvasNodeData | undefined {
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
  canvas: CanvasRuntime,
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
  canvas: CanvasRuntime,
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

export function descendantsOf(canvas: Pick<Partial<CanvasRuntime>, "getData">, rootId: string): string[] {
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
