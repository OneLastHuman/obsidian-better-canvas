import { describe, expect, it } from "vitest";
import { isMindMapShortcutEnabled } from "./mindmap-shortcuts";

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
