import { describe, expect, it } from "vitest";
import { getMindMapEditingCreationShortcut, isMindMapShortcutEnabled } from "./mindmap-shortcuts";

describe("MindMap shortcut settings", () => {
  it("preserves legacy behavior when shortcut preferences are absent", () => {
    expect(isMindMapShortcutEnabled(undefined, "childTab")).toBe(true);
    expect(isMindMapShortcutEnabled({}, "siblingEnter")).toBe(true);
    expect(isMindMapShortcutEnabled(null, "navigateAltArrow")).toBe(true);
    expect(isMindMapShortcutEnabled({}, "directionalCtrlArrow")).toBe(true);
  });

  it("honors each explicit toggle independently", () => {
    const settings = {
      mindMapShortcutChildTabEnabled: false,
      mindMapShortcutSiblingEnterEnabled: true,
      mindMapShortcutAltArrowNavigationEnabled: false,
      mindMapShortcutDirectionalCreationEnabled: true
    };
    expect(isMindMapShortcutEnabled(settings, "childTab")).toBe(false);
    expect(isMindMapShortcutEnabled(settings, "siblingEnter")).toBe(true);
    expect(isMindMapShortcutEnabled(settings, "navigateAltArrow")).toBe(false);
    expect(isMindMapShortcutEnabled(settings, "directionalCtrlArrow")).toBe(true);
  });
});

describe("MindMap editing creation shortcuts", () => {
  const keyEvent = (
    key: string,
    modifiers: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}
  ) => ({
    key,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...modifiers
  });

  it("maps Shift+Tab and Shift+Enter to child and sibling creation", () => {
    expect(getMindMapEditingCreationShortcut(keyEvent("Tab"))).toBe("childTab");
    expect(getMindMapEditingCreationShortcut(keyEvent("Enter"))).toBe("siblingEnter");
  });

  it("leaves unmodified keys, other keys, and additional modifiers untouched", () => {
    expect(getMindMapEditingCreationShortcut(keyEvent("Tab", { shiftKey: false }))).toBeNull();
    expect(getMindMapEditingCreationShortcut(keyEvent("Enter", { shiftKey: false }))).toBeNull();
    expect(getMindMapEditingCreationShortcut(keyEvent("Escape"))).toBeNull();
    expect(getMindMapEditingCreationShortcut(keyEvent("Tab", { ctrlKey: true }))).toBeNull();
    expect(getMindMapEditingCreationShortcut(keyEvent("Enter", { metaKey: true }))).toBeNull();
    expect(getMindMapEditingCreationShortcut(keyEvent("Tab", { altKey: true }))).toBeNull();
  });
});
