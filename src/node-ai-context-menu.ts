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

export interface NodeAIContextMenuItem {
  setTitle(title: string): NodeAIContextMenuItem;
  setIcon(icon: string): NodeAIContextMenuItem;
  onClick(callback: () => void): NodeAIContextMenuItem;
}

export interface NodeAIContextMenu {
  addItem(callback: (item: NodeAIContextMenuItem) => void): void;
  addSeparator?(): void;
}

/** List the AI actions available from a Canvas node context menu. */
export function getNodeAIContextMenuActions(isGeneratedAI: boolean): NodeAIContextMenuAction[] {
  return isGeneratedAI
    ? [...BASE_ACTIONS, REGENERATE_ACTION]
    : [...BASE_ACTIONS];
}

/**
 * Add the AI action group to a Canvas node menu. Obsidian already inserts a
 * separator before plugin-contributed node actions, so only the trailing
 * separator belongs here.
 */
export function addNodeAIContextMenuItems(
  menu: NodeAIContextMenu,
  isGeneratedAI: boolean,
  onAction: (id: NodeAIContextActionId) => void
): void {
  for (const action of getNodeAIContextMenuActions(isGeneratedAI)) {
    menu.addItem(item => item
      .setTitle(action.title)
      .setIcon(action.icon)
      .onClick(() => onAction(action.id)));
  }
  menu.addSeparator?.();
}
