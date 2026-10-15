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

/**
 * Groups are adopted only when the entire group rectangle is contained by a
 * Portal's usable content area. This avoids moving partially overlapping
 * group frames into another Canvas and breaking spatial membership.
 */
export function findContainingPortalForGroup(
  candidate: CanvasNodeData,
  portals: CanvasNodeData[],
  currentCanvasPath?: string,
  inset = 8
): CanvasNodeData | undefined {
  if (candidate.type !== "group") return undefined;
  const minX = candidate.x;
  const minY = candidate.y;
  const maxX = candidate.x + candidate.width;
  const maxY = candidate.y + candidate.height;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX < minX || maxY < minY) return undefined;

  return portals
    .filter(portal => {
      if (portal.id === candidate.id || (portal as any).portal !== true) return false;
      if (currentCanvasPath && portal.file === currentCanvasPath) return false;
      const portalMinX = portal.x + inset;
      const portalMinY = portal.y + inset;
      const portalMaxX = portal.x + portal.width - inset;
      const portalMaxY = portal.y + portal.height - inset;
      return minX >= portalMinX && minY >= portalMinY &&
        maxX <= portalMaxX && maxY <= portalMaxY;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

