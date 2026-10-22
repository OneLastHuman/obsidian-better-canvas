import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class {},
  Modal: class {},
  Notice: vi.fn(),
  Setting: class {},
  setIcon: vi.fn(),
  PluginSettingTab: class {
    containerEl = { querySelector: () => null };
  }
}));

import { Notice } from "obsidian";
import BetterCanvasSettingsTab from "./settings";

function setup() {
  const live: Record<string, any> = {
    gapX: 100,
    direction: "LR",
    defaultNodeWidth: 900,
    customCss: ".old-style {}",
    templates: [{ name: "Old template", text: "Keep for recovery" }],
    aiUsageRecords: [],
    modelCapabilityReports: {}
  };
  const features = {
    settings: () => live,
    save: vi.fn(async () => {}),
    applySettings: vi.fn()
  };
  const tab = new BetterCanvasSettingsTab({} as any, {} as any, features) as any;
  tab.display = vi.fn();
  tab.currentSettings();
  return { live, features, tab };
}

describe("settings draft lifecycle", () => {
  it("saves only edited fields and preserves records updated while settings are open", async () => {
    const { live, features, tab } = setup();
    tab.currentSettings().gapX = 180;
    await tab.markDirty();
    expect(live.gapX).toBe(100);
    live.aiUsageRecords.push({ id: "new-background-record" });
    live.modelCapabilityReports.newReport = { text: "accepted" };
    await tab.saveDraftSettings();
    expect(live.gapX).toBe(180);
    expect(live.aiUsageRecords).toEqual([{ id: "new-background-record" }]);
    expect(live.modelCapabilityReports.newReport).toEqual({ text: "accepted" });
    expect(live.templates).toEqual([{ name: "Old template", text: "Keep for recovery" }]);
    expect(live.defaultNodeWidth).toBe(900);
    expect(live.customCss).toBe(".old-style {}");
    expect(features.save).toHaveBeenCalledOnce();
    expect(features.applySettings).toHaveBeenCalledOnce();
    expect(tab.hasUnsavedChanges).toBe(false);
  });

  it("rolls back live values after a failed save while retaining the draft for retry", async () => {
    const { live, features, tab } = setup();
    tab.currentSettings().direction = "TB";
    await tab.markDirty();
    features.save.mockRejectedValueOnce(new Error("disk full"));
    await tab.saveDraftSettings();
    expect(live.direction).toBe("LR");
    expect(tab.currentSettings().direction).toBe("TB");
    expect(tab.hasUnsavedChanges).toBe(true);
    expect(tab.isSaving).toBe(false);
    expect(features.applySettings).not.toHaveBeenCalled();
    await tab.saveDraftSettings();
    expect(live.direction).toBe("TB");
    expect(tab.hasUnsavedChanges).toBe(false);
  });

  it("discards the entire draft and reloads the latest live settings", async () => {
    const { live, features, tab } = setup();
    tab.currentSettings().gapX = 200;
    await tab.markDirty();
    live.aiUsageRecords.push({ id: "while-editing" });
    tab.discardChanges();
    expect(tab.currentSettings().gapX).toBe(100);
    expect(tab.currentSettings().aiUsageRecords).toEqual([{ id: "while-editing" }]);
    expect(tab.hasUnsavedChanges).toBe(false);
    expect(features.save).not.toHaveBeenCalled();
  });

  it("clears the dirty state when the user restores the original value", async () => {
    const { tab } = setup();
    tab.currentSettings().gapX = 160;
    await tab.markDirty();
    expect(tab.hasUnsavedChanges).toBe(true);
    tab.currentSettings().gapX = 100;
    await tab.markDirty();
    expect(tab.hasUnsavedChanges).toBe(false);
  });

  it("does not duplicate a pending save or discard its in-flight draft", async () => {
    const { tab, features } = setup();
    let complete!: () => void;
    features.save.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    tab.currentSettings().gapX = 200;
    await tab.markDirty();
    const saving = tab.saveDraftSettings();
    await tab.saveDraftSettings();
    tab.discardChanges();
    expect(tab.currentSettings().gapX).toBe(200);
    expect(features.save).toHaveBeenCalledOnce();
    complete();
    await saving;
    expect(tab.isSaving).toBe(false);
  });

  it("reports application failure without pretending the persisted save failed", async () => {
    const { live, tab, features } = setup();
    tab.currentSettings().gapX = 180;
    await tab.markDirty();
    features.applySettings.mockImplementationOnce(() => { throw new Error("host unavailable"); });
    await tab.saveDraftSettings();
    expect(live.gapX).toBe(180);
    expect(tab.hasUnsavedChanges).toBe(false);
    expect(Notice).toHaveBeenCalledWith(expect.stringContaining("设置已保存，但部分更改未能立即应用"), 8000);
  });
});
