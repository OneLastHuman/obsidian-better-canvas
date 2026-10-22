import { readCanvasData, type CanvasData } from "./canvas";
import { clearSketchCanvas, decorateSketchCanvas } from "./sketch-renderer";

export type CanvasThemeId = "default" | "scrapbook" | "sketch";

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

/** Native importData updates nodes/edges only; the Canvas owns top-level data. */
export function recordCanvasStyleHistory(canvas: any, data: CanvasData): void {
  canvas.requestPushHistory?.cancel?.();
  const current = canvas.history?.data?.[canvas.history.current];
  if (!current || JSON.stringify(current) !== JSON.stringify(data)) canvas.pushHistory?.(data);
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
