import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAgentBackend, LocalModelOption } from "./local-agent-settings";

const host = vi.hoisted(() => {
  class Element {
    text = "";
    children: Element[] = [];
    classes: string[] = [];
    querySelector() { return null; }
    createDiv() {
      const child = new Element();
      this.children.push(child);
      return child;
    }
    setText(text: string) { this.text = text; }
    addClass(cls: string) { this.classes.push(cls); }
    empty() { this.text = ""; this.children.length = 0; }
  }

  class Dropdown {
    options = new Map<string, string>();
    value = "";
    disabled = false;
    handler?: (value: string) => unknown;
    selectEl = Object.assign(new Element(), {
      empty: () => { this.options.clear(); this.value = ""; }
    });
    addOption(value: string, label: string) { this.options.set(value, label); return this; }
    setValue(value: string) { this.value = this.options.has(value) ? value : ""; return this; }
    setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
    onChange(handler: (value: string) => unknown) { this.handler = handler; return this; }
    async change(value: string) {
      if (this.disabled || !this.options.has(value)) throw new Error("Unavailable dropdown option: " + value);
      this.value = value;
      await this.handler?.(value);
    }
  }

  class Text {
    value = "";
    placeholder = "";
    handler?: (value: string) => unknown;
    setValue(value: string) { this.value = value; return this; }
    setPlaceholder(value: string) { this.placeholder = value; return this; }
    onChange(handler: (value: string) => unknown) { this.handler = handler; return this; }
    async change(value: string) { this.value = value; await this.handler?.(value); }
  }

  class Button {
    text = "";
    disabled = false;
    handler?: () => unknown;
    setButtonText(text: string) { this.text = text; return this; }
    setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
    onClick(handler: () => unknown) { this.handler = handler; return this; }
    async click() {
      if (this.disabled) throw new Error("Button is disabled");
      await this.handler?.();
    }
  }

  const rows: Setting[] = [];
  class Setting {
    name = "";
    description = "";
    descEl = new Element();
    dropdown?: Dropdown;
    texts: Text[] = [];
    buttons: Button[] = [];
    settingEl = new Element();
    constructor(_container: unknown) { rows.push(this); }
    setName(name: string) { this.name = name; return this; }
    setDesc(description: string) { this.description = description; return this; }
    addDropdown(callback: (dropdown: Dropdown) => unknown) {
      this.dropdown = new Dropdown();
      callback(this.dropdown);
      return this;
    }
    addText(callback: (text: Text) => unknown) {
      const text = new Text();
      this.texts.push(text);
      callback(text);
      return this;
    }
    addButton(callback: (button: Button) => unknown) {
      const button = new Button();
      this.buttons.push(button);
      callback(button);
      return this;
    }
  }

  return {
    rows,
    Element,
    Platform: { isDesktopApp: true },
    exports: {
      App: class {},
      Modal: class {},
      Notice: vi.fn(),
      Setting,
      SettingGroup: undefined,
      setIcon: vi.fn(),
      PluginSettingTab: class { containerEl = new Element(); }
    }
  };
});

vi.mock("obsidian", () => ({ ...host.exports, Platform: host.Platform }));
vi.mock("./codex-models", () => ({ listCodexModels: vi.fn() }));
vi.mock("./opencode-acp", () => ({ listOpenCodeModels: vi.fn() }));

import { listCodexModels } from "./codex-models";
import { listOpenCodeModels } from "./opencode-acp";
import BetterCanvasSettingsTab from "./settings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(extra: Record<string, unknown> = {}) {
  const live: Record<string, any> = {
    backend: "codex-cli",
    codexBinaryPath: "/tools/codex",
    codexModel: "",
    opencodeBinaryPath: "/tools/opencode",
    opencodeModel: "",
    localAgents: {
      "gemini-cli": { binaryPath: "/tools/gemini", model: "retained-gemini" }
    },
    aiUsageRecords: [],
    ...extra
  };
  const features = {
    settings: () => live,
    save: vi.fn(async () => {}),
    applySettings: vi.fn()
  };
  const tab = new BetterCanvasSettingsTab({} as any, {} as any, features) as any;
  tab.display = vi.fn();
  tab.details = vi.fn(() => new host.Element());

  function render(backend: LocalAgentBackend = "codex-cli") {
    const index = host.rows.length;
    tab.renderLocalAgentSettings(new host.Element(), new host.Element(), backend);
    const rows = host.rows.slice(index);
    const modelRow = rows.find(row => row.dropdown)!;
    const texts = rows.flatMap(row => row.texts);
    return {
      rows,
      model: modelRow.dropdown!,
      read: modelRow.buttons[0],
      feedback: modelRow.descEl.children[0],
      path: texts[0],
      manual: texts[1]
    };
  }

  return { tab, features, live, render };
}

beforeEach(() => {
  vi.clearAllMocks();
  host.rows.length = 0;
  host.Platform.isDesktopApp = true;
});

describe("local agent settings model picker", () => {
  it.each(["codex-cli", "opencode-acp"] as const)(
    "reads %s models only after an explicit click and retains the default selection",
    async backend => {
      const loader = backend === "codex-cli" ? listCodexModels : listOpenCodeModels;
      vi.mocked(loader).mockResolvedValue([
        { id: "provider/first", name: "First" },
        { id: "provider/second", name: "Second" }
      ]);
      const { render, tab, features } = setup();
      const ui = render(backend);
      expect(listCodexModels).not.toHaveBeenCalled();
      expect(listOpenCodeModels).not.toHaveBeenCalled();
      expect([...ui.model.options.keys()]).toEqual([""]);

      await ui.read.click();

      expect(loader).toHaveBeenCalledWith({
        binaryPath: backend === "codex-cli" ? "/tools/codex" : "/tools/opencode",
        timeoutMs: 15_000,
        signal: expect.any(AbortSignal)
      });
      expect([...ui.model.options.keys()]).toEqual(["", "provider/first", "provider/second"]);
      expect(ui.model.options.get("provider/first")).toContain("First");
      expect(ui.model.options.get("provider/first")).toContain("provider/first");
      expect(ui.model.value).toBe("");
      expect(ui.read.disabled).toBe(false);
      expect(ui.feedback.text).toContain("2");
      expect(tab.hasUnsavedChanges).toBe(false);
      expect(features.save).not.toHaveBeenCalled();
    }
  );

  it("keeps the saved custom model selectable when it is missing from a refreshed catalog", async () => {
    vi.mocked(listCodexModels).mockResolvedValue([{ id: "listed", name: "Listed" }]);
    const { render, live } = setup({ codexModel: "custom/unlisted" });
    const ui = render();
    expect(ui.model.value).toBe("custom/unlisted");
    await ui.read.click();
    expect([...ui.model.options.keys()]).toEqual(["", "listed", "custom/unlisted"]);
    expect(ui.model.value).toBe("custom/unlisted");
    expect(live.codexModel).toBe("custom/unlisted");
  });

  it("isolates cached catalogs by both backend and executable path", async () => {
    vi.mocked(listCodexModels).mockResolvedValue([{ id: "codex-only", name: "Codex" }]);
    vi.mocked(listOpenCodeModels).mockResolvedValue([{ id: "acp-only", name: "ACP" }]);
    const { render } = setup({ codexBinaryPath: "/tools/shared", opencodeBinaryPath: "/tools/shared" });
    await render("codex-cli").read.click();
    await render("opencode-acp").read.click();
    const codex = render("codex-cli");
    const opencode = render("opencode-acp");
    expect([...codex.model.options.keys()]).toEqual(["", "codex-only"]);
    expect([...opencode.model.options.keys()]).toEqual(["", "acp-only"]);
    expect(listCodexModels).toHaveBeenCalledOnce();
    expect(listOpenCodeModels).toHaveBeenCalledOnce();

    await codex.path.change("/tools/another-codex");
    expect([...codex.model.options.keys()]).toEqual([""]);
    expect([...opencode.model.options.keys()]).toEqual(["", "acp-only"]);
    await codex.path.change("/tools/shared");
    expect([...codex.model.options.keys()]).toEqual(["", "codex-only"]);
    expect(listCodexModels).toHaveBeenCalledOnce();
  });

  it("preserves the selected model and previous catalog when a refresh fails", async () => {
    vi.mocked(listCodexModels).mockResolvedValueOnce([{ id: "listed", name: "Listed" }]);
    vi.mocked(listCodexModels).mockRejectedValueOnce(new Error("offline catalog"));
    const { render, tab, live } = setup({ codexModel: "saved-model" });
    const ui = render();
    await ui.read.click();
    await ui.model.change("listed");
    const before = [...ui.model.options.entries()];

    await ui.read.click();

    expect(ui.feedback.text).toContain("offline catalog");
    expect([...ui.model.options.entries()]).toEqual(before);
    expect(ui.model.value).toBe("listed");
    expect(tab.currentSettings().codexModel).toBe("listed");
    expect(live.codexModel).toBe("saved-model");
    expect(ui.read.disabled).toBe(false);
  });

  it("aborts a stale path request and ignores its result after a newer catalog loads", async () => {
    const old = deferred<LocalModelOption[]>();
    vi.mocked(listCodexModels).mockReturnValueOnce(old.promise);
    vi.mocked(listCodexModels).mockResolvedValueOnce([{ id: "new-path-model", name: "New" }]);
    const { render, tab, live } = setup({ codexModel: "retained" });
    const ui = render();
    const firstRead = ui.read.click();
    const oldSignal = vi.mocked(listCodexModels).mock.calls[0][0]!.signal!;
    expect(ui.read.disabled).toBe(true);

    await ui.path.change(" /tools/new-codex ");

    expect(oldSignal.aborted).toBe(true);
    expect(ui.read.disabled).toBe(false);
    expect(tab.currentSettings().codexBinaryPath).toBe("/tools/new-codex");
    expect(live.codexBinaryPath).toBe("/tools/codex");
    await ui.read.click();
    const currentFeedback = ui.feedback.text;
    old.resolve([{ id: "stale-model", name: "Stale" }]);
    await firstRead;
    expect([...ui.model.options.keys()]).toEqual(["", "new-path-model", "retained"]);
    expect(ui.feedback.text).toBe(currentFeedback);
    expect(ui.model.value).toBe("retained");
  });

  it("cancels an active catalog request when the settings tab hides", async () => {
    const pending = deferred<LocalModelOption[]>();
    vi.mocked(listOpenCodeModels).mockReturnValueOnce(pending.promise);
    const { render, tab } = setup({ opencodeModel: "provider/saved" });
    const ui = render("opencode-acp");
    const reading = ui.read.click();
    const signal = vi.mocked(listOpenCodeModels).mock.calls[0][0]!.signal!;
    tab.hide();
    expect(signal.aborted).toBe(true);
    pending.resolve([{ id: "late-result", name: "Late" }]);
    await reading;
    expect([...ui.model.options.keys()]).toEqual(["", "provider/saved"]);
    const reopened = render("opencode-acp");
    expect([...reopened.model.options.keys()]).toEqual(["", "provider/saved"]);
    expect(reopened.read.disabled).toBe(false);
  });

  it("keeps manual entry, the dropdown, and the default choice synchronized without saving", async () => {
    const { render, tab, features, live } = setup();
    const ui = render("claude-code");
    await ui.model.change("sonnet");
    expect(ui.manual.value).toBe("sonnet");
    await ui.manual.change("  custom/claude-model  ");
    expect(ui.model.value).toBe("custom/claude-model");
    expect(ui.model.options.has("custom/claude-model")).toBe(true);
    await ui.model.change("");
    expect(ui.manual.value).toBe("");
    expect(tab.currentSettings().localAgents["claude-code"].model).toBe("");
    expect(live.localAgents["claude-code"]).toBeUndefined();
    expect(features.save).not.toHaveBeenCalled();
  });

  it("saves independent model and executable choices for each backend through the draft", async () => {
    const { render, tab, features, live } = setup();
    const codex = render("codex-cli");
    await codex.manual.change("codex-selected");
    await codex.path.change("/tools/codex-preview");
    const opencode = render("opencode-acp");
    await opencode.manual.change("provider/selected");
    const claude = render("claude-code");
    await claude.model.change("opus");
    const gemini = render("gemini-cli");
    expect(gemini.model.value).toBe("retained-gemini");
    expect(live.codexModel).toBe("");
    expect(live.opencodeModel).toBe("");
    expect(live.localAgents["claude-code"]).toBeUndefined();
    live.aiUsageRecords.push({ id: "background-usage" });

    await tab.saveDraftSettings();

    expect(live.codexModel).toBe("codex-selected");
    expect(live.codexBinaryPath).toBe("/tools/codex-preview");
    expect(live.opencodeModel).toBe("provider/selected");
    expect(live.opencodeBinaryPath).toBe("/tools/opencode");
    expect(live.localAgents["claude-code"]).toEqual({ binaryPath: "", model: "opus" });
    expect(live.localAgents["gemini-cli"]).toEqual({ binaryPath: "/tools/gemini", model: "retained-gemini" });
    expect(live.aiUsageRecords).toEqual([{ id: "background-usage" }]);
    expect(features.save).toHaveBeenCalledOnce();
    expect(features.applySettings).toHaveBeenCalledOnce();
    expect(tab.hasUnsavedChanges).toBe(false);
  });

  it("discards local agent changes and reloads the latest saved configuration", async () => {
    const { render, tab, features, live } = setup({ codexModel: "original" });
    await render().manual.change("discarded-model");
    await render("aider").manual.change("discarded-aider-model");
    live.codexModel = "updated-externally";

    tab.discardChanges();

    expect(render().model.value).toBe("updated-externally");
    expect(render("aider").model.value).toBe("");
    expect(live.localAgents.aider).toBeUndefined();
    expect(tab.hasUnsavedChanges).toBe(false);
    expect(features.save).not.toHaveBeenCalled();
  });

  it("rolls back persisted values on a failed save while retaining local agent edits for retry", async () => {
    const { render, tab, features, live } = setup({ codexModel: "saved" });
    await render().manual.change("retry-model");
    await render("qwen-code").manual.change("qwen-retry-model");
    features.save.mockRejectedValueOnce(new Error("disk full"));

    await tab.saveDraftSettings();

    expect(live.codexModel).toBe("saved");
    expect(live.localAgents["qwen-code"]).toBeUndefined();
    expect(tab.currentSettings().codexModel).toBe("retry-model");
    expect(tab.currentSettings().localAgents["qwen-code"].model).toBe("qwen-retry-model");
    expect(tab.hasUnsavedChanges).toBe(true);
    await tab.saveDraftSettings();
    expect(live.codexModel).toBe("retry-model");
    expect(live.localAgents["qwen-code"].model).toBe("qwen-retry-model");
    expect(tab.hasUnsavedChanges).toBe(false);
  });

  it("disables local model discovery on mobile", () => {
    host.Platform.isDesktopApp = false;
    const { render } = setup();
    for (const backend of ["codex-cli", "opencode-acp"] as const) {
      const ui = render(backend);
      expect(ui.model.disabled).toBe(true);
      expect(ui.read.disabled).toBe(true);
    }
    expect(listCodexModels).not.toHaveBeenCalled();
    expect(listOpenCodeModels).not.toHaveBeenCalled();
  });

  it("shows only the disabled default model control for IBM Bob", () => {
    const { render, tab } = setup();
    const ui = render("bob");
    expect([...ui.model.options.keys()]).toEqual([""]);
    expect(ui.model.disabled).toBe(true);
    expect(ui.model.value).toBe("");
    expect(ui.read).toBeUndefined();
    expect(ui.manual).toBeUndefined();
    expect(ui.path.placeholder).toBe("bob");
    expect(tab.details).not.toHaveBeenCalled();
    expect(listCodexModels).not.toHaveBeenCalled();
    expect(listOpenCodeModels).not.toHaveBeenCalled();
  });
});
