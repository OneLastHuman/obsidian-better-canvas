import { selectedNodeIds } from "./canvas";
import type { CanvasRuntime } from "./canvas-runtime";

export interface ConnectedEdge {
  id: string;
  fromNode: string;
  toNode: string;
}

/**
 * Return every edge touching at least one selected node.
 * This is deliberately a read-only selection helper: it does not mutate Canvas
 * JSON, selection state, or the selected edge set.
 */
export function connectedEdgeIds(
  edges: readonly ConnectedEdge[],
  selectedNodeIds: Iterable<string>
): Set<string> {
  const selected = new Set<string>();
  for (const id of selectedNodeIds) {
    if (typeof id === "string" && id.length > 0) selected.add(id);
  }
  if (selected.size === 0) return new Set();

  const result = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== "string") continue;
    if (selected.has(edge.fromNode) || selected.has(edge.toNode)) {
      result.add(edge.id);
    }
  }
  return result;
}

/** Read node IDs from an Obsidian Canvas selection without treating selected edges as nodes. */
export function selectedCanvasNodeIds(
  canvas: Pick<Partial<CanvasRuntime>, "selection"> | null | undefined,
  availableNodeIds?: Iterable<string>
): string[] {
  const ids = selectedNodeIds(canvas);
  if (!availableNodeIds) return ids;
  const allowed = new Set(availableNodeIds);
  return ids.filter(id => allowed.has(id));
}
