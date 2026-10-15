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
export function selectedCanvasNodeIds(canvas: any, availableNodeIds?: Iterable<string>): string[] {
  const selection = canvas?.selection;
  if (!selection || typeof selection.values !== "function") return [];
  const allowed = availableNodeIds ? new Set(availableNodeIds) : undefined;
  const ids: string[] = [];
  for (const selected of selection.values()) {
    const id = selected?.id ?? selected?.node?.id ?? selected?.getData?.()?.id;
    if (typeof id === "string" && (!allowed || allowed.has(id)) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
