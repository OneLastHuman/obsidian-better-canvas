export type NodeAIContextActionId = "ask" | "image" | "flashcards" | "model" | "regenerate";

export interface NodeAIContextMenuAction {
  id: NodeAIContextActionId;
  title: string;
  icon: string;
}

const BASE_ACTIONS: NodeAIContextMenuAction[] = [
  { id: "ask", title: "Better Canvas: 向 AI 提问", icon: "sparkles" },
  { id: "image", title: "Better Canvas: 根据此节点生成图片", icon: "image" },
  { id: "flashcards", title: "Better Canvas: 生成复习闪卡", icon: "graduation-cap" },
  { id: "model", title: "Better Canvas: 选择 AI 模型", icon: "bot" }
];

const REGENERATE_ACTION: NodeAIContextMenuAction = {
  id: "regenerate",
  title: "Better Canvas: 重新生成 AI 节点",
  icon: "refresh-cw"
};

/** List the AI actions available from a Canvas node context menu. */
export function getNodeAIContextMenuActions(isGeneratedAI: boolean): NodeAIContextMenuAction[] {
  return isGeneratedAI
    ? [...BASE_ACTIONS, REGENERATE_ACTION]
    : [...BASE_ACTIONS];
}
