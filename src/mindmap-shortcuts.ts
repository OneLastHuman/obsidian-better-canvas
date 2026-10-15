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
