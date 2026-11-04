import { App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, type SettingDefinition, type SettingDefinitionItem, type SettingGroupItem, type DropdownComponent, type TextComponent } from "obsidian";
import { t } from "./i18n";
import { normalizeNamedPromptProfiles, removeNamedPromptProfile, upsertNamedPromptProfile } from "./prompt-profiles";
import { modelCapabilityReportKey } from "./model-capabilities";
import { normalizeTemperatureForProtocol, parseProviderParamsJson, providerTemperatureLimit, type ProviderRequestProtocol } from "./provider-params";
import { confirmAndRemoveProviderProfile } from "./provider-profile-actions";
import { validateNumericRangeInput } from "./numeric-range-validation";
import { normalizeDefaultNodeTextAlignment } from "./node-defaults";
import { listCodexModels } from "./codex-models";
import { listOpenCodeModels } from "./opencode-acp";
import { discoverAgentBinary } from "./local-agent-discovery";
import { LOCAL_AGENTS, isLocalAgentBackend, localAgentDefinition, localAgentConfig, updateLocalAgentConfig, localModelChoices, type LocalAgentBackend, type LocalModelOption } from "./local-agent-settings";
import { confirmAction } from "./confirmation-modal";
import type BetterCanvasFeatures from "./feature-integrator";
import type { FeatureSettings, ProviderProfile } from "./feature-integrator";

type SettingsRows = SettingDefinitionItem[];
type SettingsFeatures = Pick<BetterCanvasFeatures, "settings" | "save" | "applySettings" | "resetOnboardingSettings" | "probeProviderCapabilities">;
interface SettingsApp extends App {
  setting?: { open(): void; close(): void; openTabById(id: string): void };
}

let numericRangeDescriptionId = 0;

function temperatureRangeDescription(protocol: ProviderRequestProtocol): string {
  return t("Temperature range 0 to " + providerTemperatureLimit(protocol) + "; empty or invalid input keeps the previous valid value.", "Temperature 范围 0 到 " + providerTemperatureLimit(protocol) + "；留空或无效输入不会覆盖上一次有效值。");
}

export default class BetterCanvasSettingsTab extends PluginSettingTab {
  icon = "layout-dashboard";
  private draftSettings: FeatureSettings | null = null;
  private baseSettings: FeatureSettings | null = null;
  private hasUnsavedChanges = false;
  private isSaving = false;
  private saveButton: HTMLButtonElement | null = null;
  private discardButton: HTMLButtonElement | null = null;
  private saveStatus: HTMLElement | null = null;
  private activeSection = "canvas";
  private providerModal: Modal | null = null;
  private localModelCatalogs = new Map<string, LocalModelOption[]>();
  private localModelRequest: AbortController | null = null;
  private onReturnCallback: (() => void) | null = null;
  private returnButton: HTMLButtonElement | null = null;
  private readonly renderedRows = new Set<HTMLElement>();

  private readonly plugin: Plugin;

  constructor(private readonly hostApp: SettingsApp, plugin: Plugin, private readonly features: SettingsFeatures) {
    super(hostApp, plugin);
    this.plugin = plugin;
  }

  openSection(section: string, callbacks: { onReturn?: () => void } = {}): void {
    if (["canvas", "interaction", "ai", "files"].includes(section)) this.activeSection = section;
    this.draftSettings = null;
    this.baseSettings = null;
    this.hasUnsavedChanges = false;
    const settingsApi = this.hostApp.setting;
    const pluginId = this.plugin.manifest.id;
    settingsApi?.open?.();
    if (pluginId) settingsApi?.openTabById?.(pluginId);
    this.onReturnCallback = callbacks.onReturn ?? null;
    this.update();
  }

  hide(): void {
    this.cancelLocalModelRequest();
    this.providerModal?.close();
    this.renderedRows.clear();
    this.containerEl.closest(".modal.mod-settings")?.removeClass("bc-settings-modal");
    this.onReturnCallback = null;
  }

  /** Open the AI page from the Ask AI panel without rebuilding the settings IA. */
  openAISection(callbacks: { onReturn?: () => void } = {}): void {
    this.openSection("ai", callbacks);
  }

  private returnToQuestion(): void {
    if (this.isSaving || this.hasUnsavedChanges) return;
    const callback = this.onReturnCallback;
    if (!callback) return;
    this.onReturnCallback = null;
    this.hostApp.setting?.close();
    callback();
  }

  private cloneSettings<T>(settings: T): T {
    return structuredClone(settings);
  }

  private currentSettings(): FeatureSettings {
    if (!this.draftSettings) {
      this.baseSettings = this.cloneSettings(this.features.settings());
      this.draftSettings = this.cloneSettings(this.baseSettings);
    }
    return this.draftSettings;
  }

  private markDirty(): Promise<void> {
    this.hasUnsavedChanges = JSON.stringify(this.currentSettings()) !== JSON.stringify(this.baseSettings);
    this.updateSaveStatus();
    return Promise.resolve();
  }

  private updateSaveStatus(): void {
    for (const row of this.renderedRows) row.inert = this.isSaving;
    if (this.saveButton) this.saveButton.disabled = !this.hasUnsavedChanges || this.isSaving;
    if (this.returnButton) {
      this.returnButton.disabled = this.hasUnsavedChanges || this.isSaving;
      this.returnButton.title = this.hasUnsavedChanges ? t("Save or discard your changes first.", "请先保存或放弃更改。") : t("Back to the question", "回到刚才的问题");
    }
    if (this.discardButton) {
      this.discardButton.hidden = !this.hasUnsavedChanges;
      this.discardButton.disabled = this.isSaving;
    }
    if (this.saveStatus) {
      this.saveStatus.setText(this.isSaving ? t("Saving…", "正在保存…") : this.hasUnsavedChanges ? t("Unsaved changes", "有未保存的更改") : t("No pending changes", "没有待保存的更改"));
      this.saveStatus.toggleClass("is-dirty", this.hasUnsavedChanges);
    }
  }

  private discardChanges(): void {
    if (this.isSaving) return;
    this.draftSettings = null;
    this.baseSettings = null;
    this.hasUnsavedChanges = false;
    this.update();
  }

  private async saveDraftSettings(): Promise<void> {
    if (!this.hasUnsavedChanges || this.isSaving) return;
    const live = this.features.settings();
    const previous: Record<string, unknown> = { ...this.cloneSettings(live) };
    const draft: Record<string, unknown> = { ...this.cloneSettings(this.currentSettings()) };
    const base: Record<string, unknown> = { ...this.baseSettings };
    // Merge only edited fields so background usage records and capability reports survive.
    const changed = Object.keys({ ...base, ...draft }).filter(key => JSON.stringify(base[key]) !== JSON.stringify(draft[key]));
    for (const key of changed) {
      if (key in draft) Object.assign(live, { [key]: draft[key] });
      else Reflect.deleteProperty(live, key);
    }
    this.isSaving = true;
    this.updateSaveStatus();
    try {
      await this.features.save();
    } catch (error) {
      for (const key of changed) {
        if (key in previous) Object.assign(live, { [key]: previous[key] });
        else Reflect.deleteProperty(live, key);
      }
      this.isSaving = false;
      this.updateSaveStatus();
      new Notice(t("Could not save settings: ", "保存设置失败：") + (error instanceof Error ? error.message : String(error)), 8000);
      return;
    }
    this.draftSettings = this.cloneSettings(live);
    this.baseSettings = this.cloneSettings(live);
    this.hasUnsavedChanges = false;
    this.isSaving = false;
    try {
      this.features.applySettings();
      new Notice(t("Settings saved and applied.", "设置已保存并立即生效。"));
    } catch (error) {
      new Notice(t("Settings saved, but some changes could not be applied: ", "设置已保存，但部分更改未能立即应用：") + (error instanceof Error ? error.message : String(error)), 8000);
    }
    this.update();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.cancelLocalModelRequest();
    // The host also asks for definitions during search indexing before this tab opens.
    if (!this.hasUnsavedChanges && !this.isSaving) {
      this.draftSettings = null;
      this.baseSettings = null;
    }
    this.currentSettings();
    const sections = [
      { id: "canvas", title: t("Canvas", "画布"), render: (page: SettingsRows) => this.renderCanvasSettings(page) },
      { id: "interaction", title: t("Interaction", "操作"), render: (page: SettingsRows) => this.renderInteractionSettings(page) },
      { id: "ai", title: t("AI assistant", "AI 助手"), render: (page: SettingsRows) => this.renderAISettings(page) },
      { id: "files", title: t("Files", "文件"), render: (page: SettingsRows) => this.renderFileSettings(page) }
    ];
    const items: SettingsRows = [];
    for (const section of sections) {
      const rows: SettingsRows = [];
      section.render(rows);
      rows.push(this.footerDefinition());
      if (section.id === this.activeSection) items.unshift(...rows);
      else items.push({ type: "page", name: section.title, items: rows });
    }
    return items;
  }

  private footerDefinition(): SettingDefinition {
    return {
      name: t("Save changes", "保存更改"),
      searchable: false,
      render: setting => {
        this.decorateSettings(setting);
        setting.settingEl.addClass("bc-settings-actions");
        this.saveStatus = setting.descEl.createSpan({ cls: "bc-settings-save-status", attr: { role: "status", "aria-live": "polite" } });
        setting.addButton(button => {
          this.discardButton = button.buttonEl;
          button.setButtonText(t("Discard changes", "放弃更改")).onClick(() => this.discardChanges());
        });
        setting.addButton(button => {
          this.saveButton = button.buttonEl;
          button.setButtonText(t("Save changes", "保存更改")).setCta().onClick(() => this.saveDraftSettings());
        });
        this.returnButton = null;
        if (this.onReturnCallback) setting.addButton(button => {
          this.returnButton = button.buttonEl;
          button.setButtonText(t("Back to question", "返回提问")).onClick(() => this.returnToQuestion());
        });
        this.updateSaveStatus();
      }
    };
  }

  private decorateSettings(setting: Setting): void {
    this.containerEl.addClass("bc-settings-root");
    this.containerEl.closest(".modal.mod-settings")?.addClass("bc-settings-modal");
    setting.settingEl.closest(".vertical-tab-content")?.addClass("bc-settings-root");
  }

  private addSetting(rows: SettingsRows, name: string, desc: string, render: (setting: Setting) => void | (() => void)): void {
    rows.push({ name, desc, render: setting => {
      this.decorateSettings(setting);
      this.renderedRows.add(setting.settingEl);
      setting.settingEl.inert = this.isSaving;
      const cleanup = render(setting);
      if (setting.controlEl.querySelector("textarea")) setting.settingEl.addClass("bc-settings-textarea");
      return () => {
        this.renderedRows.delete(setting.settingEl);
        if (typeof cleanup === "function") cleanup();
      };
    } });
  }

  private cancelLocalModelRequest(): void {
    this.localModelRequest?.abort();
    this.localModelRequest = null;
  }

  private group(page: SettingsRows, title?: string): SettingsRows {
    const items: SettingGroupItem[] = [];
    page.push({ type: "group", heading: title, cls: "bc-settings-group", items });
    return items;
  }

  private details(page: SettingsRows, _id: string, title: string, description = ""): SettingsRows {
    const items: SettingsRows = [this.footerDefinition()];
    page.push({ type: "page", name: title, desc: description, items });
    return items;
  }

  private syncLegacyProvider(profile: ProviderProfile, settings: FeatureSettings): void {
    if (settings.activeProviderId !== profile.id) return;
    settings.baseUrl = String(profile.baseUrl ?? "");
    settings.apiKey = String(profile.apiKey ?? "");
    settings.model = String(profile.model ?? "");
  }

  private async saveProvider(profile: ProviderProfile, settings: FeatureSettings): Promise<void> {
    this.syncLegacyProvider(profile, settings);
    await this.markDirty();
  }

  private addNumericRangeSetting(
    page: SettingsRows,
    name: string,
    currentValue: number,
    min: number,
    max: number,
    onValidChange: (value: number) => Promise<void>,
    options: { description?: string; step?: string; integer?: boolean; allowEmpty?: boolean } = {}
  ): void {
    this.addSetting(page, name, options.description ?? "", setting => {
    const feedback = setting.descEl.createSpan({ cls: "bc-settings-number-error" });
    feedback.hidden = true;
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    const descriptionId = setting.descEl.id || ("bc-settings-number-description-" + (++numericRangeDescriptionId));
    setting.descEl.id = descriptionId;

    setting.addText(text => {
      const input = text.inputEl;
      input.type = "number";
      input.min = String(min);
      input.max = String(max);
      if (options.step) input.step = options.step;

      const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
      describedBy.add(descriptionId);
      input.setAttribute("aria-describedby", Array.from(describedBy).join(" "));

      text.setValue(String(currentValue)).onChange(async rawValue => {
        const number = validateNumericRangeInput(rawValue, min, max, input, feedback, {
          integer: options.integer,
          allowEmpty: options.allowEmpty
        });
        if (number === null) return;
        await onValidChange(number);
      });
    });
    });

  }

  private renderCanvasSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    const cards = this.group(page, t("New cards", "新建卡片"));
    this.addSetting(cards, t("Text alignment", "文字对齐"), t("Used for new cards. When fitting content, single lines are centered and multiple lines are left-aligned.", "用于新卡片。自动适应内容时，单行居中，多行左对齐。"), setting => {
      setting
      .addDropdown(dropdown => dropdown.addOption("left", t("Left", "左对齐")).addOption("center", t("Center", "居中")).addOption("right", t("Right", "右对齐"))
        .setValue(normalizeDefaultNodeTextAlignment(settings.defaultNodeTextAlign))
        .onChange(async value => { settings.defaultNodeTextAlign = normalizeDefaultNodeTextAlignment(value); await this.markDirty(); }));
    });
    const layout = this.group(page, t("Auto layout", "自动布局"));
    this.addSetting(layout, t("Layout direction", "排列方向"), t("Direction cards spread in when arranged.", "整理卡片时，沿这个方向展开。"), setting => {
      setting
      .addDropdown(dropdown => dropdown.addOption("LR", t("Left to right", "从左到右")).addOption("RL", t("Right to left", "从右到左")).addOption("TB", t("Top to bottom", "从上到下")).addOption("BT", t("Bottom to top", "从下到上"))
        .setValue(String(settings.direction || "LR"))
        .onChange(async value => { if (value !== "LR" && value !== "RL" && value !== "TB" && value !== "BT") return; settings.direction = value; await this.markDirty(); }));
    });
    this.addNumericRangeSetting(layout, t("Horizontal gap", "水平间距"), settings.gapX ?? 100, 0, 1000, async value => { settings.gapX = value; await this.markDirty(); }, { description: t("Horizontal distance between cards, in px.", "卡片之间的水平距离，单位 px。") });
    this.addNumericRangeSetting(layout, t("Vertical gap", "垂直间距"), settings.gapY ?? 44, 0, 1000, async value => { settings.gapY = value; await this.markDirty(); }, { description: t("Vertical distance between cards, in px.", "卡片之间的垂直距离，单位 px。") });
    const grid = this.details(page, "grid", t("Grid spacing", "网格间距"), t("Used when snapping to the grid.", "用于对齐到网格。"));
    this.addNumericRangeSetting(grid, t("Grid size", "网格大小"), settings.gridSize ?? 20, 1, 500, async value => { settings.gridSize = value; await this.markDirty(); }, { description: t("In px.", "单位 px。") });
  }

  private renderInteractionSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    const keyboard = this.group(page, t("Keyboard", "键盘"));
    const shortcuts = [
      ["mindMapShortcutChildTabEnabled", t("Create child card", "创建子卡片"), t("Tab; use Shift + Tab while editing text.", "Tab；编辑文字时使用 Shift + Tab。")],
      ["mindMapShortcutSiblingEnterEnabled", t("Create sibling card", "创建同级卡片"), t("Enter; use Shift + Enter while editing text.", "Enter；编辑文字时使用 Shift + Enter。")],
      ["mindMapShortcutAltArrowNavigationEnabled", t("Jump to adjacent card", "跳到相邻卡片"), t("Alt + arrow keys.", "Alt + 方向键。")],
      ["mindMapShortcutDirectionalCreationEnabled", t("Create card in a direction", "向指定方向创建卡片"), t("Ctrl / Cmd + arrow keys, including Shift combinations.", "Ctrl / Cmd + 方向键，同时控制带 Shift 的组合键。")]
    ] as const;
    for (const [key, title, description] of shortcuts) {
    this.addSetting(keyboard, title, description, setting => {
      setting
        .addToggle(toggle => toggle.setValue(settings[key] !== false).onChange(async value => { settings[key] = value; await this.markDirty(); }));
    });
    }
    const readonly = this.group(page, t("Read-only mode", "只读模式"));
    this.addSetting(readonly, t("Hide context menu", "隐藏右键菜单"), t("In read-only mode, do not open the canvas context menu.", "只读时，不打开画布的右键菜单。"), setting => {
      setting
      .addToggle(toggle => toggle.setValue(settings.readOnlyDisableNodeMenusEnabled !== false)
        .onChange(async value => { settings.readOnlyDisableNodeMenusEnabled = value; await this.markDirty(); }));
    });
    this.addSetting(readonly, t("Lock view", "固定视图"), t("In read-only mode, lock panning and zooming. Commands can still zoom to all content or the selected cards.", "只读时，锁定拖动画布和缩放。仍可通过命令缩放到全部内容或所选卡片。"), setting => {
      setting
      .addToggle(toggle => toggle.setValue(settings.readOnlyLockPanZoomEnabled === true)
        .onChange(async value => { settings.readOnlyLockPanZoomEnabled = value; await this.markDirty(); }));
    });
    const guide = this.group(page, t("Getting started", "首次使用"));
    this.addSetting(guide, t("Show onboarding again", "重新显示引导"), t("Resets the welcome entry and empty-canvas hints. Does not delete canvases or AI settings.", "重置欢迎入口和空画布提示。不会删除画布或 AI 设置。"), setting => {
      setting
      .addButton(button => button.setButtonText(t("Reset onboarding", "重置引导")).onClick(async () => {
        settings.onboarding = this.features.resetOnboardingSettings();
        await this.markDirty();
      }));
    });
  }

  private renderAISettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    const text = this.group(page, t("Text generation", "文字生成"));
    this.addSetting(text, t("Provider", "使用方式"), t("Choose the model service or local tool you already use.", "选择你已经在用的模型服务或本地工具。"), setting => {
      setting
      .addDropdown(dropdown => {
        dropdown.addOption("api", t("Model service API", "模型服务 API"));
        for (const agent of LOCAL_AGENTS) dropdown.addOption(agent.id, agent.name);
        dropdown.setValue(localAgentDefinition(settings.backend) ? settings.backend : "api")
          .onChange(async value => { if (value !== "api" && !isLocalAgentBackend(value)) return; settings.backend = value; await this.markDirty(); this.update(); });
      });
    });
    const agent = localAgentDefinition(settings.backend);
    if (agent) {
      this.renderLocalAgentSettings(text, page, agent.id);
    } else {
      this.renderModelServices(text, settings, page);
    }
    this.renderPromptSettings(this.details(page, "prompts", t("Answer preferences", "回答偏好"), t("Tone, language, and instructions", "语气、语言和要求")));
    this.renderImageSettings(this.details(page, "images", t("Image generation", "图片生成"), t("Configure a separate model service", "单独配置模型服务")));
    this.renderFlashcardSettings(this.details(page, "flashcards", t("Study cards", "学习卡片"), t("How generated cards are saved", "生成后的保存方式")));
    this.renderMcpSettings(this.details(page, "mcp", t("External tools", "外部工具"), t("MCP · connect on demand", "MCP · 按需连接")));
  }

  private renderLocalAgentSettings(group: SettingsRows, page: SettingsRows, backend: LocalAgentBackend): void {
    const settings = this.currentSettings();
    const agent = localAgentDefinition(backend)!;
    let dropdown: DropdownComponent | undefined;
    let manualInput: TextComponent | undefined;
    let resetCatalog: (() => void) | undefined;
    const catalogKey = () => JSON.stringify([backend, localAgentConfig(settings, backend).binaryPath]);
    const populate = () => {
      if (!dropdown) return;
      const selected = localAgentConfig(settings, backend).model;
      dropdown.selectEl.empty();
      dropdown.addOption("", t("Use tool default model", "使用工具默认模型"));
      const models = this.localModelCatalogs.get(catalogKey()) ?? agent.models;
      for (const model of localModelChoices(models, selected)) {
        dropdown.addOption(model.id, model.name === model.id ? model.id : `${model.name} · ${model.id}`);
      }
      dropdown.setValue(selected);
    };
    this.addSetting(group, t("Model", "模型"), agent.supportsModel === false
      ? t("IBM Bob uses its own configured model; the current command line offers no model override flag.", "IBM Bob 使用自身配置的模型；当前命令行未提供模型覆盖参数。")
      : agent.discovery
        ? t("Click “Load models” to fetch the list from the local tool. Pick one, then click “Save changes”.", "点击「读取模型」从本机工具获取列表。选择后点击「保存更改」生效。")
        : t("The list shows common model IDs; availability depends on the tool and account. You can also expand the settings below to enter one manually.", "列表为常用模型 ID，实际可用性取决于工具和账号。也可展开下方设置手动填写。"), modelSetting => {
    modelSetting.settingEl.addClass("bc-local-model-setting");
    modelSetting
      .addDropdown(component => {
        dropdown = component;
        component.selectEl.addClass("bc-local-model-select");
        populate();
        component.setDisabled(!Platform.isDesktopApp || agent.supportsModel === false)
          .onChange(async value => {
            updateLocalAgentConfig(settings, backend, { model: value });
            manualInput?.setValue(value);
            await this.markDirty();
          });
      });
    if (agent.discovery) {
      const feedback = modelSetting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
      modelSetting.addButton(button => {
        resetCatalog = () => {
          this.cancelLocalModelRequest();
          populate();
          feedback.setText("");
          button.setButtonText(t("Load models", "读取模型")).setDisabled(!Platform.isDesktopApp);
        };
        button.setButtonText(t("Load models", "读取模型")).setDisabled(!Platform.isDesktopApp).onClick(async () => {
          this.cancelLocalModelRequest();
          const controller = new AbortController();
          this.localModelRequest = controller;
          const key = catalogKey();
          button.setDisabled(true).setButtonText(t("Loading…", "正在读取…"));
          feedback.setText(t("Loading model list…", "正在读取模型列表…"));
          try {
            const options = { binaryPath: localAgentConfig(settings, backend).binaryPath, signal: controller.signal, timeoutMs: 15_000 };
            const models = await (backend === "codex-cli" ? listCodexModels(options) : listOpenCodeModels(options));
            if (controller.signal.aborted || this.localModelRequest !== controller || key !== catalogKey()) return;
            this.localModelCatalogs.set(key, models);
            if (this.localModelCatalogs.size > 8) {
              const oldestKey: unknown = this.localModelCatalogs.keys().next().value;
              if (typeof oldestKey === "string") this.localModelCatalogs.delete(oldestKey);
            }
            populate();
            feedback.setText(models.length ? t(`Loaded models: ${models.length}. The list does not reflect your account's access.`, `已读取 ${models.length} 个模型。列表不代表账号的访问权限。`) : t("The tool returned no models. Use the default model or enter one manually.", "工具没有返回模型。可使用默认模型或手动填写。"));
          } catch (error) {
            if (controller.signal.aborted || this.localModelRequest !== controller) return;
            feedback.setText(t("Load failed: ", "读取失败：") + (error instanceof Error ? error.message : String(error)));
          } finally {
            if (this.localModelRequest === controller) {
              this.localModelRequest = null;
              button.setDisabled(false).setButtonText(t("Reload models", "重新读取"));
            }
          }
        });
      });
    }
    return () => {
      dropdown = undefined;
      resetCatalog = undefined;
      this.cancelLocalModelRequest();
    };
    });
    let pathInput: TextComponent | undefined;
    this.addSetting(group, t("Program path", "程序路径"), t("Desktop only. When empty, checks PATH first, then common install locations such as Homebrew, npm, Bun, ~/.local/bin, and ~/.opencode.", "仅支持桌面版。留空时先查 PATH，再查 Homebrew、npm、Bun、~/.local/bin、~/.opencode 等常见安装位置。"), pathSetting => {
    pathSetting.addText(input => {
      pathInput = input;
      input.setPlaceholder(agent.binary).setValue(localAgentConfig(settings, backend).binaryPath)
        .onChange(async value => {
          updateLocalAgentConfig(settings, backend, { binaryPath: value.trim() });
          resetCatalog?.();
          await this.markDirty();
        });
    });
    if (Platform.isDesktopApp) {
      const pathFeedback = pathSetting.descEl.createDiv({ attr: { role: "status", "aria-live": "polite" } });
      pathSetting.addButton(button => {
        button.setButtonText(t("Locate", "查找")).onClick(async () => {
          button.setDisabled(true).setButtonText(t("Locating…", "查找中…"));
          pathFeedback.setText(t("Looking for ", "正在查找 ") + agent.binary + "…");
          try {
            const found = await discoverAgentBinary(agent.binary);
            if (found) {
              pathInput?.setValue(found);
              updateLocalAgentConfig(settings, backend, { binaryPath: found });
              resetCatalog?.();
              await this.markDirty();
              pathFeedback.setText(t("Found and filled in: ", "已找到并填入：") + found);
            } else {
              pathFeedback.setText(t("Could not find ", "没有找到 ") + agent.binary + t(". Make sure it is installed, or enter the full path to the executable.", "。请确认已安装，或手动填写可执行文件的完整路径。"));
            }
          } catch (error) {
            pathFeedback.setText(t("Search failed: ", "查找失败：") + (error instanceof Error ? error.message : String(error)));
          } finally {
            button.setDisabled(false).setButtonText(t("Locate", "查找"));
          }
        });
      });
    }
    });
    if (agent.supportsModel !== false) {
      const manual = this.details(page, "local-model-" + backend, t("Enter model manually", "手动填写模型"), t("When your model is not listed, enter the full model ID supported by the tool. Leave empty to restore the default.", "模型未列出时，填写工具支持的完整模型 ID。留空恢复默认。"));
    this.addSetting(manual, t("Model ID", "模型 ID"), backend === "opencode-acp" ? t("For example provider/model; it must be a model offered by the current OpenCode session.", "例如 provider/model；必须是 OpenCode 当前会话提供的模型。") : t("Models for custom services may not appear in the tool's catalog.", "自定义服务的模型可能不在工具返回的目录中。"), setting => {
      setting
        .addText(input => {
          manualInput = input;
          input.setValue(localAgentConfig(settings, backend).model).setPlaceholder(t("Use tool default model", "使用工具默认模型"))
            .onChange(async value => {
              updateLocalAgentConfig(settings, backend, { model: value.trim() });
              populate();
              await this.markDirty();
            });
        });
    });
    }
  }

  private renderModelServices(page: SettingsRows, settings: FeatureSettings, section: SettingsRows): void {
    const profiles = settings.providerProfiles;
    const active = profiles?.find(profile => profile.id === settings.activeProviderId) ?? profiles?.[0];
    if (!active) {
    this.addSetting(page, t("Connect a model service", "连接一个模型服务"), t("Set it up once, then just pick a model.", "填写一次，之后只需选择模型。"), setting => {
      setting
        .addButton(button => button.setButtonText(t("Add service", "添加服务")).onClick(() => this.openProviderEditor()));
    });
      return;
    }
    this.addSetting(page, t("Model service", "模型服务"), t("Choose the service to use.", "选择这次使用的服务。"), setting => {
      setting
      .addDropdown(dropdown => {
        for (const profile of profiles) dropdown.addOption(profile.id, String(profile.name || t("Untitled provider", "未命名服务")));
        dropdown.setValue(active.id).onChange(async id => {
          settings.activeProviderId = id;
          const profile = profiles.find(item => item.id === id);
          if (profile) this.syncLegacyProvider(profile, settings);
          await this.markDirty();
          this.update();
        });
      })
      .addExtraButton(button => button.setIcon("pencil").setTooltip(t("Edit service", "编辑服务")).onClick(() => this.openProviderEditor(active.id)))
      .addExtraButton(button => button.setIcon("plus").setTooltip(t("Add service", "添加服务")).onClick(() => this.openProviderEditor()));
    });
    this.addSetting(page, t("Default model", "默认模型"), t("New chats use this model. Individual cards can choose their own.", "新对话使用这个模型。单张卡片也可以单独选择。"), setting => {
      setting
      .addText(text => text.setPlaceholder(t("Enter model name", "填写模型名称")).setValue(String(active.model || ""))
        .onChange(async value => { active.model = value.trim(); await this.saveProvider(active, settings); }));
    });
    this.renderProviderParameters(this.details(section, "generation", t("Generation parameters", "生成参数"), t("Usually no changes needed.", "通常无需调整。")), active, settings);
  }

  private openProviderEditor(id?: string): void {
    const settings = this.currentSettings();
    const existing = settings.providerProfiles.find(profile => profile.id === id);
    const profile = this.cloneSettings<ProviderProfile>(existing ?? {
      id: "provider-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: "", protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "",
      imageModel: "gpt-image-1", requestParamsJson: "{}", temperature: 0.4, maxOutputTokens: 0
    });
    const modal = new Modal(this.app);
    this.providerModal?.close();
    this.providerModal = modal;
    modal.titleEl.setText(existing ? t("Edit model service", "编辑模型服务") : t("Add model service", "添加模型服务"));
    modal.contentEl.addClass("bc-settings-provider-editor");
    modal.contentEl.createEl("p", { cls: "bc-settings-note", text: t("Enter the service URL, key, and model. When done, click “Save changes” on the settings page to apply.", "填入服务地址、密钥和模型。完成后，点击设置页的“保存更改”使它生效。") });
    new Setting(modal.contentEl).setName(t("Name", "名称"))
      .addText(text => text.setPlaceholder(t("For example: My model service", "例如：我的模型服务")).setValue(String(profile.name || "")).onChange(value => { profile.name = value; }));
    new Setting(modal.contentEl).setName(t("API type", "接口类型"))
      .addDropdown(dropdown => dropdown.addOption("openai", t("OpenAI compatible", "OpenAI 兼容")).addOption("anthropic", "Anthropic").addOption("gemini", "Gemini")
        .setValue(profile.protocol || "openai").onChange(value => { profile.protocol = value === "anthropic" || value === "gemini" ? value : "openai"; }));
    new Setting(modal.contentEl).setName(t("Service URL", "服务地址"))
      .addText(text => text.setPlaceholder("https://api.example.com/v1").setValue(String(profile.baseUrl || "")).onChange(value => { profile.baseUrl = value.trim(); }));
    new Setting(modal.contentEl).setName(t("API key", "API 密钥")).setDesc(t("The key is stored in the plugin configuration for this vault.", "密钥保存在当前仓库的插件配置里。"))
      .addText(text => { text.inputEl.type = "password"; text.inputEl.autocomplete = "off"; text.setValue(String(profile.apiKey || "")).onChange(value => { profile.apiKey = value.trim(); }); });
    new Setting(modal.contentEl).setName(t("Model name", "模型名称"))
      .addText(text => text.setPlaceholder(t("Enter the model name from your provider", "填写服务商提供的模型名称")).setValue(String(profile.model || "")).onChange(value => { profile.model = value.trim(); }));
    const feedback = modal.contentEl.createEl("p", { cls: "bc-settings-number-error", attr: { role: "status" } });
    const actions = modal.contentEl.createDiv({ cls: "bc-settings-dialog-actions" });
    if (existing) {
      const remove = actions.createEl("button", { text: t("Delete service", "删除服务"), cls: "mod-warning", attr: { type: "button" } });
      remove.disabled = settings.providerProfiles.length <= 1;
      remove.addEventListener("click", () => { void (async () => {
        let message = "";
        confirmAndRemoveProviderProfile(settings.providerProfiles, existing.id, settings.activeProviderId, value => { message = value; return false; });
        if (!message || !await confirmAction(this.app, { title: t("Delete service", "删除服务"), message, confirmLabel: t("Delete service", "删除服务"), destructive: true })) return;
        const result = confirmAndRemoveProviderProfile(settings.providerProfiles, existing.id, settings.activeProviderId, () => true);
        if (!result.confirmed) return;
        settings.activeProviderId = result.activeProviderId ?? settings.activeProviderId;
        if (result.activeProfile) this.syncLegacyProvider(result.activeProfile, settings);
        await this.markDirty();
        modal.close();
        this.update();
      })(); });
    }
    actions.createEl("button", { text: t("Cancel", "取消"), attr: { type: "button" } }).addEventListener("click", () => modal.close());
    const done = actions.createEl("button", { text: existing ? t("Done", "完成") : t("Add service", "添加服务"), cls: "mod-cta", attr: { type: "button" } });
    done.addEventListener("click", () => {
      if (!String(profile.name).trim() || !profile.model) { feedback.setText(t("Enter a service name and model name.", "请填写服务名称和模型名称。")); return; }
      try {
        const url = new URL(profile.baseUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { feedback.setText(t("Enter a valid HTTP or HTTPS service URL.", "请填写有效的 HTTP 或 HTTPS 服务地址。")); return; }
      profile.name = String(profile.name).trim();
      const previousTemperature = profile.temperature;
      profile.temperature = normalizeTemperatureForProtocol(profile.temperature, profile.protocol ?? "openai");
      if (existing) Object.assign(existing, profile);
      else {
        settings.providerProfiles ??= [];
        settings.providerProfiles.push(profile);
        settings.activeProviderId = profile.id;
      }
      this.syncLegacyProvider(profile, settings);
      void this.markDirty();
      if (previousTemperature !== profile.temperature) new Notice(t("Randomness was adjusted to " + profile.temperature + " to fit the current API limit.", "随机程度已按当前接口上限调整为 " + profile.temperature + "。"));
      modal.close();
      this.update();
    });
    modal.onClose = () => { modal.contentEl.empty(); if (this.providerModal === modal) this.providerModal = null; };
    modal.open();
  }

  private renderProviderParameters(page: SettingsRows, profile: ProviderProfile, settings: FeatureSettings): void {
      this.addNumericRangeSetting(
        page,
        t("Randomness", "随机程度"),
        typeof profile.temperature === "number" ? profile.temperature : 0.4,
        0,
        providerTemperatureLimit(profile.protocol ?? "openai"),
        async number => {
          profile.temperature = number;
          await this.saveProvider(profile, settings);
        },
        {
          description: temperatureRangeDescription(profile.protocol ?? "openai"),
          step: "0.1",
          allowEmpty: true
        }
      );

      this.addNumericRangeSetting(
        page,
        t("Max output length", "最大输出长度"),
        typeof profile.maxOutputTokens === "number" ? profile.maxOutputTokens : 0,
        0,
        200000,
        async number => {
          profile.maxOutputTokens = number;
          await this.saveProvider(profile, settings);
        },
        {
          description: t("0 uses the protocol adapter default; this limits output only, not the model context length.", "0 表示使用协议适配器默认值；只限制输出，不是模型上下文长度。"),
          step: "1",
          integer: true,
          allowEmpty: true
        }
      );

      this.addSetting(page, t("Extra request parameters · JSON", "额外请求参数 · JSON"), t("Extra parameters are merged per protocol: OpenAI compatible / Anthropic at the request top level, Gemini inside generationConfig. Core and auth fields are reserved by the plugin.", "额外参数按协议合并：OpenAI 兼容 / Anthropic 在请求顶层，Gemini 放入 generationConfig。核心字段与认证字段由插件保留。"), paramsSetting => {
      const paramsStatus = paramsSetting.descEl.createDiv({ cls: "bc-settings-params-status", attr: { role: "status" } });
      paramsSetting.addTextArea(text => {
          text.inputEl.rows = 4;
          text.setValue(String(profile.requestParamsJson || "{}"));
          const validate = (value: string): boolean => {
            try {
              const parsed = parseProviderParamsJson(value);
              paramsStatus.setText(t("Valid JSON: " + Object.keys(parsed).length + " extra field(s).", "JSON 有效：" + Object.keys(parsed).length + " 个额外字段。"));
              text.inputEl.removeAttribute("aria-invalid");
              return true;
            } catch (error) {
              paramsStatus.setText((error instanceof Error ? error.message : t("Invalid JSON.", "JSON 无效。")) + t(" The current input has not been saved.", " 当前输入尚未保存。"));
              text.inputEl.setAttribute("aria-invalid", "true");
              return false;
            }
          };
          validate(text.getValue());
          text.onChange(async value => {
            if (!validate(value)) return;
            profile.requestParamsJson = value;
            await this.saveProvider(profile, settings);
          });
        });
      });


      const effectiveModel = profile.id === "default"
        ? String(profile.model || settings.model || "")
        : String(profile.model || "");
      const effectiveProtocol = profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai";
      const reportKey = modelCapabilityReportKey(String(profile.id), effectiveProtocol, effectiveModel);
      const report = settings.modelCapabilityReports[reportKey];
      const statusLabel = (status: string): string => status === "accepted" ? t("Accepted", "已接受") : status === "failed" ? t("Failed", "失败") : t("Not run", "未执行");
      this.addSetting(page, t("Model capability probe", "模型能力探测"), t("Manually sends one text request and, if it succeeds, one tiny image input request; this may incur provider charges. Does not probe image generation, PDF, video, URL context, or search capabilities.", "手动发送一次文本请求和（若文本成功）一次微型图片输入请求；可能产生供应商费用。不会自动探测图片生成、PDF、视频、URL context 或搜索能力。"), probeSetting => {
      const reportSummary = probeSetting.descEl.createDiv({ cls: "bc-settings-capability-summary" });
      const renderReportSummary = (): void => {
        if (!report) {
          reportSummary.setText(t("This model has not been probed. An image input result only shows the request was accepted, not that the model read the image; other multimodal capabilities remain unknown.", "当前模型尚未探测。图片输入结果只是请求接受情况，不保证模型真正读取图像；其他多模态能力保持未知。"));
          return;
        }
        reportSummary.setText(
          t("Last probe: ", "最近探测：") + new Date(report.testedAt).toLocaleString() +
          t(" · Text ", " · 文本 ") + statusLabel(report.text.status) +
          t(" · Image input ", " · 图片输入 ") + statusLabel(report.imageInput.status) +
          ((report.text.detail || report.imageInput.detail) ? " · " + [report.text.detail, report.imageInput.detail].filter(Boolean).join(t("; ", "；")) : "")
        );
      };
      renderReportSummary();
      probeSetting.addButton(button => button
          .setButtonText(t("Probe text / image input", "探测文本 / 图片输入"))
          .onClick(async () => {
            if (this.hasUnsavedChanges) {
              new Notice(t("Save your settings before probing model capabilities.", "请先保存设置，再探测模型能力。"));
              return;
            }
            if (!effectiveModel.trim()) {
              new Notice(t("Configure a text model for this provider first.", "请先为此服务商配置文本模型。"));
              return;
            }
            if (!await confirmAction(this.app, { title: t("Model capability probe", "模型能力探测"), message: t("Send up to two API requests using “", "将使用“") + String(profile.name || profile.id) + " / " + effectiveModel + t("”? This may incur charges. Continue?", "”发送最多两次 API 请求。这可能产生费用。继续？") })) return;
            button.setDisabled(true);
            button.setButtonText(t("Probing…", "正在探测…"));
            try {
              const result = await this.features.probeProviderCapabilities(String(profile.id));
              new Notice(t("Capability probe complete: text ", "能力探测完成：文本 ") + statusLabel(result.text.status) + t("; image input ", "；图片输入 ") + statusLabel(result.imageInput.status));
              const reports = this.cloneSettings(this.features.settings().modelCapabilityReports);
              this.currentSettings().modelCapabilityReports = reports;
              if (this.baseSettings) this.baseSettings.modelCapabilityReports = this.cloneSettings(reports);
              await this.markDirty();
              this.update();
            } catch (error) {
              button.setDisabled(false);
              button.setButtonText(t("Probe again", "重新探测"));
              new Notice(error instanceof Error ? error.message : String(error), 8000);
            }
          }));
      });

  }

  private renderPromptSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    this.addSetting(page, t("How should the AI answer?", "希望 AI 怎样回答？"), t("For example: lead with the conclusion, answer in English, and state uncertainty directly.", "例如：先给结论，用中文回答，不确定时直接说明。"), setting => {
      setting
      .addTextArea(text => {
        text.inputEl.rows = 4;
        text.setValue(String(settings.systemPrompt || "You are a precise assistant. Preserve uncertainty."));
        text.onChange(async value => {
          settings.systemPrompt = value;
          await this.markDirty();
        });
      });
    });

    const promptProfiles = normalizeNamedPromptProfiles(settings.systemPromptProfiles);
    settings.systemPromptProfiles = promptProfiles;
    const activePromptId = String(settings.activeSystemPromptProfile || "");
    let profileNameInput = promptProfiles.find(profile => profile.id === activePromptId)?.name ?? "";

    this.addSetting(page, t("Saved preferences", "已存偏好"), t("Save reusable system prompts. Selecting one replaces the current system prompt; after manual edits, save again with the same name to overwrite.", "保存多套可复用的系统提示词。选择后会替换当前系统提示词；手动修改后可用相同名称覆盖保存。"), setting => {
      setting
      .addDropdown(dropdown => {
        dropdown.addOption("", t("Select a saved prompt", "选择已保存的提示词"));
        for (const profile of promptProfiles) dropdown.addOption(profile.id, profile.name);
        dropdown.setValue(activePromptId);
        dropdown.onChange(async id => {
          const profile = promptProfiles.find(item => item.id === id);
          if (!profile) {
            settings.activeSystemPromptProfile = "";
            await this.markDirty();
            return;
          }
          settings.activeSystemPromptProfile = profile.id;
          settings.systemPrompt = profile.prompt;
          profileNameInput = profile.name;
          await this.markDirty();
          this.update();
        });
      });
    });

    this.addSetting(page, t("Save this preference", "保存这组偏好"), t("Enter a name; an existing profile with the same name is updated instead of duplicated.", "输入一个名称；已存在同名配置时会更新该配置，不会创建重复项。"), setting => {
      setting
      .addText(text => text
        .setPlaceholder(t("For example: Research assistant", "例如：研究助手"))
        .setValue(profileNameInput)
        .onChange(value => { profileNameInput = value; }))
      .addButton(button => button
        .setButtonText(t("Save", "保存"))
        .setCta()
        .onClick(async () => {
          try {
            const updated = upsertNamedPromptProfile(
              normalizeNamedPromptProfiles(settings.systemPromptProfiles),
              profileNameInput,
              String(settings.systemPrompt || ""),
              "prompt-" + Date.now().toString(36)
            );
            settings.systemPromptProfiles = updated;
            const saved = updated.find(profile =>
              profile.name.toLocaleLowerCase() === profileNameInput.trim().toLocaleLowerCase()
            );
            settings.activeSystemPromptProfile = saved?.id ?? "";
            await this.markDirty();
            new Notice(saved ? t("Named prompt staged: ", "已暂存命名提示词：") + saved.name : t("Named prompt staged.", "已暂存命名提示词。"));
            this.update();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 6000);
          }
        }));
    });

    this.addSetting(page, t("Delete saved preference", "删除已存偏好"), t("Deletes only the saved prompt profile; the current system prompt stays.", "只删除已保存的提示词配置，不会清空当前系统提示词。"), setting => {
      setting
      .addButton(button => button
        .setButtonText(t("Delete selected profile", "删除所选配置")).setDestructive()
        .onClick(async () => {
          const id = String(settings.activeSystemPromptProfile || "");
          const selected = normalizeNamedPromptProfiles(settings.systemPromptProfiles)
            .find(profile => profile.id === id);
          if (!selected) {
            new Notice(t("Select a named prompt to delete first.", "请先选择要删除的命名提示词。"));
            return;
          }
          if (!await confirmAction(this.app, { title: t("Delete saved preference", "删除已存偏好"), message: t("Delete the named prompt “", "删除命名提示词“") + selected.name + t("”? The current system prompt text is kept.", "”？当前系统提示词文本会保留。"), confirmLabel: t("Delete selected profile", "删除所选配置"), destructive: true })) return;
          settings.systemPromptProfiles = removeNamedPromptProfile(
            normalizeNamedPromptProfiles(settings.systemPromptProfiles),
            selected.id
          );
          settings.activeSystemPromptProfile = "";
          await this.markDirty();
          new Notice(t("Named prompt deletion staged: ", "已暂存删除的命名提示词：") + selected.name);
          this.update();
        }));
    });


  }

  private renderImageSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    this.addSetting(page, t("API type", "接口类型"), t("The provider, key, and model here are separate from text generation.", "此处的服务商、密钥与模型独立于文本生成配置。"), setting => {
      setting
      .addDropdown(dropdown => dropdown
        .addOption("openai", t("OpenAI compatible API", "OpenAI 兼容 API"))
        .addOption("gemini", "Gemini")
        .setValue(settings.imageProtocol === "gemini" ? "gemini" : "openai")
        .onChange(async value => {
          const oldProtocol = settings.imageProtocol === "gemini" ? "gemini" : "openai";
          const defaults = { openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta" };
          if (!String(settings.imageBaseUrl || "").trim() || String(settings.imageBaseUrl) === defaults[oldProtocol]) {
            settings.imageBaseUrl = defaults[value === "gemini" ? "gemini" : "openai"];
          }
          settings.imageProtocol = value === "gemini" ? "gemini" : "openai";
          await this.markDirty();
          this.update();
        }));
    });
    this.addSetting(page, t("Service URL", "服务地址"), "", setting => {
      setting
      .addText(text => text.setPlaceholder(settings.imageProtocol === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1")
        .setValue(String(settings.imageBaseUrl || ""))
        .onChange(async value => { settings.imageBaseUrl = value.trim(); await this.markDirty(); }));
    });
    this.addSetting(page, t("API key", "API 密钥"), "", setting => {
      setting
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder(t("Optional", "可留空")).setValue(String(settings.imageApiKey || "")).onChange(async value => {
          settings.imageApiKey = value.trim();
          await this.markDirty();
        });
      });
    });
    this.addSetting(page, t("Image model", "图片模型"), "", setting => {
      setting
      .addText(text => text.setPlaceholder(t("For example: gpt-image-1 or gemini-2.5-flash-image", "例如：gpt-image-1 或 gemini-2.5-flash-image"))
        .setValue(String(settings.imageModel || "gpt-image-1"))
        .onChange(async value => { settings.imageModel = value.trim(); await this.markDirty(); }));
    });
    this.addSetting(page, t("Save to", "保存到"), "", setting => {
      setting
      .addText(text => text.setPlaceholder("Better Canvas/Generated Images")
        .setValue(String(settings.attachmentFolder || "Better Canvas/Generated Images"))
        .onChange(async value => { settings.attachmentFolder = value.trim() || "Better Canvas/Generated Images"; await this.markDirty(); }));
    });

  }

  private renderFlashcardSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    this.addSetting(page, t("Save as", "保存为"), t("Creates Canvas nodes by default; can also export a Markdown deck that Obsidian Spaced Repetition recognizes.", "默认创建 Canvas 节点；也可导出为 Obsidian Spaced Repetition 可识别的 Markdown 卡组。"), setting => {
      setting
      .addDropdown(dropdown => dropdown
        .addOption("canvas", t("Canvas cards", "画布卡片"))
        .addOption("spaced-repetition", t("Markdown review deck", "Markdown 复习卡组"))
        .setValue(settings.flashcardOutputMode === "spaced-repetition" ? "spaced-repetition" : "canvas")
        .onChange(async value => {
          settings.flashcardOutputMode = value === "spaced-repetition" ? "spaced-repetition" : "canvas";
          await this.markDirty();
          this.update();
        }));
    });

    if (settings.flashcardOutputMode === "spaced-repetition") {
    this.addSetting(page, t("Save to", "保存到"), t("Relative folder inside the vault. An existing note with the same name gets a new file name instead of being overwritten.", "Vault 内的相对目录。已有同名笔记会自动使用新文件名，不会被覆盖。"), setting => {
      setting
        .addText(text => text.setPlaceholder("Better Canvas/Flashcards")
          .setValue(String(settings.spacedRepetitionFolder || "Better Canvas/Flashcards"))
          .onChange(async value => {
            settings.spacedRepetitionFolder = value.trim() || "Better Canvas/Flashcards";
            await this.markDirty();
          }));
    });
    this.addSetting(page, t("Deck tag", "卡组标签"), t("Enter a topic path, for example science/biology; the final tag is #flashcards/science/biology.", "输入主题路径，例如 science/biology；最终标签为 #flashcards/science/biology。"), setting => {
      setting
        .addText(text => text.setPlaceholder("better-canvas")
          .setValue(String(settings.spacedRepetitionDeck || "better-canvas"))
          .onChange(async value => {
            settings.spacedRepetitionDeck = value.trim() || "better-canvas";
            await this.markDirty();
          }));
    });
    }



  }

  private renderMcpSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    this.addSetting(page, t("Connection type", "连接方式"), t("Let the AI use external tools; it asks for confirmation before running them.", "让 AI 使用外部工具；执行前会请你确认。"), setting => {
      setting
      .addDropdown(dropdown => dropdown
        .addOption("http", t("Remote server · HTTP", "远程服务 · HTTP"))
        .addOption("sse", t("Remote server · SSE (legacy)", "远程服务 · SSE（旧版）"))
        .addOption("stdio", t("Local process · stdio", "本机程序 · stdio"))
        .setValue(settings.mcpTransport === "stdio" || settings.mcpTransport === "sse" ? settings.mcpTransport : "http")
        .onChange(async value => {
          settings.mcpTransport = value === "stdio" || value === "sse" ? value : "http";
          await this.markDirty();
          this.update();
        }));
    });

    if (settings.mcpTransport === "stdio") {
    this.addSetting(page, t("Process configuration · JSON", "程序配置 · JSON"), t("Only connect trusted programs; the server runs with your user permissions.", "仅连接可信程序；服务将以当前用户权限运行。"), setting => {
      setting
        .addTextArea(text => {
          text.inputEl.rows = 5;
          text.setValue(String(settings.mcpStdioConfig || '{"command":"","args":[],"env":{},"cwd":""}'));
          text.onChange(async value => {
            settings.mcpStdioConfig = value;
            await this.markDirty();
          });
        });
    });
    } else {
    this.addSetting(page, t("Service URL", "服务地址"), "", setting => {
      setting
        .addText(text => text.setPlaceholder("https://server.example/mcp").setValue(String(settings.mcpEndpoint || "")).onChange(async value => {
          settings.mcpEndpoint = value.trim();
          await this.markDirty();
        }));
    });

    this.addSetting(page, t("Access token", "访问令牌"), t("Fill in when the server requires authentication.", "服务要求认证时填写。"), setting => {
      setting
        .addText(text => {
          text.inputEl.type = "password";
          text.setValue(String(settings.mcpApiKey || "")).onChange(async value => {
            settings.mcpApiKey = value.trim();
            await this.markDirty();
          });
        });
    });
    }
  }

  private renderFileSettings(page: SettingsRows): void {
    const settings = this.currentSettings();
    const links = this.group(page, t("Linked notes", "关联笔记"));
    this.addSetting(links, t("Index canvas links", "将画布链接加入索引"), t("Let Obsidian recognize note links inside canvases.", "让 Obsidian 识别画布中的笔记链接。"), setting => {
      setting
      .addToggle(toggle => toggle.setValue(Boolean(settings.canvasMetadataEnabled)).onChange(async value => { settings.canvasMetadataEnabled = value; await this.markDirty(); }));
    });
    this.addSetting(links, t("Auto-connect by note property", "按笔记属性自动连线"), t("Reads a property from notes and connects related file cards.", "读取笔记中指定的属性，连接相关文件卡片。"), setting => {
      setting
      .addToggle(toggle => toggle.setValue(Boolean(settings.autoFileNodeEdgesEnabled)).onChange(async value => { settings.autoFileNodeEdgesEnabled = value; await this.markDirty(); this.update(); }));
    });
    if (settings.autoFileNodeEdgesEnabled) {
    this.addSetting(links, t("Property name", "读取的属性名"), t("For example canvas-edges.", "例如 canvas-edges。"), setting => {
      setting
        .addText(text => text.setPlaceholder("canvas-edges").setValue(String(settings.autoEdgesFrontmatterKey || "canvas-edges"))
          .onChange(async value => { settings.autoEdgesFrontmatterKey = value.trim() || "canvas-edges"; await this.markDirty(); }));
    });
    }
    const exports = this.group(page, t("Image export", "导出图像"));
    this.addSetting(exports, t("Resolution", "清晰度"), t("Higher multipliers produce larger images.", "倍数越高，图像尺寸越大。"), setting => {
      setting
      .addDropdown(dropdown => {
        for (const ratio of [1, 1.5, 2, 3, 4]) dropdown.addOption(String(ratio), String(ratio) + "×");
        dropdown.setValue(String(Number(settings.exportPixelRatio) || 2)).onChange(async value => { settings.exportPixelRatio = Number(value); await this.markDirty(); });
      });
    });
    this.addSetting(exports, t("Background", "背景"), "", setting => {
      setting
      .addDropdown(dropdown => dropdown.addOption("transparent", t("Transparent", "透明")).addOption("custom", t("Custom color", "自定义颜色"))
        .setValue(settings.exportBackgroundColor ? "custom" : "transparent")
        .onChange(async value => { settings.exportBackgroundColor = value === "custom" ? "#ffffff" : ""; await this.markDirty(); this.update(); }));
    });
    if (settings.exportBackgroundColor) {
    this.addSetting(exports, t("Background color", "背景颜色"), "", setting => {
      setting
        .addText(text => text.setValue(String(settings.exportBackgroundColor)).onChange(async value => {
          const candidate = value.trim();
          const probe = createSpan();
          probe.style.backgroundColor = candidate;
          if (!candidate || !probe.style.backgroundColor) { text.inputEl.setAttribute("aria-invalid", "true"); return; }
          text.inputEl.removeAttribute("aria-invalid");
          settings.exportBackgroundColor = candidate;
          await this.markDirty();
        }));
    });
    }
    page.push({ name: t("Export format and range are chosen in the canvas export command.", "导出格式与范围，在画布的导出命令中选择。") });
  }
}
