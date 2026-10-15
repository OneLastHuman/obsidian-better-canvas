import type { CanvasNodeData } from "./canvas";

export type SelectionFlipAxis = "horizontal" | "vertical";

export function flipCanvasNodePositions(
  nodes: CanvasNodeData[],
  selectedIds: Iterable<string>,
  axis: SelectionFlipAxis
): CanvasNodeData[] {
  const selected = new Set(selectedIds);
  const moving = nodes.filter(node => selected.has(node.id));
  if (moving.length < 2) return nodes.map(node => ({ ...node }));
  const minX = Math.min(...moving.map(node => node.x));
  const minY = Math.min(...moving.map(node => node.y));
  const maxX = Math.max(...moving.map(node => node.x + node.width));
  const maxY = Math.max(...moving.map(node => node.y + node.height));

  return nodes.map(node => {
    if (!selected.has(node.id)) return { ...node };
    if (axis === "horizontal") {
      return { ...node, x: minX + maxX - node.width - node.x };
    }
    return { ...node, y: minY + maxY - node.height - node.y };
  });
}

/** Swap the centers of exactly two nodes while retaining their own dimensions. */
export function swapCanvasNodePositions(
  nodes: CanvasNodeData[],
  selectedIds: Iterable<string>
): CanvasNodeData[] {
  const selected = new Set(selectedIds);
  const moving = nodes.filter(node => selected.has(node.id));
  if (moving.length !== 2) return nodes.map(node => ({ ...node }));
  const [left, right] = moving;
  const leftCenter = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
  const rightCenter = { x: right.x + right.width / 2, y: right.y + right.height / 2 };

  return nodes.map(node => {
    if (node.id === left.id) {
      return { ...node, x: rightCenter.x - node.width / 2, y: rightCenter.y - node.height / 2 };
    }
    if (node.id === right.id) {
      return { ...node, x: leftCenter.x - node.width / 2, y: leftCenter.y - node.height / 2 };
    }
    return { ...node };
  });
}
