import { App, Modal, Notice, Platform, PluginSettingTab, Setting, SettingGroup, setIcon, type DropdownComponent, type TextComponent } from "obsidian";
import { t } from "./i18n";
import { normalizeNamedPromptProfiles, removeNamedPromptProfile, upsertNamedPromptProfile } from "./prompt-profiles";
import { modelCapabilityReportKey, type ModelCapabilityReport } from "./model-capabilities";
import { normalizeTemperatureForProtocol, parseProviderParamsJson, providerTemperatureLimit, type ProviderRequestProtocol } from "./provider-params";
import { confirmAndRemoveProviderProfile } from "./provider-profile-actions";
import { validateNumericRangeInput } from "./numeric-range-validation";
import { normalizeDefaultNodeTextAlignment } from "./node-defaults";
import { listCodexModels } from "./codex-models";
import { listOpenCodeModels } from "./opencode-acp";
import { discoverAgentBinary } from "./local-agent-discovery";
import { LOCAL_AGENTS, localAgentDefinition, localAgentConfig, updateLocalAgentConfig, localModelChoices, type LocalAgentBackend, type LocalModelOption } from "./local-agent-settings";

let numericRangeDescriptionId = 0;

function temperatureRangeDescription(protocol: ProviderRequestProtocol): string {
  return t("Temperature range 0 to " + providerTemperatureLimit(protocol) + "; empty or invalid input keeps the previous valid value.", "Temperature 范围 0 到 " + providerTemperatureLimit(protocol) + "；留空或无效输入不会覆盖上一次有效值。");
}

export default class BetterCanvasSettingsTab extends PluginSettingTab {
  icon = "layout-dashboard";
  private draftSettings: any = null;
  private baseSettings: any = null;
  private hasUnsavedChanges = false;
  private isSaving = false;
  private saveButton: HTMLButtonElement | null = null;
  private discardButton: HTMLButtonElement | null = null;
  private saveStatus: HTMLElement | null = null;
  private activeSection = "canvas";
  private expandedSections = new Set<string>();
  private providerModal: Modal | null = null;
  private localModelCatalogs = new Map<string, LocalModelOption[]>();
  private localModelRequest: AbortController | null = null;
  private onReturnCallback: (() => void) | null = null;
  private returnButton: HTMLButtonElement | null = null;

  private readonly plugin: any;

  constructor(app: App, plugin: any, private features: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  openSection(section: string, callbacks: { onReturn?: () => void } = {}): void {
    if (["canvas", "interaction", "ai", "files"].includes(section)) this.activeSection = section;
    this.draftSettings = null;
    this.baseSettings = null;
    this.hasUnsavedChanges = false;
    const settingsApi = (this.app as any).setting;
    const pluginId = String((this.plugin as any)?.manifest?.id || "");
    settingsApi?.open?.();
    if (pluginId) settingsApi?.openTabById?.(pluginId);
    this.onReturnCallback = callbacks.onReturn ?? null;
    this.display();
  }

  hide(): void {
    this.cancelLocalModelRequest();
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
    (this.app as any).setting?.close?.();
    callback();
  }

  private cloneSettings(settings: any): any {
    return JSON.parse(JSON.stringify(settings ?? {}));
  }

  private currentSettings(): any {
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
    const pages = this.containerEl.querySelector<HTMLElement>(".bc-settings-pages");
    if (pages) pages.inert = this.isSaving;
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
    this.display();
  }

  private async saveDraftSettings(): Promise<void> {
    if (!this.hasUnsavedChanges || this.isSaving) return;
    const live = this.features.settings() as Record<string, unknown>;
    const previous = this.cloneSettings(live);
    const draft = this.cloneSettings(this.currentSettings());
    // Merge only edited fields so background usage records and capability reports survive.
    const changed = new Set([...Object.keys(this.baseSettings), ...Object.keys(draft)]);
    for (const key of changed) {
      if (JSON.stringify(this.baseSettings[key]) === JSON.stringify(draft[key])) continue;
      if (key in draft) live[key] = draft[key];
      else delete live[key];
    }
    this.isSaving = true;
    this.updateSaveStatus();
    try {
      await this.features.save();
    } catch (error) {
      for (const key of changed) {
        if (JSON.stringify(this.baseSettings[key]) === JSON.stringify(draft[key])) continue;
        if (key in previous) live[key] = previous[key];
        else delete live[key];
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
    this.display();
  }

  display(): void {
    this.cancelLocalModelRequest();
    this.currentSettings();
    const root = this.containerEl;
    root.empty();
    root.addClass("bc-settings-root");
    const sections = [
      { id: "canvas", title: t("Canvas", "画布"), render: (page: HTMLElement) => this.renderCanvasSettings(page) },
      { id: "interaction", title: t("Interaction", "操作"), render: (page: HTMLElement) => this.renderInteractionSettings(page) },
      { id: "ai", title: t("AI assistant", "AI 助手"), render: (page: HTMLElement) => this.renderAISettings(page) },
      { id: "files", title: t("Files", "文件"), render: (page: HTMLElement) => this.renderFileSettings(page) }
    ];
    const nav = root.createEl("nav", { cls: "bc-settings-nav", attr: { "aria-label": t("Settings categories", "设置分类") } });
    for (const section of sections) {
      const button = nav.createEl("button", {
        cls: "bc-settings-nav-button mod-subtle",
        text: section.title,
        attr: { type: "button", "aria-controls": "bc-settings-page" }
      });
      const active = this.activeSection === section.id;
      button.toggleClass("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        this.activeSection = section.id;
        this.display();
        root.scrollTop = 0;
        root.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus({ preventScroll: true });
      });
    }
    const page = root.createDiv({ cls: "bc-settings-pages", attr: { id: "bc-settings-page" } });
    page.dataset.section = this.activeSection;
    (sections.find(section => section.id === this.activeSection) ?? sections[0]).render(page);
    const footer = root.createDiv({ cls: "bc-settings-actions" });
    this.saveStatus = footer.createSpan({ cls: "bc-settings-save-status", attr: { role: "status", "aria-live": "polite" } });
    const actions = footer.createDiv({ cls: "bc-settings-footer-buttons" });
    this.discardButton = actions.createEl("button", { text: t("Discard changes", "放弃更改"), attr: { type: "button" } });
    this.discardButton.addEventListener("click", () => this.discardChanges());
    this.saveButton = actions.createEl("button", { text: t("Save changes", "保存更改"), cls: "mod-cta", attr: { type: "button" } });
    this.saveButton.addEventListener("click", () => { void this.saveDraftSettings(); });
    this.returnButton = null;
    if (this.onReturnCallback) {
      this.returnButton = actions.createEl("button", { text: t("Back to question", "返回提问"), attr: { type: "button" } });
      this.returnButton.addEventListener("click", () => this.returnToQuestion());
    }
    this.updateSaveStatus();
  }

  private cancelLocalModelRequest(): void {
    this.localModelRequest?.abort();
    this.localModelRequest = null;
  }

  private group(page: HTMLElement, title?: string): HTMLElement {
    // SettingGroup was added in Obsidian 1.11; keep the declared 1.5 minimum working.
    if (typeof SettingGroup === "function") {
      const group = new SettingGroup(page).addClass("bc-settings-group");
      if (title) group.setHeading(title);
      return group.listEl;
    }
    const group = page.createDiv({ cls: "bc-settings-group" });
    if (title) new Setting(group).setName(title).setHeading();
    return group;
  }

  private details(page: HTMLElement, id: string, title: string, description = ""): HTMLElement {
    const details = page.createEl("details", { cls: "bc-settings-details" });
    details.open = this.expandedSections.has(id);
    const summary = details.createEl("summary");
    const heading = new Setting(summary).setName(title).setDesc(description);
    setIcon(heading.controlEl.createSpan({ cls: "bc-settings-chevron", attr: { "aria-hidden": "true" } }), "chevron-right");
    details.addEventListener("toggle", () => {
      if (!details.isConnected) return;
      if (details.open) this.expandedSections.add(id);
      else this.expandedSections.delete(id);
    });
    return this.group(details);
  }

  private syncLegacyProvider(profile: any, settings: any): void {
    if (settings.activeProviderId !== profile.id) return;
    settings.baseUrl = String(profile.baseUrl ?? "");
    settings.apiKey = String(profile.apiKey ?? "");
    settings.model = String(profile.model ?? "");
  }

  private async saveProvider(profile: any, settings: any): Promise<void> {
    this.syncLegacyProvider(profile, settings);
    await this.markDirty();
  }

  private addNumericRangeSetting(
    page: HTMLElement,
    name: string,
    currentValue: number,
    min: number,
    max: number,
    onValidChange: (value: number) => Promise<void>,
    options: { description?: string; step?: string; integer?: boolean; allowEmpty?: boolean } = {}
  ): void {
    const setting = new Setting(page).setName(name);
    setting.descEl.createSpan({ cls: "bc-settings-number-description", text: options.description ?? "" });
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

  }

  private renderCanvasSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    const cards = this.group(page, t("New cards", "新建卡片"));
    new Setting(cards).setName(t("Text alignment", "文字对齐"))
      .setDesc(t("Used for new cards. When fitting content, single lines are centered and multiple lines are left-aligned.", "用于新卡片。自动适应内容时，单行居中，多行左对齐。"))
      .addDropdown(dropdown => dropdown.addOption("left", t("Left", "左对齐")).addOption("center", t("Center", "居中")).addOption("right", t("Right", "右对齐"))
        .setValue(normalizeDefaultNodeTextAlignment(settings.defaultNodeTextAlign))
        .onChange(async value => { settings.defaultNodeTextAlign = normalizeDefaultNodeTextAlignment(value); await this.markDirty(); }));
    const layout = this.group(page, t("Auto layout", "自动布局"));
    new Setting(layout).setName(t("Layout direction", "排列方向")).setDesc(t("Direction cards spread in when arranged.", "整理卡片时，沿这个方向展开。"))
      .addDropdown(dropdown => dropdown.addOption("LR", t("Left to right", "从左到右")).addOption("RL", t("Right to left", "从右到左")).addOption("TB", t("Top to bottom", "从上到下")).addOption("BT", t("Bottom to top", "从下到上"))
        .setValue(String(settings.direction || "LR"))
        .onChange(async value => { settings.direction = value; await this.markDirty(); }));
    this.addNumericRangeSetting(layout, t("Horizontal gap", "水平间距"), settings.gapX ?? 100, 0, 1000, async value => { settings.gapX = value; await this.markDirty(); }, { description: t("Horizontal distance between cards, in px.", "卡片之间的水平距离，单位 px。") });
    this.addNumericRangeSetting(layout, t("Vertical gap", "垂直间距"), settings.gapY ?? 44, 0, 1000, async value => { settings.gapY = value; await this.markDirty(); }, { description: t("Vertical distance between cards, in px.", "卡片之间的垂直距离，单位 px。") });
    const grid = this.details(page, "grid", t("Grid spacing", "网格间距"), t("Used when snapping to the grid.", "用于对齐到网格。"));
    this.addNumericRangeSetting(grid, t("Grid size", "网格大小"), settings.gridSize ?? 20, 1, 500, async value => { settings.gridSize = value; await this.markDirty(); }, { description: t("In px.", "单位 px。") });
  }

  private renderInteractionSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    const keyboard = this.group(page, t("Keyboard", "键盘"));
    const shortcuts = [
      ["mindMapShortcutChildTabEnabled", t("Create child card", "创建子卡片"), t("Tab; use Shift + Tab while editing text.", "Tab；编辑文字时使用 Shift + Tab。")],
      ["mindMapShortcutSiblingEnterEnabled", t("Create sibling card", "创建同级卡片"), t("Enter; use Shift + Enter while editing text.", "Enter；编辑文字时使用 Shift + Enter。")],
      ["mindMapShortcutAltArrowNavigationEnabled", t("Jump to adjacent card", "跳到相邻卡片"), t("Alt + arrow keys.", "Alt + 方向键。")],
      ["mindMapShortcutDirectionalCreationEnabled", t("Create card in a direction", "向指定方向创建卡片"), t("Ctrl / Cmd + arrow keys, including Shift combinations.", "Ctrl / Cmd + 方向键，同时控制带 Shift 的组合键。")]
    ];
    for (const [key, title, description] of shortcuts) {
      new Setting(keyboard).setName(title).setDesc(description)
        .addToggle(toggle => toggle.setValue(settings[key] !== false).onChange(async value => { settings[key] = value; await this.markDirty(); }));
    }
    const readonly = this.group(page, t("Read-only mode", "只读模式"));
    new Setting(readonly).setName(t("Hide context menu", "隐藏右键菜单")).setDesc(t("In read-only mode, do not open the canvas context menu.", "只读时，不打开画布的右键菜单。"))
      .addToggle(toggle => toggle.setValue(settings.readOnlyDisableNodeMenusEnabled !== false)
        .onChange(async value => { settings.readOnlyDisableNodeMenusEnabled = value; await this.markDirty(); }));
    new Setting(readonly).setName(t("Lock view", "固定视图")).setDesc(t("In read-only mode, lock panning and zooming. Commands can still zoom to all content or the selected cards.", "只读时，锁定拖动画布和缩放。仍可通过命令缩放到全部内容或所选卡片。"))
      .addToggle(toggle => toggle.setValue(settings.readOnlyLockPanZoomEnabled === true)
        .onChange(async value => { settings.readOnlyLockPanZoomEnabled = value; await this.markDirty(); }));
    const guide = this.group(page, t("Getting started", "首次使用"));
    new Setting(guide).setName(t("Show onboarding again", "重新显示引导"))
      .setDesc(t("Resets the welcome entry and empty-canvas hints. Does not delete canvases or AI settings.", "重置欢迎入口和空画布提示。不会删除画布或 AI 设置。"))
      .addButton(button => button.setButtonText(t("Reset onboarding", "重置引导")).onClick(async () => {
        settings.onboarding = this.features.resetOnboardingSettings();
        await this.markDirty();
      }));
  }

  private renderAISettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    const text = this.group(page, t("Text generation", "文字生成"));
    new Setting(text).setName(t("Provider", "使用方式")).setDesc(t("Choose the model service or local tool you already use.", "选择你已经在用的模型服务或本地工具。"))
      .addDropdown(dropdown => {
        dropdown.addOption("api", t("Model service API", "模型服务 API"));
        for (const agent of LOCAL_AGENTS) dropdown.addOption(agent.id, agent.name);
        dropdown.setValue(localAgentDefinition(settings.backend) ? settings.backend : "api")
          .onChange(async value => { settings.backend = value; await this.markDirty(); this.display(); });
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

  private renderLocalAgentSettings(group: HTMLElement, page: HTMLElement, backend: LocalAgentBackend): void {
    const settings = this.currentSettings();
    const agent = localAgentDefinition(backend)!;
    let dropdown: DropdownComponent;
    let manualInput: TextComponent | undefined;
    let resetCatalog = () => {};
    const catalogKey = () => JSON.stringify([backend, localAgentConfig(settings, backend).binaryPath]);
    const modelSetting = new Setting(group).setName(t("Model", "模型"));
    modelSetting.settingEl.addClass("bc-local-model-setting");
    const populate = () => {
      const selected = localAgentConfig(settings, backend).model;
      dropdown.selectEl.empty();
      dropdown.addOption("", t("Use tool default model", "使用工具默认模型"));
      const models = this.localModelCatalogs.get(catalogKey()) ?? agent.models;
      for (const model of localModelChoices(models, selected)) {
        dropdown.addOption(model.id, model.name === model.id ? model.id : `${model.name} · ${model.id}`);
      }
      dropdown.setValue(selected);
    };
    modelSetting
      .setDesc(agent.supportsModel === false
        ? t("IBM Bob uses its own configured model; the current command line offers no model override flag.", "IBM Bob 使用自身配置的模型；当前命令行未提供模型覆盖参数。")
        : agent.discovery
          ? t("Click “Load models” to fetch the list from the local tool. Pick one, then click “Save changes”.", "点击「读取模型」从本机工具获取列表。选择后点击「保存更改」生效。")
          : t("The list shows common model IDs; availability depends on the tool and account. You can also expand the settings below to enter one manually.", "列表为常用模型 ID，实际可用性取决于工具和账号。也可展开下方设置手动填写。"))
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
            if (this.localModelCatalogs.size > 8) this.localModelCatalogs.delete(this.localModelCatalogs.keys().next().value!);
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
    let pathInput: TextComponent | undefined;
    const pathSetting = new Setting(group).setName(t("Program path", "程序路径"))
      .setDesc(t("Desktop only. When empty, checks PATH first, then common install locations such as Homebrew, npm, Bun, ~/.local/bin, and ~/.opencode.", "仅支持桌面版。留空时先查 PATH，再查 Homebrew、npm、Bun、~/.local/bin、~/.opencode 等常见安装位置。"));
    pathSetting.addText(input => {
      pathInput = input;
      input.setPlaceholder(agent.binary).setValue(localAgentConfig(settings, backend).binaryPath)
        .onChange(async value => {
          updateLocalAgentConfig(settings, backend, { binaryPath: value.trim() });
          resetCatalog();
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
              resetCatalog();
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
    if (agent.supportsModel !== false) {
      const manual = this.details(page, "local-model-" + backend, t("Enter model manually", "手动填写模型"), t("When your model is not listed, enter the full model ID supported by the tool. Leave empty to restore the default.", "模型未列出时，填写工具支持的完整模型 ID。留空恢复默认。"));
      new Setting(manual).setName(t("Model ID", "模型 ID"))
        .setDesc(backend === "opencode-acp" ? t("For example provider/model; it must be a model offered by the current OpenCode session.", "例如 provider/model；必须是 OpenCode 当前会话提供的模型。") : t("Models for custom services may not appear in the tool's catalog.", "自定义服务的模型可能不在工具返回的目录中。"))
        .addText(input => {
          manualInput = input;
          input.setValue(localAgentConfig(settings, backend).model).setPlaceholder(t("Use tool default model", "使用工具默认模型"))
            .onChange(async value => {
              updateLocalAgentConfig(settings, backend, { model: value.trim() });
              populate();
              await this.markDirty();
            });
        });
    }
  }

  private renderModelServices(page: HTMLElement, settings: any, section: HTMLElement): void {
    const profiles = settings.providerProfiles as any[];
    const active = profiles?.find(profile => profile.id === settings.activeProviderId) ?? profiles?.[0];
    if (!active) {
      new Setting(page).setName(t("Connect a model service", "连接一个模型服务")).setDesc(t("Set it up once, then just pick a model.", "填写一次，之后只需选择模型。"))
        .addButton(button => button.setButtonText(t("Add service", "添加服务")).onClick(() => this.openProviderEditor()));
      return;
    }
    new Setting(page).setName(t("Model service", "模型服务")).setDesc(t("Choose the service to use.", "选择这次使用的服务。"))
      .addDropdown(dropdown => {
        for (const profile of profiles) dropdown.addOption(profile.id, String(profile.name || t("Untitled provider", "未命名服务")));
        dropdown.setValue(active.id).onChange(async id => {
          settings.activeProviderId = id;
          const profile = profiles.find(item => item.id === id);
          if (profile) this.syncLegacyProvider(profile, settings);
          await this.markDirty();
          this.display();
        });
      })
      .addExtraButton(button => button.setIcon("pencil").setTooltip(t("Edit service", "编辑服务")).onClick(() => this.openProviderEditor(active.id)))
      .addExtraButton(button => button.setIcon("plus").setTooltip(t("Add service", "添加服务")).onClick(() => this.openProviderEditor()));
    new Setting(page).setName(t("Default model", "默认模型")).setDesc(t("New chats use this model. Individual cards can choose their own.", "新对话使用这个模型。单张卡片也可以单独选择。"))
      .addText(text => text.setPlaceholder(t("Enter model name", "填写模型名称")).setValue(String(active.model || ""))
        .onChange(async value => { active.model = value.trim(); await this.saveProvider(active, settings); }));
    this.renderProviderParameters(this.details(section, "generation", t("Generation parameters", "生成参数"), t("Usually no changes needed.", "通常无需调整。")), active, settings);
  }

  private openProviderEditor(id?: string): void {
    const settings = this.currentSettings();
    const existing = (settings.providerProfiles as any[] | undefined)?.find(profile => profile.id === id);
    const profile = this.cloneSettings(existing ?? {
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
        .setValue(profile.protocol || "openai").onChange(value => { profile.protocol = value; }));
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
      remove.addEventListener("click", () => {
        const result = confirmAndRemoveProviderProfile(settings.providerProfiles, String(existing.id), settings.activeProviderId, message => window.confirm(message));
        if (!result.confirmed) return;
        settings.activeProviderId = result.activeProviderId;
        if (result.activeProfile) this.syncLegacyProvider(result.activeProfile, settings);
        void this.markDirty();
        modal.close();
        this.display();
      });
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
      profile.temperature = normalizeTemperatureForProtocol(profile.temperature, profile.protocol);
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
      this.display();
    });
    modal.onClose = () => { modal.contentEl.empty(); if (this.providerModal === modal) this.providerModal = null; };
    modal.open();
  }

  private renderProviderParameters(page: HTMLElement, profile: any, settings: any): void {
      this.addNumericRangeSetting(
        page,
        t("Randomness", "随机程度"),
        typeof profile.temperature === "number" ? profile.temperature : 0.4,
        0,
        providerTemperatureLimit(profile.protocol),
        async number => {
          profile.temperature = number;
          await this.saveProvider(profile, settings);
        },
        {
          description: temperatureRangeDescription(profile.protocol),
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

      const paramsSetting = new Setting(page).setName(t("Extra request parameters · JSON", "额外请求参数 · JSON"))
        .setDesc(t("Extra parameters are merged per protocol: OpenAI compatible / Anthropic at the request top level, Gemini inside generationConfig. Core and auth fields are reserved by the plugin.", "额外参数按协议合并：OpenAI 兼容 / Anthropic 在请求顶层，Gemini 放入 generationConfig。核心字段与认证字段由插件保留。"));
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


      const effectiveModel = profile.id === "default"
        ? String(profile.model || settings.model || "")
        : String(profile.model || "");
      const effectiveProtocol = profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai";
      const reportKey = modelCapabilityReportKey(String(profile.id), effectiveProtocol, effectiveModel);
      const report = settings.modelCapabilityReports && typeof settings.modelCapabilityReports === "object"
        ? settings.modelCapabilityReports[reportKey] as ModelCapabilityReport | undefined
        : undefined;
      const statusLabel = (status: string): string => status === "accepted" ? t("Accepted", "已接受") : status === "failed" ? t("Failed", "失败") : t("Not run", "未执行");
      const probeSetting = new Setting(page).setName(t("Model capability probe", "模型能力探测"))
        .setDesc(t("Manually sends one text request and, if it succeeds, one tiny image input request; this may incur provider charges. Does not probe image generation, PDF, video, URL context, or search capabilities.", "手动发送一次文本请求和（若文本成功）一次微型图片输入请求；可能产生供应商费用。不会自动探测图片生成、PDF、视频、URL context 或搜索能力。"));
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
            if (!window.confirm(t("Send up to two API requests using “", "将使用“") + String(profile.name || profile.id) + " / " + effectiveModel + t("”? This may incur charges. Continue?", "”发送最多两次 API 请求。这可能产生费用。继续？"))) return;
            button.setDisabled(true);
            button.setButtonText(t("Probing…", "正在探测…"));
            try {
              const result = await this.features.probeProviderCapabilities(String(profile.id));
              new Notice(t("Capability probe complete: text ", "能力探测完成：文本 ") + statusLabel(result.text.status) + t("; image input ", "；图片输入 ") + statusLabel(result.imageInput.status));
              const reports = this.cloneSettings(this.features.settings().modelCapabilityReports);
              this.currentSettings().modelCapabilityReports = reports;
              this.baseSettings.modelCapabilityReports = this.cloneSettings(reports);
              await this.markDirty();
              this.display();
            } catch (error) {
              button.setDisabled(false);
              button.setButtonText(t("Probe again", "重新探测"));
              new Notice(error instanceof Error ? error.message : String(error), 8000);
            }
          }));

  }

  private renderPromptSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    new Setting(page).setName(t("How should the AI answer?", "希望 AI 怎样回答？"))
      .setDesc(t("For example: lead with the conclusion, answer in English, and state uncertainty directly.", "例如：先给结论，用中文回答，不确定时直接说明。"))
      .addTextArea(text => {
        text.inputEl.rows = 4;
        text.setValue(String(settings.systemPrompt || "You are a precise assistant. Preserve uncertainty."));
        text.onChange(async value => {
          settings.systemPrompt = value;
          await this.markDirty();
        });
      });

    const promptProfiles = normalizeNamedPromptProfiles(settings.systemPromptProfiles);
    settings.systemPromptProfiles = promptProfiles;
    const activePromptId = String(settings.activeSystemPromptProfile || "");
    let profileNameInput = promptProfiles.find(profile => profile.id === activePromptId)?.name ?? "";

    new Setting(page).setName(t("Saved preferences", "已存偏好"))
      .setDesc(t("Save reusable system prompts. Selecting one replaces the current system prompt; after manual edits, save again with the same name to overwrite.", "保存多套可复用的系统提示词。选择后会替换当前系统提示词；手动修改后可用相同名称覆盖保存。"))
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
          this.display();
        });
      });

    new Setting(page).setName(t("Save this preference", "保存这组偏好"))
      .setDesc(t("Enter a name; an existing profile with the same name is updated instead of duplicated.", "输入一个名称；已存在同名配置时会更新该配置，不会创建重复项。"))
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
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 6000);
          }
        }));

    new Setting(page).setName(t("Delete saved preference", "删除已存偏好"))
      .setDesc(t("Deletes only the saved prompt profile; the current system prompt stays.", "只删除已保存的提示词配置，不会清空当前系统提示词。"))
      .addButton(button => button
        .setButtonText(t("Delete selected profile", "删除所选配置"))
        .setWarning()
        .onClick(async () => {
          const id = String(settings.activeSystemPromptProfile || "");
          const selected = normalizeNamedPromptProfiles(settings.systemPromptProfiles)
            .find(profile => profile.id === id);
          if (!selected) {
            new Notice(t("Select a named prompt to delete first.", "请先选择要删除的命名提示词。"));
            return;
          }
          if (!window.confirm(t("Delete the named prompt “", "删除命名提示词“") + selected.name + t("”? The current system prompt text is kept.", "”？当前系统提示词文本会保留。"))) return;
          settings.systemPromptProfiles = removeNamedPromptProfile(
            normalizeNamedPromptProfiles(settings.systemPromptProfiles),
            selected.id
          );
          settings.activeSystemPromptProfile = "";
          await this.markDirty();
          new Notice(t("Named prompt deletion staged: ", "已暂存删除的命名提示词：") + selected.name);
          this.display();
        }));


  }

  private renderImageSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    new Setting(page).setName(t("API type", "接口类型"))
      .setDesc(t("The provider, key, and model here are separate from text generation.", "此处的服务商、密钥与模型独立于文本生成配置。"))
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
          this.display();
        }));
    new Setting(page).setName(t("Service URL", "服务地址"))
      .addText(text => text.setPlaceholder(settings.imageProtocol === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1")
        .setValue(String(settings.imageBaseUrl || ""))
        .onChange(async value => { settings.imageBaseUrl = value.trim(); await this.markDirty(); }));
    new Setting(page).setName(t("API key", "API 密钥"))
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder(t("Optional", "可留空")).setValue(String(settings.imageApiKey || "")).onChange(async value => {
          settings.imageApiKey = value.trim();
          await this.markDirty();
        });
      });
    new Setting(page).setName(t("Image model", "图片模型"))
      .addText(text => text.setPlaceholder(t("For example: gpt-image-1 or gemini-2.5-flash-image", "例如：gpt-image-1 或 gemini-2.5-flash-image"))
        .setValue(String(settings.imageModel || "gpt-image-1"))
        .onChange(async value => { settings.imageModel = value.trim(); await this.markDirty(); }));
    new Setting(page).setName(t("Save to", "保存到"))
      .addText(text => text.setPlaceholder("Better Canvas/Generated Images")
        .setValue(String(settings.attachmentFolder || "Better Canvas/Generated Images"))
        .onChange(async value => { settings.attachmentFolder = value.trim() || "Better Canvas/Generated Images"; await this.markDirty(); }));

  }

  private renderFlashcardSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    new Setting(page).setName(t("Save as", "保存为"))
      .setDesc(t("Creates Canvas nodes by default; can also export a Markdown deck that Obsidian Spaced Repetition recognizes.", "默认创建 Canvas 节点；也可导出为 Obsidian Spaced Repetition 可识别的 Markdown 卡组。"))
      .addDropdown(dropdown => dropdown
        .addOption("canvas", t("Canvas cards", "画布卡片"))
        .addOption("spaced-repetition", t("Markdown review deck", "Markdown 复习卡组"))
        .setValue(settings.flashcardOutputMode === "spaced-repetition" ? "spaced-repetition" : "canvas")
        .onChange(async value => {
          settings.flashcardOutputMode = value === "spaced-repetition" ? "spaced-repetition" : "canvas";
          await this.markDirty();
          this.display();
        }));

    if (settings.flashcardOutputMode === "spaced-repetition") {
      new Setting(page).setName(t("Save to", "保存到"))
        .setDesc(t("Relative folder inside the vault. An existing note with the same name gets a new file name instead of being overwritten.", "Vault 内的相对目录。已有同名笔记会自动使用新文件名，不会被覆盖。"))
        .addText(text => text.setPlaceholder("Better Canvas/Flashcards")
          .setValue(String(settings.spacedRepetitionFolder || "Better Canvas/Flashcards"))
          .onChange(async value => {
            settings.spacedRepetitionFolder = value.trim() || "Better Canvas/Flashcards";
            await this.markDirty();
          }));
      new Setting(page).setName(t("Deck tag", "卡组标签"))
        .setDesc(t("Enter a topic path, for example science/biology; the final tag is #flashcards/science/biology.", "输入主题路径，例如 science/biology；最终标签为 #flashcards/science/biology。"))
        .addText(text => text.setPlaceholder("better-canvas")
          .setValue(String(settings.spacedRepetitionDeck || "better-canvas"))
          .onChange(async value => {
            settings.spacedRepetitionDeck = value.trim() || "better-canvas";
            await this.markDirty();
          }));
    }



  }

  private renderMcpSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    new Setting(page).setName(t("Connection type", "连接方式")).setDesc(t("Let the AI use external tools; it asks for confirmation before running them.", "让 AI 使用外部工具；执行前会请你确认。"))
      .addDropdown(dropdown => dropdown
        .addOption("http", t("Remote server · HTTP", "远程服务 · HTTP"))
        .addOption("sse", t("Remote server · SSE (legacy)", "远程服务 · SSE（旧版）"))
        .addOption("stdio", t("Local process · stdio", "本机程序 · stdio"))
        .setValue(settings.mcpTransport === "stdio" || settings.mcpTransport === "sse" ? settings.mcpTransport : "http")
        .onChange(async value => {
          settings.mcpTransport = value === "stdio" || value === "sse" ? value : "http";
          await this.markDirty();
          this.display();
        }));

    if (settings.mcpTransport === "stdio") {
      new Setting(page).setName(t("Process configuration · JSON", "程序配置 · JSON"))
        .setDesc(t("Only connect trusted programs; the server runs with your user permissions.", "仅连接可信程序；服务将以当前用户权限运行。"))
        .addTextArea(text => {
          text.inputEl.rows = 5;
          text.setValue(String(settings.mcpStdioConfig || '{"command":"","args":[],"env":{},"cwd":""}'));
          text.onChange(async value => {
            settings.mcpStdioConfig = value;
            await this.markDirty();
          });
        });
    } else {
      new Setting(page).setName(t("Service URL", "服务地址"))
        .addText(text => text.setPlaceholder("https://server.example/mcp").setValue(String(settings.mcpEndpoint || "")).onChange(async value => {
          settings.mcpEndpoint = value.trim();
          await this.markDirty();
        }));

      new Setting(page).setName(t("Access token", "访问令牌")).setDesc(t("Fill in when the server requires authentication.", "服务要求认证时填写。"))
        .addText(text => {
          text.inputEl.type = "password";
          text.setValue(String(settings.mcpApiKey || "")).onChange(async value => {
            settings.mcpApiKey = value.trim();
            await this.markDirty();
          });
        });
    }
  }

  private renderFileSettings(page: HTMLElement): void {
    const settings = this.currentSettings();
    const links = this.group(page, t("Linked notes", "关联笔记"));
    new Setting(links).setName(t("Index canvas links", "将画布链接加入索引")).setDesc(t("Let Obsidian recognize note links inside canvases.", "让 Obsidian 识别画布中的笔记链接。"))
      .addToggle(toggle => toggle.setValue(Boolean(settings.canvasMetadataEnabled)).onChange(async value => { settings.canvasMetadataEnabled = value; await this.markDirty(); }));
    new Setting(links).setName(t("Auto-connect by note property", "按笔记属性自动连线")).setDesc(t("Reads a property from notes and connects related file cards.", "读取笔记中指定的属性，连接相关文件卡片。"))
      .addToggle(toggle => toggle.setValue(Boolean(settings.autoFileNodeEdgesEnabled)).onChange(async value => { settings.autoFileNodeEdgesEnabled = value; await this.markDirty(); this.display(); }));
    if (settings.autoFileNodeEdgesEnabled) {
      new Setting(links).setName(t("Property name", "读取的属性名")).setDesc(t("For example canvas-edges.", "例如 canvas-edges。"))
        .addText(text => text.setPlaceholder("canvas-edges").setValue(String(settings.autoEdgesFrontmatterKey || "canvas-edges"))
          .onChange(async value => { settings.autoEdgesFrontmatterKey = value.trim() || "canvas-edges"; await this.markDirty(); }));
    }
    const exports = this.group(page, t("Image export", "导出图像"));
    new Setting(exports).setName(t("Resolution", "清晰度")).setDesc(t("Higher multipliers produce larger images.", "倍数越高，图像尺寸越大。"))
      .addDropdown(dropdown => {
        for (const ratio of [1, 1.5, 2, 3, 4]) dropdown.addOption(String(ratio), String(ratio) + "×");
        dropdown.setValue(String(Number(settings.exportPixelRatio) || 2)).onChange(async value => { settings.exportPixelRatio = Number(value); await this.markDirty(); });
      });
    new Setting(exports).setName(t("Background", "背景"))
      .addDropdown(dropdown => dropdown.addOption("transparent", t("Transparent", "透明")).addOption("custom", t("Custom color", "自定义颜色"))
        .setValue(settings.exportBackgroundColor ? "custom" : "transparent")
        .onChange(async value => { settings.exportBackgroundColor = value === "custom" ? "#ffffff" : ""; await this.markDirty(); this.display(); }));
    if (settings.exportBackgroundColor) {
      new Setting(exports).setName(t("Background color", "背景颜色"))
        .addText(text => text.setValue(String(settings.exportBackgroundColor)).onChange(async value => {
          const candidate = value.trim();
          const probe = document.createElement("span");
          probe.style.backgroundColor = candidate;
          if (!candidate || !probe.style.backgroundColor) { text.inputEl.setAttribute("aria-invalid", "true"); return; }
          text.inputEl.removeAttribute("aria-invalid");
          settings.exportBackgroundColor = candidate;
          await this.markDirty();
        }));
    }
    page.createEl("p", { cls: "bc-settings-note", text: t("Export format and range are chosen in the canvas export command.", "导出格式与范围，在画布的导出命令中选择。") });
  }
}
