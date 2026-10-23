import { readCanvasData, type CanvasData, type CanvasNodeData, type CanvasEdgeData } from "./canvas";
import { clearSketchCanvas, decorateSketchCanvas } from "./sketch-renderer";
import { clearSoftNotesNode, decorateSoftNotesNode } from "./soft-notes-style";
import { clearResearchNode, decorateResearchNode } from "./research-style";
import { clearRoundedMapNode, decorateRoundedMapNode } from "./rounded-map-style";

export type CanvasThemeId = "default" | "scrapbook" | "sketch" | "rounded-map" | "research" | "soft-notes";

export const SCRAPBOOK_PRESETS = [
  { id: "tape", label: "胶带便签", sample: "拾起灵感", color: "#f4dfaa" },
  { id: "lined", label: "横线纸", sample: "慢慢记录", color: "#f8f3e7" },
  { id: "torn", label: "撕边纸", sample: "留住片刻", color: "#e8c6b9" },
  { id: "photo", label: "照片框", sample: "珍藏一页", color: "#fffaf0" },
  { id: "label", label: "标签", sample: "值得收藏", color: "#d4dfc8" }
] as const;

export const SCRAPBOOK_COLORS = [
  { id: "ochre", label: "麦穗", value: "#bd9455" },
  { id: "clay", label: "陶土", value: "#bf826c" },
  { id: "rose", label: "干玫瑰", value: "#bd8990" },
  { id: "sage", label: "鼠尾草", value: "#91a17c" },
  { id: "olive", label: "橄榄", value: "#8d9470" },
  { id: "moss", label: "苔绿", value: "#6d8b78" },
  { id: "sky", label: "雾蓝", value: "#8ba4ad" },
  { id: "lavender", label: "灰紫", value: "#a194b0" },
  { id: "sand", label: "沙色", value: "#bea987" },
  { id: "ink", label: "棕墨", value: "#897563" }
] as const;

export function resolveCanvasTheme(data: Partial<CanvasData>): CanvasThemeId {
  if (data.bcTheme === "scrapbook") return "scrapbook";
  if (data.bcTheme === "sketch") return "sketch";
  if (data.bcTheme === "soft-notes") return "soft-notes";
  if (data.bcTheme === "research") return "research";
  if (data.bcTheme === "rounded-map") return "rounded-map";
  return "default";
}

export function withCanvasTheme(data: CanvasData, theme: CanvasThemeId): CanvasData {
  return { ...data, bcTheme: theme };
}

export function scrapbookPreset(value: unknown): string {
  return SCRAPBOOK_PRESETS.some(preset => preset.id === value) ? String(value) : "tape";
}

export function applyScrapbookPreset(data: CanvasData, ids: readonly string[], preset: string): CanvasData {
  if (!SCRAPBOOK_PRESETS.some(item => item.id === preset)) return data;
  const selected = new Set(ids);
  return {
    ...data,
    nodes: data.nodes.map(node => selected.has(node.id) && node.type !== "group"
      ? { ...node, bcScrapbookPreset: preset } : node)
  };
}

function historySignature(data: unknown): string | undefined {
  return JSON.stringify(data, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : value);
}

/** Native importData updates nodes/edges only; the Canvas owns top-level data. */
export function recordCanvasStyleHistory(canvas: any, data: CanvasData): void {
  canvas.requestPushHistory?.cancel?.();
  const current = canvas.history?.data?.[canvas.history.current];
  if (!current || historySignature(current) !== historySignature(data)) canvas.pushHistory?.(data);
}

function autoResizeHistoryInputs(node: CanvasNodeData): string | undefined {
  const inputs: Record<string, unknown> = { ...node };
  delete inputs.width;
  delete inputs.height;
  delete inputs.bcTextAlign;
  if (inputs.styleAttributes && typeof inputs.styleAttributes === "object" && !Array.isArray(inputs.styleAttributes)) {
    const attributes = { ...inputs.styleAttributes as Record<string, unknown> };
    delete attributes.textAlign;
    if (Object.keys(attributes).length) inputs.styleAttributes = attributes;
    else delete inputs.styleAttributes;
  }
  return historySignature(inputs);
}

/**
 * Merge only derived layout when history still describes its content/style
 * inputs. Pending user edits keep their own undo boundary and scheduled save.
 */
export function mergeAutoResizeIntoCurrentHistory(canvas: any, nodeId: string): boolean {
  const history = canvas?.history;
  const current = history?.data?.[history.current] as CanvasData | undefined;
  const live = readCanvasData(canvas);
  const node = live.nodes.find(item => item.id === nodeId);
  const stored = current?.nodes?.find(item => item.id === nodeId);
  if (!current || !node || !stored || node.type !== "text" || node.bcAutoResize !== true) return false;
  if (resolveCanvasTheme(current) !== resolveCanvasTheme(live)) return false;
  if (autoResizeHistoryInputs(node) !== autoResizeHistoryInputs(stored)) return false;
  const attributes = node.styleAttributes as Record<string, unknown>;
  const next = {
    ...stored,
    width: node.width,
    height: node.height,
    bcTextAlign: node.bcTextAlign,
    styleAttributes: { ...stored.styleAttributes as Record<string, unknown>, textAlign: attributes?.textAlign }
  };
  history.data[history.current] = {
    ...current,
    nodes: current.nodes.map(item => item.id === nodeId ? next : item)
  };
  return true;
}

/** Merge re-docking caused by automatic layout without creating an undo step. */
export function mergeFloatingSidesIntoCurrentHistory(canvas: any, beforeEdges: CanvasEdgeData[]): boolean {
  const history = canvas?.history;
  const current = history?.data?.[history.current] as CanvasData | undefined;
  const live = readCanvasData(canvas);
  if (!current || resolveCanvasTheme(current) !== resolveCanvasTheme(live)) return false;
  const beforeById = new Map(beforeEdges.map(edge => [edge.id, edge]));
  const liveById = new Map(live.edges.map(edge => [edge.id, edge]));
  const liveNodes = new Map(live.nodes.map(node => [node.id, node]));
  const storedNodes = new Map(current.nodes.map(node => [node.id, node]));
  let changed = false;
  const edges = current.edges.map(stored => {
    const before = beforeById.get(stored.id);
    const edge = liveById.get(stored.id);
    if (!before || !edge) return stored;
    if (historySignature(stored) !== historySignature(before)) return stored;
    // Sides calculated from pending node edits do not belong to older geometry.
    if ([before.fromNode, before.toNode].some(id =>
      !liveNodes.has(id) || !storedNodes.has(id) ||
      historySignature(liveNodes.get(id)) !== historySignature(storedNodes.get(id)))) return stored;
    const derived = {
      ...before,
      fromSide: before.fromFloating === true ? edge.fromSide : before.fromSide,
      toSide: before.toFloating === true ? edge.toSide : before.toSide
    };
    if (historySignature(derived) !== historySignature(edge)) return stored;
    const next = {
      ...stored,
      fromSide: before.fromFloating === true ? edge.fromSide : stored.fromSide,
      toSide: before.toFloating === true ? edge.toSide : stored.toSide
    };
    if (historySignature(next) === historySignature(stored)) return stored;
    changed = true;
    return next;
  });
  if (changed) history.data[history.current] = { ...current, edges };
  return changed;
}

export function setCanvasTheme(canvas: any, theme: CanvasThemeId): boolean {
  if (canvas?.readonly || canvas?.wrapperEl?.classList?.contains("bc-readonly")) return false;
  const before = readCanvasData(canvas);
  if (resolveCanvasTheme(before) === theme) return false;
  recordCanvasStyleHistory(canvas, before);
  canvas.data = withCanvasTheme(before, theme);
  canvas.requestSave?.(false);
  recordCanvasStyleHistory(canvas, readCanvasData(canvas));
  canvas.requestFrame?.();
  return true;
}

/** CSS owns the visual treatment; decoration never writes back to the file. */
export function decorateCanvasTheme(canvas: any): void {
  const data = readCanvasData(canvas);
  const theme = resolveCanvasTheme(data);
  const wrapper = canvas?.wrapperEl;
  if (wrapper?.dataset) {
    if (theme !== "default") wrapper.dataset.bcTheme = theme;
    else delete wrapper.dataset.bcTheme;
  }
  if (theme === "sketch") decorateSketchCanvas(canvas);
  else clearSketchCanvas(canvas);
  for (const item of data.nodes) {
    const node = canvas?.nodes?.get?.(item.id);
    const el = node?.nodeEl ?? node?.containerEl ?? node?.el;
    if (!el?.dataset) continue;
    if (theme === "soft-notes") decorateSoftNotesNode(el, item);
    else clearSoftNotesNode(el);
    if (theme === "research" && item.type !== "group") decorateResearchNode(el, item);
    else clearResearchNode(el);
    if (theme === "rounded-map") decorateRoundedMapNode(el, item);
    else clearRoundedMapNode(el);
    if (theme === "scrapbook") {
      el.dataset.bcPaper = item.type === "group" ? "group" : scrapbookPreset(item.bcScrapbookPreset);
      const attrs = item.styleAttributes as Record<string, unknown> | undefined;
      el.dataset.bcPaperBorder = typeof item.bcBorderStyle === "string" || typeof attrs?.border === "string"
        ? "explicit" : "theme";
    } else {
      delete el.dataset.bcPaper;
      delete el.dataset.bcPaperBorder;
    }
  }
}
