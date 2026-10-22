import type { CanvasData, CanvasNodeData } from "./canvas";

export const RESEARCH_COLORS = [
  { id: "clay", label: "陶土红", value: "#a84e34" },
  { id: "gold", label: "麦穗黄", value: "#b48a28" },
  { id: "blue", label: "雾蓝", value: "#416879" },
  { id: "olive", label: "橄榄绿", value: "#63734a" },
  { id: "rose", label: "莓果灰", value: "#9a5662" }
] as const;

export const RESEARCH_PRESETS = [
  { id: "source", label: "文献资料", detail: "装订色边、内框与标题分隔线", color: "#a84e34", shape: "square", border: "solid" },
  { id: "quote", label: "重点引文", detail: "暖黄纸面、引用衬底与底部强调线", color: "#b48a28", shape: "square", border: "solid" },
  { id: "annotation", label: "阅读批注", detail: "雾蓝横线纸与左侧页边线", color: "#416879", shape: "square", border: "solid" },
  { id: "argument", label: "核心观点", detail: "深色标题带与正文重点强调", color: "#63734a", shape: "square", border: "solid" },
  { id: "question", label: "待解问题", detail: "圆角虚线框与标题分隔线", color: "#63734a", shape: "default", border: "dashed" },
  { id: "section", label: "章节标题", detail: "开放版式、顶端横线与标题色带", color: "#416879", shape: "square", border: "invisible" }
] as const;

export type ResearchPreset = (typeof RESEARCH_PRESETS)[number];
export const RESEARCH_INTENSITIES = [
  { value: 15, label: "柔和" }, { value: 26, label: "标准" }, { value: 40, label: "浓郁" }
] as const;
export const RESEARCH_SERIF = '"Songti SC", "Noto Serif CJK SC", "STSong", "SimSun", serif';

export function researchPreset(value: unknown): ResearchPreset {
  return RESEARCH_PRESETS.find(preset => preset.id === value) ?? RESEARCH_PRESETS[0];
}

export function researchIntensity(value: unknown): number {
  return RESEARCH_INTENSITIES.some(item => item.value === value) ? Number(value) : 26;
}

/** Native palette IDs and safe hex colours share the same ink in DOM and SVG. */
export function researchColor(node: CanvasNodeData): string {
  const palette: Record<string, string> = {
    "1": "#a84e34", "2": "#b47639", "3": "#b48a28",
    "4": "#63734a", "5": "#416879", "6": "#9a5662"
  };
  const value = typeof node.color === "string" ? node.color.trim() : "";
  if (palette[value]) return palette[value];
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map(char => char + char).join("");
  return researchPreset(node.bcResearchPreset).color;
}

export function researchFill(node: CanvasNodeData): string {
  const preset = researchPreset(node.bcResearchPreset);
  if (preset.id === "section") return "none";
  if (preset.id === "source" || preset.id === "argument") return "#fffdf7";
  const base = preset.id === "quote" ? "#fff4b9" : "#fffdf7";
  const amount = researchIntensity(node.bcResearchIntensity) / (preset.id === "question" ? 200 : 100);
  const ink = researchColor(node);
  return "#" + [1, 3, 5].map(offset => Math.round(
    parseInt(ink.slice(offset, offset + 2), 16) * amount +
    parseInt(base.slice(offset, offset + 2), 16) * (1 - amount)
  ).toString(16).padStart(2, "0")).join("");
}

export function applyResearchPreset(data: CanvasData, ids: readonly string[], presetId: string): { data: CanvasData; updated: number } {
  const preset = RESEARCH_PRESETS.find(item => item.id === presetId);
  if (!preset) return { data, updated: 0 };
  return updateResearchNodes(data, ids, node => {
    const attrs = node.styleAttributes && typeof node.styleAttributes === "object" && !Array.isArray(node.styleAttributes)
      ? node.styleAttributes as Record<string, unknown> : {};
    return {
      ...node,
      bcResearchPreset: preset.id,
      color: preset.color,
      bcShape: preset.shape,
      bcBorderStyle: preset.border,
      bcTextAlign: "left",
      styleAttributes: {
        ...attrs, shape: preset.shape === "square" ? "rectangle" : preset.shape,
        border: preset.border, textAlign: "left"
      }
    };
  });
}

export function applyResearchIntensity(data: CanvasData, ids: readonly string[], intensity: number): { data: CanvasData; updated: number } {
  if (!RESEARCH_INTENSITIES.some(item => item.value === intensity)) return { data, updated: 0 };
  return updateResearchNodes(data, ids, node => ({ ...node, bcResearchIntensity: intensity }));
}

function updateResearchNodes(data: CanvasData, ids: readonly string[], update: (node: CanvasNodeData) => CanvasNodeData): { data: CanvasData; updated: number } {
  const targets = new Set(ids);
  let updated = 0;
  const nodes = data.nodes.map(node => {
    if (!targets.has(node.id) || node.type === "group") return node;
    updated++;
    return update(node);
  });
  return { data: updated ? { ...data, nodes } : data, updated };
}

export function clearResearchNode(element: HTMLElement): void {
  if (!element.dataset.bcResearchPreset) return;
  delete element.dataset.bcResearchPreset;
  for (const name of ["--bc-research-accent", "--bc-research-fill"]) element.style?.removeProperty(name);
}

export function decorateResearchNode(element: HTMLElement, node: CanvasNodeData): void {
  element.dataset.bcResearchPreset = researchPreset(node.bcResearchPreset).id;
  element.style?.setProperty("--bc-research-accent", researchColor(node));
  element.style?.setProperty("--bc-research-fill", researchFill(node) === "none" ? "transparent" : researchFill(node));
}
