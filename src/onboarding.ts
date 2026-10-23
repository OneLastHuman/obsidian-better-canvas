import { normalizePath, type App, type TFile } from "obsidian";
import { joinVaultPath } from "./vault-path";

export type OnboardingWelcomeState = "unseen" | "completed" | "skipped";
export type OnboardingEmptyTipState = "unseen" | "dismissed";

export interface OnboardingState {
  welcome: OnboardingWelcomeState;
  emptyTip: OnboardingEmptyTipState;
  exampleCanvasPath: string;
  updatedAt: string;
}

export interface OnboardingSettings {
  onboarding?: Partial<OnboardingState>;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  welcome: "unseen",
  emptyTip: "unseen",
  exampleCanvasPath: "",
  updatedAt: ""
};

export const ONBOARDING_CANVAS_FOLDER = "Better Canvas";
export const ONBOARDING_CANVAS_BASENAME = "快速入门";

export function normalizeOnboardingState(value: unknown): OnboardingState {
  const raw = value && typeof value === "object" ? value as Partial<OnboardingState> : {};
  return {
    welcome: raw.welcome === "completed" || raw.welcome === "skipped" ? raw.welcome : "unseen",
    emptyTip: raw.emptyTip === "dismissed" ? "dismissed" : "unseen",
    exampleCanvasPath: typeof raw.exampleCanvasPath === "string" ? raw.exampleCanvasPath.trim() : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ""
  };
}

export function shouldAutoOpenWelcome(settings: OnboardingSettings): boolean {
  return normalizeOnboardingState(settings.onboarding).welcome === "unseen";
}

export function shouldShowEmptyTip(settings: OnboardingSettings): boolean {
  return normalizeOnboardingState(settings.onboarding).emptyTip === "unseen";
}

export function completeWelcome(
  state: OnboardingState,
  result: "completed" | "skipped",
  exampleCanvasPath = state.exampleCanvasPath,
  now = new Date()
): OnboardingState {
  return {
    ...state,
    welcome: result,
    exampleCanvasPath: exampleCanvasPath.trim(),
    updatedAt: now.toISOString()
  };
}

export function dismissEmptyTip(state: OnboardingState, now = new Date()): OnboardingState {
  return { ...state, emptyTip: "dismissed", updatedAt: now.toISOString() };
}

export function resetOnboardingState(now = new Date()): OnboardingState {
  return { ...DEFAULT_ONBOARDING_STATE, updatedAt: now.toISOString() };
}

/** Returns a Vault-relative .canvas path that is not currently occupied. */
export function uniqueCanvasPath(
  folder: string,
  basename: string,
  occupiedPaths: Iterable<string>
): string {
  const occupied = new Set([...occupiedPaths].map(path => path.toLocaleLowerCase()));
  const safeBase = basename.trim() || ONBOARDING_CANVAS_BASENAME;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? safeBase + ".canvas" : safeBase + " " + suffix + ".canvas";
    const path = normalizePath(joinVaultPath(folder, name));
    if (!occupied.has(path.toLocaleLowerCase())) return path;
  }
}

export function exampleCanvasPathFromState(state: OnboardingState): string {
  return state.exampleCanvasPath.trim();
}

export function existingExampleCanvas(app: App, state: OnboardingState): TFile | null {
  const path = exampleCanvasPathFromState(state);
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(path) as TFile | null;
  return file && file.extension?.toLocaleLowerCase() === "canvas" ? file : null;
}

export interface ExampleCanvasNode {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color?: string;
  bcAutoResize?: boolean;
}

export interface ExampleCanvasEdge {
  id: string;
  fromNode: string;
  fromSide: string;
  toNode: string;
  toSide: string;
  toEnd?: string;
}

export interface ExampleCanvasData {
  bcTheme: string;
  nodes: ExampleCanvasNode[];
  edges: ExampleCanvasEdge[];
}

export const EXAMPLE_CANVAS: ExampleCanvasData = {
  bcTheme: "default",
  nodes: [
    {
      id: "welcome",
      type: "text",
      x: 340,
      y: 210,
      width: 380,
      height: 200,
      text: "# 把想法放在一起\n\n这是一张可以编辑的示例画布。\n双击文字，换成你自己的内容。",
      color: "#f1d9a8",
      bcAutoResize: false
    },
    {
      id: "idea",
      type: "text",
      x: 0,
      y: 20,
      width: 260,
      height: 150,
      text: "## 一个念头\n\n先写下来，\n再慢慢整理。",
      color: "#c9e7d4",
      bcAutoResize: false
    },
    {
      id: "question",
      type: "text",
      x: 0,
      y: 430,
      width: 260,
      height: 150,
      text: "## 留下问题\n\n哪一件事\n值得先做？",
      color: "#f4d2c3",
      bcAutoResize: false
    },
    {
      id: "theme",
      type: "text",
      x: 820,
      y: 20,
      width: 260,
      height: 135,
      text: "## 试试画布主题\n\n点击画布右侧的主题入口。",
      color: "#c9dceb",
      bcAutoResize: false
    },
    {
      id: "style",
      type: "text",
      x: 820,
      y: 205,
      width: 260,
      height: 135,
      text: "## 试试节点样式\n\n选中卡片，再打开节点样式。",
      color: "#d7d0ea",
      bcAutoResize: false
    },
    {
      id: "next",
      type: "text",
      x: 340,
      y: 500,
      width: 380,
      height: 150,
      text: "## 下一步\n\n按 Tab 创建子卡片。\n按 Enter 创建同级卡片。",
      color: "#f0e2ad",
      bcAutoResize: false
    }
  ],
  edges: [
    { id: "idea-welcome", fromNode: "idea", fromSide: "right", toNode: "welcome", toSide: "left", toEnd: "arrow" },
    { id: "question-welcome", fromNode: "question", fromSide: "right", toNode: "welcome", toSide: "left", toEnd: "arrow" },
    { id: "welcome-theme", fromNode: "welcome", fromSide: "right", toNode: "theme", toSide: "left", toEnd: "arrow" },
    { id: "welcome-style", fromNode: "welcome", fromSide: "right", toNode: "style", toSide: "left", toEnd: "arrow" },
    { id: "welcome-next", fromNode: "welcome", fromSide: "bottom", toNode: "next", toSide: "top", toEnd: "arrow" }
  ]
};

export function serializeExampleCanvas(data: ExampleCanvasData = EXAMPLE_CANVAS): string {
  return JSON.stringify(data, null, 2) + "\n";
}

export function nextExampleCanvasPath(
  app: App,
  folder = ONBOARDING_CANVAS_FOLDER,
  basename = ONBOARDING_CANVAS_BASENAME
): string {
  const occupied = app.vault.getAllLoadedFiles().map(file => file.path);
  return uniqueCanvasPath(folder, basename, occupied);
}

export async function ensureVaultFolder(app: App, folder: string): Promise<void> {
  const clean = normalizePath(folder).replace(/^\/+|\/+$/g, "");
  if (!clean) return;
  let current = "";
  for (const part of clean.split("/")) {
    current = current ? current + "/" + part : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

export interface CreateExampleCanvasResult {
  file: TFile;
  created: boolean;
}

export async function createExampleCanvas(
  app: App,
  state: OnboardingState
): Promise<CreateExampleCanvasResult> {
  const existing = existingExampleCanvas(app, state);
  if (existing) return { file: existing, created: false };

  await ensureVaultFolder(app, ONBOARDING_CANVAS_FOLDER);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const path = nextExampleCanvasPath(app);
    try {
      const file = await app.vault.create(path, serializeExampleCanvas());
      return { file, created: true };
    } catch (error) {
      // Another process may create the same name between lookup and write.
      if (!app.vault.getAbstractFileByPath(path) || attempt === 19) throw error;
    }
  }
  throw new Error("无法创建不重名的示例画布。");
}

export function openCanvasFile(app: App, file: TFile): Promise<void> {
  return app.workspace.openLinkText(file.path, "", false);
}
