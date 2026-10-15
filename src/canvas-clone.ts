import type { CanvasEdgeData, CanvasNodeData } from "./canvas";

export type CloneDirection = "left" | "right" | "up" | "down";

export function cloneCanvasNodeInDirection<T extends CanvasNodeData>(
  source: T,
  direction: CloneDirection,
  gap: number,
  newId: string
): T {
  const copy = JSON.parse(JSON.stringify(source)) as T;
  const distance = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  copy.id = newId;
  if (direction === "left") copy.x = source.x - source.width - distance;
  else if (direction === "right") copy.x = source.x + source.width + distance;
  else if (direction === "up") copy.y = source.y - source.height - distance;
  else copy.y = source.y + source.height + distance;
  return copy;
}

export function createNodeExpansionEdge(
  sourceId: string,
  cloneId: string,
  edgeId: string,
  direction: CloneDirection
): CanvasEdgeData {
  const sides: Record<CloneDirection, [string, string]> = {
    left: ["left", "right"],
    right: ["right", "left"],
    up: ["top", "bottom"],
    down: ["bottom", "top"]
  };
  const [fromSide, toSide] = sides[direction];
  return { id: edgeId, fromNode: sourceId, fromSide, toNode: cloneId, toSide };
}
