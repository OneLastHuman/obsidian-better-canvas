import type { ItemView, TFile } from "obsidian";
import type { CanvasData, CanvasEdgeData, CanvasNodeData } from "./canvas";

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Publicly observed members of Obsidian's version-dependent Canvas objects. */
export interface CanvasSelectionRuntime {
  id?: string;
  node?: { id?: string };
  isEditing?: boolean;
  getData?(): { id?: string; type?: string };
}

export interface CanvasNodeRuntime extends CanvasSelectionRuntime {
  id: string;
  data?: CanvasNodeData;
  nodeEl?: HTMLElement;
  containerEl?: HTMLElement;
  el?: HTMLElement;
  isEditing?: boolean;
  isResizing?: boolean;
  startEditing?(): unknown;
  getData?(): CanvasNodeData;
  setData?(data: CanvasNodeData): unknown;
  getBBox?(): unknown;
  moveTo?(position: CanvasPoint): unknown;
  render?(): unknown;
}

export interface CanvasEdgeRuntime extends CanvasSelectionRuntime {
  id: string;
  data?: CanvasEdgeData;
  getData?(): CanvasEdgeData;
  setData?(data: CanvasEdgeData): unknown;
  __bcRouteSignature?: string;
  center?: CanvasPoint;
  updatePath?(): void;
  from?: { node: CanvasNodeRuntime; side?: string; end?: string };
  to?: { node: CanvasNodeRuntime; side?: string; end?: string };
  bezier?: { from?: CanvasPoint; to?: CanvasPoint };
  path?: SVGElement | { interaction?: SVGElement; display?: SVGElement; el?: SVGElement };
  fromLineEnd?: { el?: SVGElement };
  toLineEnd?: { el?: SVGElement };
}

export interface CanvasRuntime {
  getData: (this: CanvasRuntime, ...args: unknown[]) => unknown;
  importData: (this: CanvasRuntime, data: CanvasData, ...args: unknown[]) => unknown;
  setData?: (this: CanvasRuntime, data: CanvasData, ...args: unknown[]) => unknown;
  data?: CanvasData;
  nodes?: Map<string, CanvasNodeRuntime>;
  edges?: Map<string, CanvasEdgeRuntime>;
  selection?: Set<CanvasSelectionRuntime>;
  wrapperEl?: HTMLElement;
  view?: CanvasViewRuntime;
  readonly?: boolean;
  readOnly?: boolean;
  zoom?: number;
  tx?: number;
  ty?: number;
  panX?: number;
  panY?: number;
  x?: number;
  y?: number;
  viewport?: { tx?: number; ty?: number; panX?: number; panY?: number; x?: number; y?: number; zoom?: number };
  metadata?: { frontmatter?: Record<string, unknown> };
  history?: { data: CanvasData[]; current: number };
  requestPushHistory?: (() => unknown) & { cancel?(): void };
  pushHistory?(data: CanvasData): unknown;
  requestSave?: (this: CanvasRuntime, ...args: unknown[]) => unknown;
  requestFrame?(...args: unknown[]): unknown;
  removeNode?(node: CanvasNodeRuntime): unknown;
  select?(item: CanvasSelectionRuntime): unknown;
  selectOnly?(item: CanvasSelectionRuntime): unknown;
  deselectAll?(): unknown;
  zoomToSelection?(): unknown;
  posCenter?(): CanvasPoint;
  posFromClient?(point: CanvasPoint): CanvasPoint;
}

export interface CanvasViewRuntime extends ItemView {
  canvas: CanvasRuntime;
  file: TFile | null;
  getViewData?: (this: CanvasViewRuntime, ...args: unknown[]) => unknown;
}

/** Canvas is a private host interface; detect its stable data capabilities first. */
export function isCanvasRuntime(value: unknown): value is CanvasRuntime {
  return value !== null && typeof value === "object" &&
    "getData" in value && typeof value.getData === "function" &&
    "importData" in value && typeof value.importData === "function";
}

function hasViewType(value: unknown): value is { getViewType(): unknown; canvas?: unknown } {
  return value !== null && typeof value === "object" &&
    "getViewType" in value && typeof value.getViewType === "function";
}

export function isCanvasViewRuntime(value: unknown): value is CanvasViewRuntime {
  return hasViewType(value) && value.getViewType() === "canvas" && isCanvasRuntime(value.canvas);
}
