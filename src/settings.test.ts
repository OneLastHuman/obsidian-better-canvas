import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  App: class {},
  Modal: class {},
  Notice: vi.fn(),
  Setting: class {},
  setIcon: vi.fn(),
  PluginSettingTab: class {
    constructor(public app: unknown) {}
    containerEl = { querySelectorAll: () => [], closest: () => null };
  }
}));

import type { App, Plugin } from "obsidian";
import BetterCanvasSettingsTab from "./settings";
import { settingsFixture } from "./settings-test-fixtures";

function setup() {
  const live = settingsFixture();
  const features = {
    settings: () => live,
    save: vi.fn(async () => {}),
    applySettings: vi.fn(),
    resetOnboardingSettings: () => live.onboarding,
    probeProviderCapabilities: vi.fn(async () => { throw new Error("Unexpected capability probe"); })
  };
  const tab = new BetterCanvasSettingsTab({} as App, { manifest: { id: "better-canvas" } } as Plugin, features);
  tab.update = vi.fn();
  tab["currentSettings"]();
  return { live, features, tab };
}

describe("settings draft lifecycle", () => {
  it("returns to the question only after an explicit click and consumes the callback once", async () => {
    const { tab } = setup();
    const onReturn = vi.fn();
    tab.openAISection({ onReturn });
    tab["currentSettings"]().gapX = 190;
    await tab["markDirty"]();
    tab["returnToQuestion"]();
    expect(onReturn).not.toHaveBeenCalled();
    await tab["saveDraftSettings"]();
    expect(onReturn).not.toHaveBeenCalled();
    tab["returnToQuestion"]();
    tab["returnToQuestion"]();
    tab.hide();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("closing settings does not automatically reopen the question", () => {
    const { tab } = setup();
    const onReturn = vi.fn();
    tab.openAISection({ onReturn });
    tab.hide();
    tab["returnToQuestion"]();
    expect(onReturn).not.toHaveBeenCalled();
  });

  it("saves only edited fields and preserves records updated while settings are open", async () => {
    const { live, features, tab } = setup();
    tab["currentSettings"]().gapX = 180;
    await tab["markDirty"]();
    expect(live.gapX).toBe(100);
    live.aiUsageRecords.push({ id: "new-background-record" });
    live.modelCapabilityReports.newReport = { profileId: "default", profileName: "Test", protocol: "openai", model: "test-model", testedAt: "2026-01-01", text: { status: "accepted" }, imageInput: { status: "not-run" }, note: "" };
    await tab["saveDraftSettings"]();
    expect(live.gapX).toBe(180);
    expect(live.aiUsageRecords).toEqual([{ id: "new-background-record" }]);
    expect(live.modelCapabilityReports.newReport.text.status).toBe("accepted");
    expect(live.templates).toEqual([{ name: "Old template", text: "Keep for recovery" }]);
    expect(live.defaultNodeWidth).toBe(900);
    expect(live.customCss).toBe(".old-style {}");
    expect(features.save).toHaveBeenCalledOnce();
    expect(features.applySettings).toHaveBeenCalledOnce();
    expect(tab["hasUnsavedChanges"]).toBe(false);
  });

  it("rolls back live values after a failed save while retaining the draft for retry", async () => {
    const { live, features, tab } = setup();
    tab["currentSettings"]().direction = "TB";
    await tab["markDirty"]();
    features.save.mockRejectedValueOnce(new Error("disk full"));
    await tab["saveDraftSettings"]();
    expect(live.direction).toBe("LR");
    expect(tab["currentSettings"]().direction).toBe("TB");
    expect(tab["hasUnsavedChanges"]).toBe(true);
    expect(tab["isSaving"]).toBe(false);
    expect(features.applySettings).not.toHaveBeenCalled();
    await tab["saveDraftSettings"]();
    expect(live.direction).toBe("TB");
    expect(tab["hasUnsavedChanges"]).toBe(false);
  });

  it("discards the entire draft and reloads the latest live settings", async () => {
    const { live, features, tab } = setup();
    tab["currentSettings"]().gapX = 200;
    await tab["markDirty"]();
    live.aiUsageRecords.push({ id: "while-editing" });
    tab["discardChanges"]();
    expect(tab["currentSettings"]().gapX).toBe(100);
    expect(tab["currentSettings"]()).toMatchObject({ aiUsageRecords: [{ id: "while-editing" }] });
    expect(tab["hasUnsavedChanges"]).toBe(false);
    expect(features.save).not.toHaveBeenCalled();
  });

  it("clears the dirty state when the user restores the original value", async () => {
    const { tab } = setup();
    tab["currentSettings"]().gapX = 160;
    await tab["markDirty"]();
    expect(tab["hasUnsavedChanges"]).toBe(true);
    tab["currentSettings"]().gapX = 100;
    await tab["markDirty"]();
    expect(tab["hasUnsavedChanges"]).toBe(false);
  });

  it("does not duplicate a pending save or discard its in-flight draft", async () => {
    const { tab, features } = setup();
    let complete!: () => void;
    features.save.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    tab["currentSettings"]().gapX = 200;
    await tab["markDirty"]();
    const saving = tab["saveDraftSettings"]();
    await tab["saveDraftSettings"]();
    tab["discardChanges"]();
    expect(tab["currentSettings"]().gapX).toBe(200);
    expect(features.save).toHaveBeenCalledOnce();
    complete();
    await saving;
    expect(tab["isSaving"]).toBe(false);
  });

  it("keeps persisted settings when applying them fails", async () => {
    const { live, tab, features } = setup();
    tab["currentSettings"]().gapX = 180;
    await tab["markDirty"]();
    features.applySettings.mockImplementationOnce(() => { throw new Error("host unavailable"); });
    await tab["saveDraftSettings"]();
    expect(live.gapX).toBe(180);
    expect(tab["hasUnsavedChanges"]).toBe(false);
  });

  it("reads the latest saved settings after background search indexing", () => {
    const { live, tab } = setup();
    tab.getSettingDefinitions();
    live.gapX = 240;
    tab.getSettingDefinitions();
    expect(tab["currentSettings"]().gapX).toBe(240);
  });

  it("retains pending edits when search definitions are refreshed", async () => {
    const { live, tab } = setup();
    tab.getSettingDefinitions();
    tab["currentSettings"]().gapX = 180;
    await tab["markDirty"]();
    live.gapX = 240;
    tab.getSettingDefinitions();
    expect(tab["currentSettings"]().gapX).toBe(180);
    expect(tab["hasUnsavedChanges"]).toBe(true);
  });
});
