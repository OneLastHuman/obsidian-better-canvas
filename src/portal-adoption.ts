import type { CanvasNodeData } from "./canvas";

type Rectangle = Pick<CanvasNodeData, "x" | "y" | "width" | "height">;

/**
 * Reject incomplete, non-finite, zero-sized, negative-sized, or overflowing
 * rectangles before using them for Portal hit-testing.
 */
function hasUsableRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== "object") return false;
  const rect = value as Partial<Rectangle>;
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    (rect.width as number) <= 0 ||
    (rect.height as number) <= 0
  ) return false;

  // Finite components can still overflow when the rectangle's far edge is
  // computed, which would otherwise make containment comparisons unreliable.
  return Number.isFinite((rect.x as number) + (rect.width as number)) &&
    Number.isFinite((rect.y as number) + (rect.height as number));
}

function isUsableInset(inset: number): boolean {
  return Number.isFinite(inset) && inset >= 0;
}

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
  if (!hasUsableRectangle(candidate) || !Array.isArray(portals) || !isUsableInset(inset)) {
    return undefined;
  }
  const centerX = candidate.x + candidate.width / 2;
  const centerY = candidate.y + candidate.height / 2;
  return portals
    .filter(portal => {
      if (!portal || typeof portal !== "object" || !hasUsableRectangle(portal)) return false;
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
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.type !== "group" ||
    !hasUsableRectangle(candidate) ||
    !Array.isArray(portals) ||
    !isUsableInset(inset)
  ) return undefined;

  const minX = candidate.x;
  const minY = candidate.y;
  const maxX = candidate.x + candidate.width;
  const maxY = candidate.y + candidate.height;

  return portals
    .filter(portal => {
      if (!portal || typeof portal !== "object" || !hasUsableRectangle(portal)) return false;
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
