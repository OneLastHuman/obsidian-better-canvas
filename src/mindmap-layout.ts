export type MindMapDirection = "LR" | "RL" | "TB" | "BT";

export interface MindMapLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindMapLayoutEdge {
  fromNode: string;
  toNode: string;
}

export interface MindMapPosition {
  x: number;
  y: number;
}

function finiteDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeGap(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Lay out nodes reachable from a root as a layered directed graph.
 * Breadth-first depth assignment makes cycles finite and gives shared children
 * one deterministic layer. Alternating barycenter sweeps reduce edge crossings.
 * Only returned IDs should be repositioned; disconnected nodes stay untouched.
 */
export function computeMindMapLayout(
  nodes: readonly MindMapLayoutNode[],
  edges: readonly MindMapLayoutEdge[],
  rootId: string,
  direction: MindMapDirection,
  gapX = 100,
  gapY = 44
): Map<string, MindMapPosition> {
  const nodeById = new Map<string, MindMapLayoutNode>();
  const sourceIndex = new Map<string, number>();
  nodes.forEach((node, index) => {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
      sourceIndex.set(node.id, index);
    }
  });
  if (!nodeById.has(rootId)) return new Map();

  const horizontal = direction === "LR" || direction === "RL";
  const primaryGap = nonNegativeGap(horizontal ? gapX : gapY, horizontal ? 100 : 44);
  const crossGap = nonNegativeGap(horizontal ? gapY : gapX, horizontal ? 44 : 100);
  const widthOf = (id: string) => finiteDimension(nodeById.get(id)!.width, 280);
  const heightOf = (id: string) => finiteDimension(nodeById.get(id)!.height, 140);
  const crossSizeOf = (id: string) => horizontal ? heightOf(id) : widthOf(id);
  const primarySizeOf = (id: string) => horizontal ? widthOf(id) : heightOf(id);

  const children = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!nodeById.has(edge.fromNode) || !nodeById.has(edge.toNode)) continue;
    let outgoing = children.get(edge.fromNode);
    if (!outgoing) children.set(edge.fromNode, outgoing = new Set());
    outgoing.add(edge.toNode);
    let incoming = parents.get(edge.toNode);
    if (!incoming) parents.set(edge.toNode, incoming = new Set());
    incoming.add(edge.fromNode);
  }

  const depth = new Map<string, number>([[rootId, 0]]);
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parentId = queue[cursor];
    const nextDepth = depth.get(parentId)! + 1;
    for (const childId of children.get(parentId) ?? []) {
      if (depth.has(childId)) continue;
      depth.set(childId, nextDepth);
      queue.push(childId);
    }
  }

  const maxDepth = Math.max(...depth.values());
  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const [id, layer] of depth) layers[layer].push(id);
  for (const layer of layers) layer.sort((a, b) => sourceIndex.get(a)! - sourceIndex.get(b)!);

  const orderIndices = (): Map<string, number> => {
    const indices = new Map<string, number>();
    for (const layer of layers) layer.forEach((id, index) => indices.set(id, index));
    return indices;
  };

  const reorderLayer = (layerIndex: number, neighborLayer: number, useParents: boolean): void => {
    const neighbors = orderIndices();
    const current = layers[layerIndex];
    const priorOrder = new Map(current.map((id, index) => [id, index]));
    const score = (id: string): number => {
      const connected = (useParents ? parents.get(id) : children.get(id)) ?? new Set<string>();
      const values: number[] = [];
      for (const neighborId of connected) {
        if (depth.get(neighborId) === neighborLayer) {
          const position = neighbors.get(neighborId);
          if (position !== undefined) values.push(position);
        }
      }
      return average(values) ?? priorOrder.get(id)!;
    };
    current.sort((a, b) => {
      const delta = score(a) - score(b);
      if (Math.abs(delta) > 1e-7) return delta;
      const stableDelta = priorOrder.get(a)! - priorOrder.get(b)!;
      return stableDelta || sourceIndex.get(a)! - sourceIndex.get(b)!;
    });
  };

  for (let pass = 0; pass < 6; pass += 1) {
    for (let layer = 1; layer < layers.length; layer += 1) {
      reorderLayer(layer, layer - 1, true);
    }
    for (let layer = layers.length - 2; layer >= 0; layer -= 1) {
      reorderLayer(layer, layer + 1, false);
    }
  }

  const maxPrimarySize = layers.map(layer =>
    Math.max(...layer.map(id => primarySizeOf(id)))
  );
  const root = nodeById.get(rootId)!;
  const primaryStarts: number[] = [horizontal ? root.x : root.y];
  for (let layer = 1; layer < layers.length; layer += 1) {
    if (direction === "LR" || direction === "TB") {
      primaryStarts[layer] = primaryStarts[layer - 1] + maxPrimarySize[layer - 1] + primaryGap;
    } else {
      primaryStarts[layer] = primaryStarts[layer - 1] - primaryGap - maxPrimarySize[layer];
    }
  }

  const rootCrossCenter = horizontal ? root.y + heightOf(rootId) / 2 : root.x + widthOf(rootId) / 2;
  const positions = new Map<string, MindMapPosition>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    if (layerIndex === 0) {
      positions.set(rootId, { x: root.x, y: root.y });
      continue;
    }
    const crossExtent = layer.reduce((total, id) => total + crossSizeOf(id), 0) +
      crossGap * Math.max(0, layer.length - 1);
    let cursor = rootCrossCenter - crossExtent / 2;
    for (const id of layer) {
      if (horizontal) {
        positions.set(id, { x: primaryStarts[layerIndex], y: cursor });
        cursor += heightOf(id) + crossGap;
      } else {
        positions.set(id, { x: cursor, y: primaryStarts[layerIndex] });
        cursor += widthOf(id) + crossGap;
      }
    }
  }
  return positions;
}
