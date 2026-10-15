import type { CanvasData, CanvasEdgeData, CanvasNodeData } from "./canvas";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Obsidian's live Canvas getData() may omit schema fields that were present in
 * the saved file. Prefer live values, but retain source-only properties; use
 * the live arrays as authoritative so deleted nodes/edges are not resurrected.
 */
function mergeSourceAndLive(source: unknown, live: unknown): unknown {
  if (live === undefined) return source;
  if (!isRecord(live) || Array.isArray(live)) return live;
  if (!isRecord(source) || Array.isArray(source)) return live;

  const merged: Record<string, unknown> = { ...source };
  for (const [key, value] of Object.entries(live)) {
    if (value === undefined) continue;
    merged[key] = mergeSourceAndLive(source[key], value);
  }
  return merged;
}

export function mergeCanvasExportData(live: CanvasData, source: CanvasData): CanvasData {
  const sourceNodes = new Map(source.nodes.map(node => [node.id, node]));
  const sourceEdges = new Map(source.edges.map(edge => [edge.id, edge]));
  const mergedRoot = mergeSourceAndLive(source, live) as CanvasData;
  const nodes = live.nodes.map(node =>
    mergeSourceAndLive(sourceNodes.get(node.id), node) as CanvasNodeData
  );
  const edges = live.edges.map(edge =>
    mergeSourceAndLive(sourceEdges.get(edge.id), edge) as CanvasEdgeData
  );
  return { ...mergedRoot, nodes, edges };
}

/** An empty background preference means transparent output, not themed Canvas chrome. */
export function viewportExportAppearance(backgroundColor?: string): {
  backgroundColor?: string;
  style?: { background: "transparent"; backgroundColor: "transparent" };
} {
  const color = backgroundColor?.trim();
  return color
    ? { backgroundColor: color }
    : { style: { background: "transparent", backgroundColor: "transparent" } };
}
