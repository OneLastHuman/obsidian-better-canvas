export type MindMapShortcut =
  | "childTab"
  | "siblingEnter"
  | "navigateAltArrow"
  | "directionalCtrlArrow";

export type MindMapShortcutSettings = Partial<Record<
  "mindMapShortcutChildTabEnabled" |
  "mindMapShortcutSiblingEnterEnabled" |
  "mindMapShortcutAltArrowNavigationEnabled" |
  "mindMapShortcutDirectionalCreationEnabled",
  boolean
>>;

const settingKeys: Record<MindMapShortcut, keyof MindMapShortcutSettings> = {
  childTab: "mindMapShortcutChildTabEnabled",
  siblingEnter: "mindMapShortcutSiblingEnterEnabled",
  navigateAltArrow: "mindMapShortcutAltArrowNavigationEnabled",
  directionalCtrlArrow: "mindMapShortcutDirectionalCreationEnabled"
};

/**
 * Legacy settings that predate these toggles keep the previous default behavior.
 */
export function isMindMapShortcutEnabled(
  settings: MindMapShortcutSettings | null | undefined,
  shortcut: MindMapShortcut
): boolean {
  const key = settingKeys[shortcut];
  const value = settings?.[key];
  return typeof value === "boolean" ? value : true;
}

export type MindMapEditingCreationShortcut = Extract<MindMapShortcut, "childTab" | "siblingEnter">;

/**
 * Maps Shift+Tab and Shift+Enter while a Canvas node is being edited.
 * Other modifiers are left to the host editor and other plugins.
 */
export function getMindMapEditingCreationShortcut(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): MindMapEditingCreationShortcut | null {
  if (event.isComposing) return null;
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Tab") return "childTab";
  if (event.key === "Enter") return "siblingEnter";
  return null;
}
