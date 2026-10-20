export type NodeAIContextActionId = "ask" | "image" | "flashcards" | "regenerate";

export interface NodeAIContextMenuAction {
  id: NodeAIContextActionId;
  title: string;
  icon: string;
}

const BASE_ACTIONS: NodeAIContextMenuAction[] = [
  { id: "ask", title: "问 AI", icon: "sparkles" },
  { id: "image", title: "生成图片", icon: "image" },
  { id: "flashcards", title: "生成闪卡", icon: "graduation-cap" }
];

const REGENERATE_ACTION: NodeAIContextMenuAction = {
  id: "regenerate",
  title: "重生成",
  icon: "refresh-cw"
};

/** List the AI actions available from a Canvas node context menu. */
export function getNodeAIContextMenuActions(isGeneratedAI: boolean): NodeAIContextMenuAction[] {
  return isGeneratedAI
    ? [...BASE_ACTIONS, REGENERATE_ACTION]
    : [...BASE_ACTIONS];
}
