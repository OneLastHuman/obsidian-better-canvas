/**
 * Reuse Obsidian Canvas' native zoom-to-selection behavior to fit all nodes
 * without leaving the whole Canvas selected after the camera has moved.
 */
export function zoomCanvasToFit(canvas: any): number {
  if (!canvas?.nodes?.values || typeof canvas.select !== "function" ||
      typeof canvas.zoomToSelection !== "function") return 0;

  const nodes = [...canvas.nodes.values()].filter(Boolean);
  if (!nodes.length) return 0;
  const previous = [...(canvas.selection?.values?.() ?? [])];

  try {
    canvas.deselectAll?.();
    for (const node of nodes) canvas.select(node);
    canvas.zoomToSelection();
    return nodes.length;
  } finally {
    canvas.deselectAll?.();
    for (const element of previous) {
      try { canvas.select(element); } catch { /* Ignore stale selection objects. */ }
    }
    canvas.requestFrame?.();
  }
}
