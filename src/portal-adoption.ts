import type { CanvasNodeData } from "./canvas";

/**
 * Find the Portal whose content bounds contain the center of a newly-created
 * node. If multiple Portal rectangles overlap, the smallest rectangle wins.
 * Group nodes are filtered by the caller because their membership semantics
 * require separate handling from ordinary single-node creation.
 */
export function findContainingPortal(
  candidate: CanvasNodeData,
  portals: CanvasNodeData[],
  currentCanvasPath?: string,
  inset = 8
): CanvasNodeData | undefined {
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  return portals
    .filter(portal => {
      if (portal.id === candidate.id || (portal as any).portal !== true) return false;
      if (currentCanvasPath && portal.file === currentCanvasPath) return false;
      return centerX >= portal.x + inset &&
        centerX <= portal.x + portal.width - inset &&
        centerY >= portal.y + inset &&
        centerY <= portal.y + portal.height - inset;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
