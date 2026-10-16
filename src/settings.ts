import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { normalizeNamedPromptProfiles, removeNamedPromptProfile, upsertNamedPromptProfile } from "./prompt-profiles";
import { modelCapabilityReportKey, type ModelCapabilityReport } from "./model-capabilities";
import {
  normalizeTemperatureForProtocol,
  parseProviderParamsJson,
  providerTemperatureLimit,
  type ProviderRequestProtocol
} from "./provider-params";
import { confirmAndRemoveProviderProfile } from "./provider-profile-actions";
import { validateNumericRangeInput } from "./numeric-range-validation";
import { normalizeDefaultNodeTextAlignment } from "./node-defaults";

type SettingSection = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

/** A numeric row whose valid range can follow a neighbouring setting, such as the protocol. */
type NumericRangeSetting = {
  applyRange(next: { max: number; description: string; value: number }): void;
};

let numericRangeDescriptionId = 0;

function temperatureRangeDescription(protocol: ProviderRequestProtocol): string {
  return (protocol === "anthropic" ? "Anthropic 范围 0 到 " : "范围 0 到 ")
    + providerTemperatureLimit(protocol)
    + "；留空或无效输入不会覆盖上一次有效值。";
}

export default class BetterCanvasSettingsTab extends PluginSettingTab {
  private plugin: any;
  private activeSection = "canvas";
  private openAIAccordion: "text" | "image" | null = null;

  constructor(app: App, plugin: any, private features: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const root = this.containerEl;
    root.empty();
    root.addClass("bc-settings-root");
    const shell = root.createDiv({ cls: "bc-settings-shell" });
    const sidebar = shell.createDiv({ cls: "bc-settings-sidebar" });
    const brand = sidebar.createDiv({ cls: "bc-settings-brand" });
    brand.createEl("h2", { text: "Better Canvas" });
    brand.createEl("p", { text: "设置中心" });
    const sections: SettingSection[] = [
      { id: "canvas", icon: "▦", title: "画布与布局", description: "节点、间距、自动布局与快捷键" },
      { id: "appearance", icon: "◐", title: "样式与外观", description: "节点颜色与自定义 CSS" },
      { id: "ai", icon: "✳", title: "AI 与模型", description: "文本生成与图片生成" },
      { id: "integrations", icon: "↔", title: "连接与索引", description: "MCP、元数据、反向链接与内容来源" },
      { id: "export", icon: "⇧", title: "导出", description: "格式、清晰度、背景与范围" }
    ];
    const nav = sidebar.createDiv({ cls: "bc-settings-nav", attr: { "aria-label": "设置分类" } });
    const pagesHost = shell.createDiv({ cls: "bc-settings-main" });
    const pages = new Map<string, HTMLElement>();
    const navButtons = new Map<string, HTMLButtonElement>();
    for (const section of sections) {
      const button = nav.createEl("button", { cls: "bc-settings-nav-button", attr: { type: "button", "aria-pressed": "false" } });
      button.createEl("span", { cls: "bc-settings-nav-icon", text: section.icon });
      button.createEl("span", { cls: "bc-settings-nav-label", text: section.title });
      navButtons.set(section.id, button);
      const page = pagesHost.createDiv({ cls: "bc-settings-page" });
      page.dataset.section = section.id;
      const header = page.createDiv({ cls: "bc-settings-page-header" });
      header.createEl("h3", { text: section.title });
      header.createEl("p", { text: section.description });
      pages.set(section.id, page);
    }
    const updateView = (): void => {
      for (const section of sections) {
        const page = pages.get(section.id)!;
        const button = navButtons.get(section.id)!;
        const active = section.id === this.activeSection;
        page.style.display = active ? "" : "none";
        button.toggleClass("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }
    };
    for (const section of sections) navButtons.get(section.id)!.addEventListener("click", () => {
      this.activeSection = section.id;
      updateView();
    });
    this.renderCanvasSettings(pages.get("canvas")!);
    this.renderAppearanceSettings(pages.get("appearance")!);
    this.renderAISettings(pages.get("ai")!);
    this.renderIntegrationSettings(pages.get("integrations")!);
    this.renderExportSettings(pages.get("export")!);
    updateView();
  }

  private syncLegacyProvider(profile: any, settings: any): void {
    if (settings.activeProviderId !== profile.id) return;
    settings.baseUrl = String(profile.baseUrl ?? "");
    settings.apiKey = String(profile.apiKey ?? "");
    settings.model = String(profile.model ?? "");
  }

  private async saveProvider(profile: any, settings: any): Promise<void> {
    this.syncLegacyProvider(profile, settings);
    await this.features.save();
  }

  private addNumericRangeSetting(
    page: HTMLElement,
    name: string,
    currentValue: number,
    min: number,
    max: number,
    onValidChange: (value: number) => Promise<void>,
    options: { description?: string; step?: string; integer?: boolean; allowEmpty?: boolean } = {}
  ): NumericRangeSetting {
    const setting = new Setting(page).setName(name);
    const description = setting.descEl.createSpan({ cls: "bc-settings-number-description", text: options.description ?? "" });
    const feedback = setting.descEl.createSpan({ cls: "bc-settings-number-error" });
    feedback.hidden = true;
    feedback.setAttribute("role", "status");
    feedback.setAttribute("aria-live", "polite");

    const descriptionId = setting.descEl.id || ("bc-settings-number-description-" + (++numericRangeDescriptionId));
    setting.descEl.id = descriptionId;

    let currentMax = max;
    let inputEl: HTMLInputElement | null = null;
    let writeValue: ((value: number) => void) | null = null;

    setting.addText(text => {
      const input = text.inputEl;
      inputEl = input;
      writeValue = value => text.setValue(String(value));
      input.type = "number";
      input.min = String(min);
      input.max = String(currentMax);
      if (options.step) input.step = options.step;

      const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean));
      describedBy.add(descriptionId);
      input.setAttribute("aria-describedby", Array.from(describedBy).join(" "));

      text.setValue(String(currentValue)).onChange(async rawValue => {
        const number = validateNumericRangeInput(rawValue, min, currentMax, input, feedback, {
          integer: options.integer,
          allowEmpty: options.allowEmpty
        });
        if (number === null) return;
        await onValidChange(number);
      });
    });

    return {
      applyRange(next) {
        currentMax = next.max;
        description.setText(next.description);
        if (!inputEl || !writeValue) return;
        inputEl.max = String(next.max);
        writeValue(next.value);
        inputEl.removeAttribute("aria-invalid");
        feedback.textContent = "";
        feedback.hidden = true;
      }
    };
  }

  private renderCanvasSettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;

    new Setting(page).setName("自动布局方向")
      .addDropdown(dropdown => dropdown
        .addOption("LR", "从左到右")
        .addOption("RL", "从右到左")
        .addOption("TB", "从上到下")
        .addOption("BT", "从下到上")
        .setValue(String(this.plugin.settings.direction || "LR"))
        .onChange(async value => {
          this.plugin.settings.direction = value as any;
          await this.features.save();
        }));

    this.addNumericRangeSetting(page, "水平间距", this.plugin.settings.gapX ?? 100, 0, 1000, async number => {
      this.plugin.settings.gapX = number;
      await this.features.save();
    });

    this.addNumericRangeSetting(page, "垂直间距", this.plugin.settings.gapY ?? 44, 0, 1000, async number => {
      this.plugin.settings.gapY = number;
      await this.features.save();
    });

    this.addNumericRangeSetting(page, "网格大小", settings.gridSize ?? 20, 1, 500, async number => {
      settings.gridSize = number;
      await this.features.save();
    });

    this.addNumericRangeSetting(page, "默认节点宽度", settings.defaultNodeWidth ?? 280, 120, 1200, async number => {
      settings.defaultNodeWidth = number;
      await this.features.save();
    });

    this.addNumericRangeSetting(page, "默认节点高度", settings.defaultNodeHeight ?? 140, 80, 1000, async number => {
      settings.defaultNodeHeight = number;
      await this.features.save();
    });

    new Setting(page).setName("新建文本节点默认对齐")
      .setDesc("选择新建文本节点的默认文字对齐方式。已有节点中明确保存的文字对齐样式不会被覆盖。")
      .addDropdown(dropdown => dropdown
        .addOption("left", "左对齐")
        .addOption("center", "居中")
        .addOption("right", "右对齐")
        .setValue(normalizeDefaultNodeTextAlignment(this.plugin.settings.defaultNodeTextAlign))
        .onChange(async value => {
          this.plugin.settings.defaultNodeTextAlign = normalizeDefaultNodeTextAlignment(value);
          await this.features.save();
        }));

    new Setting(page).setName("Tab 创建子节点")
      .setDesc("关闭后，Tab 不会被 Better Canvas 拦截，可继续使用 Obsidian 或其他插件的快捷键。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.mindMapShortcutChildTabEnabled !== false)
        .onChange(async value => {
          this.plugin.settings.mindMapShortcutChildTabEnabled = value;
          await this.features.save();
        }));

    new Setting(page).setName("Enter 创建同级节点")
      .setDesc("关闭后，Enter 不会被 Better Canvas 用于创建同级节点。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.mindMapShortcutSiblingEnterEnabled !== false)
        .onChange(async value => {
          this.plugin.settings.mindMapShortcutSiblingEnterEnabled = value;
          await this.features.save();
        }));

    new Setting(page).setName("Alt + 方向键导航节点")
      .setDesc("关闭后，Alt + 方向键不会触发 Better Canvas 的相邻节点导航。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.mindMapShortcutAltArrowNavigationEnabled !== false)
        .onChange(async value => {
          this.plugin.settings.mindMapShortcutAltArrowNavigationEnabled = value;
          await this.features.save();
        }));

    new Setting(page).setName("Ctrl/Cmd + 方向键创建方向节点")
      .setDesc("关闭后，Ctrl/Cmd + 方向键及其 Shift 变体不会被 Better Canvas 拦截。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.mindMapShortcutDirectionalCreationEnabled !== false)
        .onChange(async value => {
          this.plugin.settings.mindMapShortcutDirectionalCreationEnabled = value;
          await this.features.save();
        }));

    new Setting(page).setName("自动创建文件节点连线")
      .setDesc("读取 Markdown frontmatter 中的关联文件。")
      .addToggle(toggle => toggle.setValue(Boolean(settings.autoFileNodeEdgesEnabled)).onChange(async value => {
        settings.autoFileNodeEdgesEnabled = value;
        await this.features.save();
      }));

    new Setting(page).setName("关联字段名")
      .addText(text => text.setPlaceholder("canvas-edges").setValue(String(settings.autoEdgesFrontmatterKey || "canvas-edges")).onChange(async value => {
        settings.autoEdgesFrontmatterKey = value.trim() || "canvas-edges";
        await this.features.save();
      }));

    new Setting(page).setName("只读时禁用右键菜单")
      .setDesc("启用后，只读模式会拦截 Canvas 视图中的右键菜单；命令面板和其他视图不受影响。")
      .addToggle(toggle => toggle
        .setValue(settings.readOnlyDisableNodeMenusEnabled !== false)
        .onChange(async value => {
          settings.readOnlyDisableNodeMenusEnabled = value;
          await this.features.save();
          this.features.refreshReadonly();
        }));

    new Setting(page).setName("只读时锁定平移和缩放")
      .setDesc("启用后，只读模式会拦截画布拖动、触控、滚轮和视口快捷键。通过命令调用的“缩放以适应”或“缩放到选区”仍可使用。")
      .addToggle(toggle => toggle
        .setValue(settings.readOnlyLockPanZoomEnabled === true)
        .onChange(async value => {
          settings.readOnlyLockPanZoomEnabled = value;
          await this.features.save();
          this.features.refreshReadonly();
        }));
    this.renderTemplateSettings(page);

  }

  private renderTemplateSettings(page: HTMLElement): void {
    new Setting(page).setName("节点模板")
      .setDesc("已保存 " + ((this.plugin.settings.templates || []).length) + " 个模板。")
      .addButton(button => button.setButtonText("清空模板").setWarning().onClick(async () => {
        if (!(this.plugin.settings.templates || []).length) {
          new Notice("没有可清空的模板。");
          return;
        }
        if (!window.confirm("删除所有已保存的节点模板？此操作无法撤销。")) return;
        this.plugin.settings.templates = [];
        await this.features.save();
        this.display();
      }));
  }

  private createAIAccordion(page: HTMLElement, id: string, title: string): { toggle: HTMLButtonElement; body: HTMLDivElement } {
    const accordion = page.createDiv({ cls: "bc-settings-accordion" });
    const bodyId = "bc-settings-accordion-" + id;
    const toggle = accordion.createEl("button", { cls: "bc-settings-accordion-toggle", attr: { type: "button", "aria-expanded": "false", "aria-controls": bodyId } });
    toggle.createEl("span", { text: title });
    toggle.createEl("span", { cls: "bc-settings-accordion-chevron", text: "⌄", attr: { "aria-hidden": "true" } });
    const body = accordion.createDiv({ cls: "bc-settings-accordion-body" });
    body.id = bodyId;
    body.hidden = true;
    return { toggle, body };
  }

  private renderAISettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;
    const textAccordion = this.createAIAccordion(page, "text", "文本生成");
    const imageAccordion = this.createAIAccordion(page, "image", "图片生成");
    const textBody = textAccordion.body;
    const imageBody = imageAccordion.body;
    const updateAccordion = (which: "text" | "image" | null): void => {
      this.openAIAccordion = which;
      textBody.hidden = which !== "text";
      imageBody.hidden = which !== "image";
      textAccordion.toggle.setAttribute("aria-expanded", String(which === "text"));
      imageAccordion.toggle.setAttribute("aria-expanded", String(which === "image"));
    };
    textAccordion.toggle.addEventListener("click", () => updateAccordion(this.openAIAccordion === "text" ? null : "text"));
    imageAccordion.toggle.addEventListener("click", () => updateAccordion(this.openAIAccordion === "image" ? null : "image"));
    updateAccordion(this.openAIAccordion);

    new Setting(textBody).setName("文本生成后端")
      .setDesc("选择默认文本生成方式；只显示所选后端的配置。")
      .addDropdown(dropdown => dropdown
        .addOption("api", "大模型 API")
        .addOption("opencode-acp", "OpenCode ACP")
        .addOption("codex-cli", "Codex CLI")
        .setValue(settings.backend === "opencode-acp" || settings.backend === "codex-cli" ? settings.backend : "api")
        .onChange(async value => {
          settings.backend = value === "opencode-acp" || value === "codex-cli" ? value : "api";
          this.openAIAccordion = "text";
          await this.features.save();
          this.display();
        }));

    const apiConfig = textBody.createDiv({ cls: "bc-settings-backend-config" });
    apiConfig.hidden = settings.backend !== "api";
    const providerIntro = apiConfig.createDiv({ cls: "bc-settings-inline-heading" });
    providerIntro.createEl("h4", { text: "文本 API 服务商" });
    providerIntro.createEl("p", { text: "密钥保存在当前 Vault 的插件设置中。" });

    if (!Array.isArray(settings.providerProfiles) || settings.providerProfiles.length === 0) {
      settings.providerProfiles = [{
        id: "default",
        name: "默认服务",
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        imageModel: "gpt-image-1"
      }];
      settings.activeProviderId = "default";
    }

    const profileList = apiConfig.createDiv({ cls: "bc-settings-provider-list" });
    const renderProfile = (profile: any): void => {
      const card = profileList.createDiv({ cls: "bc-settings-provider" });
      const cardHeader = card.createDiv({ cls: "bc-settings-provider-header" });
      const titleGroup = cardHeader.createDiv({ cls: "bc-settings-provider-title" });
      const title = titleGroup.createEl("strong", { text: String(profile.name || "未命名服务") });
      if (settings.activeProviderId === profile.id) {
        titleGroup.createEl("span", { cls: "bc-settings-provider-status", text: "当前使用" });
      }
      const actions = cardHeader.createDiv({ cls: "bc-settings-provider-actions" });

      if (settings.activeProviderId !== profile.id) {
        const activate = actions.createEl("button", { text: "设为当前", cls: "bc-settings-button" });
        activate.type = "button";
        activate.addEventListener("click", async () => {
          settings.activeProviderId = profile.id;
          this.syncLegacyProvider(profile, settings);
          await this.features.save();
          this.display();
        });
      }

      const remove = actions.createEl("button", { text: "删除", cls: "bc-settings-button bc-settings-button-muted" });
      remove.type = "button";
      remove.disabled = (settings.providerProfiles as any[]).length <= 1;
      remove.addEventListener("click", async () => {
        if ((settings.providerProfiles as any[]).length <= 1) {
          new Notice("至少保留一个 AI 服务商。");
          return;
        }
        const result = confirmAndRemoveProviderProfile(
          settings.providerProfiles as any[],
          String(profile.id),
          settings.activeProviderId,
          message => window.confirm(message)
        );
        if (!result.confirmed) return;
        settings.activeProviderId = result.activeProviderId;
        if (result.activeProfile) this.syncLegacyProvider(result.activeProfile, settings);
        await this.features.save();
        this.display();
      });

      new Setting(card).setName("名称")
        .addText(text => text.setPlaceholder("例如：OpenAI").setValue(String(profile.name || "")).onChange(async value => {
          profile.name = value;
          title.setText(value || "未命名服务");
          await this.saveProvider(profile, settings);
        }));

      let temperatureSetting: NumericRangeSetting | null = null;

      new Setting(card).setName("协议")
        .addDropdown(dropdown => dropdown
          .addOption("openai", "OpenAI 兼容")
          .addOption("anthropic", "Anthropic")
          .addOption("gemini", "Gemini")
          .setValue(profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai")
          .onChange(async value => {
            const protocol: ProviderRequestProtocol = value === "anthropic" || value === "gemini" ? value : "openai";
            profile.protocol = protocol;
            const previous = typeof profile.temperature === "number" ? profile.temperature : 0.4;
            const temperature = normalizeTemperatureForProtocol(previous, protocol);
            profile.temperature = temperature;
            await this.saveProvider(profile, settings);
            temperatureSetting?.applyRange({
              max: providerTemperatureLimit(protocol),
              description: temperatureRangeDescription(protocol),
              value: temperature
            });
            if (temperature !== previous) {
              new Notice("Temperature 已按当前协议上限从 " + previous + " 调整为 " + temperature + "。");
            }
          }));

      new Setting(card).setName("API 地址")
        .addText(text => text.setPlaceholder("https://api.example.com/v1").setValue(String(profile.baseUrl || "")).onChange(async value => {
          profile.baseUrl = value.trim();
          await this.saveProvider(profile, settings);
        }));

      new Setting(card).setName("API Key")
        .addText(text => {
          text.inputEl.type = "password";
          text.setPlaceholder("可留空").setValue(String(profile.apiKey || "")).onChange(async value => {
            profile.apiKey = value.trim();
            await this.saveProvider(profile, settings);
          });
        });

      new Setting(card).setName("文本模型")
        .addText(text => text.setPlaceholder("例如：gpt-4o-mini").setValue(String(profile.model || "")).onChange(async value => {
          profile.model = value.trim();
          await this.saveProvider(profile, settings);
        }));

      temperatureSetting = this.addNumericRangeSetting(
        card,
        "Temperature",
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
        card,
        "最大输出 token 数",
        typeof profile.maxOutputTokens === "number" ? profile.maxOutputTokens : 0,
        0,
        200000,
        async number => {
          profile.maxOutputTokens = number;
          await this.saveProvider(profile, settings);
        },
        {
          description: "0 表示使用协议适配器默认值；只限制输出，不是模型上下文长度。",
          step: "1",
          integer: true,
          allowEmpty: true
        }
      );

      const paramsStatus = card.createEl("p", { cls: "bc-settings-params-status" });
      new Setting(card).setName("高级请求参数（JSON）")
        .setDesc("额外参数按协议合并：OpenAI 兼容 / Anthropic 在请求顶层，Gemini 放入 generationConfig。核心字段与认证字段由插件保留。")
        .addTextArea(text => {
          text.inputEl.rows = 4;
          text.inputEl.style.width = "100%";
          text.setValue(String(profile.requestParamsJson || "{}"));
          const validate = (value: string): void => {
            try {
              const parsed = parseProviderParamsJson(value);
              paramsStatus.setText("JSON 有效：" + Object.keys(parsed).length + " 个额外字段。");
              text.inputEl.removeAttribute("aria-invalid");
            } catch (error) {
              paramsStatus.setText(error instanceof Error ? error.message : "JSON 无效。");
              text.inputEl.setAttribute("aria-invalid", "true");
            }
          };
          validate(text.getValue());
          text.onChange(async value => {
            profile.requestParamsJson = value;
            validate(value);
            await this.saveProvider(profile, settings);
          });
        });


      const effectiveModel = profile.id === "default"
        ? String(settings.model || profile.model || "")
        : String(profile.model || "");
      const effectiveProtocol = profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai";
      const reportKey = modelCapabilityReportKey(String(profile.id), effectiveProtocol, effectiveModel);
      const report = settings.modelCapabilityReports && typeof settings.modelCapabilityReports === "object"
        ? settings.modelCapabilityReports[reportKey] as ModelCapabilityReport | undefined
        : undefined;
      const statusLabel = (status: string): string => status === "accepted" ? "已接受" : status === "failed" ? "失败" : "未执行";
      const reportSummary = card.createEl("p", { cls: "bc-settings-capability-summary" });
      const renderReportSummary = (): void => {
        if (!report) {
          reportSummary.setText("当前模型尚未探测。图片输入结果只是请求接受情况，不保证模型真正读取图像；其他多模态能力保持未知。");
          return;
        }
        reportSummary.setText(
          "最近探测：" + new Date(report.testedAt).toLocaleString() +
          " · 文本 " + statusLabel(report.text.status) +
          " · 图片输入 " + statusLabel(report.imageInput.status) +
          ((report.text.detail || report.imageInput.detail) ? " · " + [report.text.detail, report.imageInput.detail].filter(Boolean).join("；") : "")
        );
      };
      renderReportSummary();
      new Setting(card).setName("模型能力探测")
        .setDesc("手动发送一次文本请求和（若文本成功）一次微型图片输入请求；可能产生供应商费用。不会自动探测图片生成、PDF、视频、URL context 或搜索能力。")
        .addButton(button => button
          .setButtonText("探测文本 / 图片输入")
          .onClick(async () => {
            if (!effectiveModel.trim()) {
              new Notice("请先为此服务商配置文本模型。");
              return;
            }
            if (!window.confirm("将使用“" + String(profile.name || profile.id) + " / " + effectiveModel + "”发送最多两次 API 请求。这可能产生费用。继续？")) return;
            button.setDisabled(true);
            button.setButtonText("正在探测…");
            try {
              const result = await this.features.probeProviderCapabilities(String(profile.id));
              new Notice("能力探测完成：文本 " + statusLabel(result.text.status) + "；图片输入 " + statusLabel(result.imageInput.status));
              this.display();
            } catch (error) {
              button.setDisabled(false);
              button.setButtonText("重新探测");
              new Notice(error instanceof Error ? error.message : String(error), 8000);
            }
          }));
    };

    (settings.providerProfiles as any[]).forEach(renderProfile);

    const addProvider = apiConfig.createEl("button", { text: "添加 AI 服务商", cls: "mod-cta bc-settings-add-provider" });
    addProvider.type = "button";
    addProvider.addEventListener("click", async () => {
      const profile = {
        id: "provider-" + Date.now().toString(36),
        name: "新服务商",
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        imageModel: "gpt-image-1",
        requestParamsJson: "{}",
        temperature: 0.4,
        maxOutputTokens: 0
      };
      settings.providerProfiles.push(profile);
      settings.activeProviderId = profile.id;
      this.syncLegacyProvider(profile, settings);
      await this.features.save();
      this.display();
    });

    if (settings.backend === "opencode-acp") {
      new Setting(textBody).setName("OpenCode 可执行文件")
        .setDesc("留空时使用系统 PATH 中的 opencode。")
        .addText(text => text.setPlaceholder("opencode").setValue(String(settings.opencodeBinaryPath || "opencode")).onChange(async value => {
          settings.opencodeBinaryPath = value.trim() || "opencode";
          await this.features.save();
        }));
    } else if (settings.backend === "codex-cli") {
      new Setting(textBody).setName("Codex CLI 可执行文件")
        .setDesc("留空时使用系统 PATH 中的 codex。")
        .addText(text => text.setPlaceholder("codex 或绝对路径").setValue(String(settings.codexBinaryPath || "")).onChange(async value => {
          settings.codexBinaryPath = value.trim();
          await this.features.save();
        }));
    }

    new Setting(textBody).setName("系统提示词")
      .setDesc("用于约束 AI 的默认回答方式。")
      .addTextArea(text => {
        text.inputEl.rows = 4;
        text.inputEl.style.width = "100%";
        text.setValue(String(settings.systemPrompt || "You are a precise assistant. Preserve uncertainty."));
        text.onChange(async value => {
          settings.systemPrompt = value;
          await this.features.save();
        });
      });

    const promptProfiles = normalizeNamedPromptProfiles(settings.systemPromptProfiles);
    settings.systemPromptProfiles = promptProfiles;
    const activePromptId = String(settings.activeSystemPromptProfile || "");
    let profileNameInput = promptProfiles.find(profile => profile.id === activePromptId)?.name ?? "";

    new Setting(textBody).setName("命名系统提示词")
      .setDesc("保存多套可复用的系统提示词。选择后会替换当前系统提示词；手动修改后可用相同名称覆盖保存。")
      .addDropdown(dropdown => {
        dropdown.addOption("", "选择已保存的提示词");
        for (const profile of promptProfiles) dropdown.addOption(profile.id, profile.name);
        dropdown.setValue(activePromptId);
        dropdown.onChange(async id => {
          const profile = promptProfiles.find(item => item.id === id);
          if (!profile) {
            settings.activeSystemPromptProfile = "";
            await this.features.save();
            return;
          }
          settings.activeSystemPromptProfile = profile.id;
          settings.systemPrompt = profile.prompt;
          profileNameInput = profile.name;
          await this.features.save();
          this.display();
        });
      });

    new Setting(textBody).setName("保存当前提示词")
      .setDesc("输入一个名称；已存在同名配置时会更新该配置，不会创建重复项。")
      .addText(text => text
        .setPlaceholder("例如：研究助手")
        .setValue(profileNameInput)
        .onChange(value => { profileNameInput = value; }))
      .addButton(button => button
        .setButtonText("保存")
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
            await this.features.save();
            new Notice(saved ? "已保存命名提示词：" + saved.name : "已保存命名提示词。");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 6000);
          }
        }));

    new Setting(textBody).setName("删除当前命名提示词")
      .setDesc("只删除已保存的提示词配置，不会清空当前系统提示词。")
      .addButton(button => button
        .setButtonText("删除所选配置")
        .setWarning()
        .onClick(async () => {
          const id = String(settings.activeSystemPromptProfile || "");
          const selected = normalizeNamedPromptProfiles(settings.systemPromptProfiles)
            .find(profile => profile.id === id);
          if (!selected) {
            new Notice("请先选择要删除的命名提示词。");
            return;
          }
          if (!window.confirm("删除命名提示词“" + selected.name + "”？当前系统提示词文本会保留。")) return;
          settings.systemPromptProfiles = removeNamedPromptProfile(
            normalizeNamedPromptProfiles(settings.systemPromptProfiles),
            selected.id
          );
          settings.activeSystemPromptProfile = "";
          await this.features.save();
          new Notice("已删除命名提示词：" + selected.name);
          this.display();
        }));

    new Setting(textBody).setName("复习闪卡输出模式")
      .setDesc("默认创建 Canvas 节点；也可导出为 Obsidian Spaced Repetition 可识别的 Markdown 卡组。")
      .addDropdown(dropdown => dropdown
        .addOption("canvas", "Canvas 节点")
        .addOption("spaced-repetition", "Markdown 复习卡组")
        .setValue(settings.flashcardOutputMode === "spaced-repetition" ? "spaced-repetition" : "canvas")
        .onChange(async value => {
          settings.flashcardOutputMode = value === "spaced-repetition" ? "spaced-repetition" : "canvas";
          await this.features.save();
          this.display();
        }));

    if (settings.flashcardOutputMode === "spaced-repetition") {
      new Setting(textBody).setName("复习卡组保存目录")
        .setDesc("Vault 内的相对目录。已有同名笔记会自动使用新文件名，不会被覆盖。")
        .addText(text => text.setPlaceholder("Better Canvas/Flashcards")
          .setValue(String(settings.spacedRepetitionFolder || "Better Canvas/Flashcards"))
          .onChange(async value => {
            settings.spacedRepetitionFolder = value.trim() || "Better Canvas/Flashcards";
            await this.features.save();
          }));
      new Setting(textBody).setName("复习卡组标签")
        .setDesc("输入主题路径，例如 science/biology；最终标签为 #flashcards/science/biology。")
        .addText(text => text.setPlaceholder("better-canvas")
          .setValue(String(settings.spacedRepetitionDeck || "better-canvas"))
          .onChange(async value => {
            settings.spacedRepetitionDeck = value.trim() || "better-canvas";
            await this.features.save();
          }));
    }


    new Setting(imageBody).setName("图片服务商")
      .setDesc("此处的服务商、密钥与模型独立于文本生成配置。")
      .addDropdown(dropdown => dropdown
        .addOption("openai", "OpenAI 兼容 API")
        .addOption("gemini", "Gemini")
        .setValue(settings.imageProtocol === "gemini" ? "gemini" : "openai")
        .onChange(async value => {
          const oldProtocol = settings.imageProtocol === "gemini" ? "gemini" : "openai";
          const defaults = { openai: "https://api.openai.com/v1", gemini: "https://generativelanguage.googleapis.com/v1beta" };
          if (!String(settings.imageBaseUrl || "").trim() || String(settings.imageBaseUrl) === defaults[oldProtocol]) {
            settings.imageBaseUrl = defaults[value === "gemini" ? "gemini" : "openai"];
          }
          settings.imageProtocol = value === "gemini" ? "gemini" : "openai";
          this.openAIAccordion = "image";
          await this.features.save();
          this.display();
        }));
    new Setting(imageBody).setName("API Base URL")
      .addText(text => text.setPlaceholder(settings.imageProtocol === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1")
        .setValue(String(settings.imageBaseUrl || ""))
        .onChange(async value => { settings.imageBaseUrl = value.trim(); await this.features.save(); }));
    new Setting(imageBody).setName("API Key")
      .addText(text => {
        text.inputEl.type = "password";
        text.setPlaceholder("可留空").setValue(String(settings.imageApiKey || "")).onChange(async value => {
          settings.imageApiKey = value.trim();
          await this.features.save();
        });
      });
    new Setting(imageBody).setName("图片模型")
      .addText(text => text.setPlaceholder("例如：gpt-image-1 或 gemini-2.5-flash-image")
        .setValue(String(settings.imageModel || "gpt-image-1"))
        .onChange(async value => { settings.imageModel = value.trim(); await this.features.save(); }));
    new Setting(imageBody).setName("保存位置")
      .addText(text => text.setPlaceholder("Better Canvas/Generated Images")
        .setValue(String(settings.attachmentFolder || "Better Canvas/Generated Images"))
        .onChange(async value => { settings.attachmentFolder = value.trim() || "Better Canvas/Generated Images"; await this.features.save(); }));

  }

  private renderIntegrationSettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;

    new Setting(page).setName("Canvas 元数据与反向链接")
      .setDesc("将 Canvas 中的链接同步到 Obsidian 索引。")
      .addToggle(toggle => toggle.setValue(Boolean(settings.canvasMetadataEnabled)).onChange(async value => {
        settings.canvasMetadataEnabled = value;
        await this.features.save();
        if (value) this.features.refreshMetadataCache();
      }));

    new Setting(page).setName("YouTube 字幕语言")
      .addText(text => text.setPlaceholder("zh-Hans").setValue(String(settings.youtubeLanguage || "en")).onChange(async value => {
        settings.youtubeLanguage = value.trim() || "en";
        await this.features.save();
      }));

    new Setting(page).setName("MCP 连接方式")
      .addDropdown(dropdown => dropdown
        .addOption("http", "远程 Streamable HTTP")
        .addOption("sse", "远程 SSE（旧版）")
        .addOption("stdio", "本机 stdio")
        .setValue(settings.mcpTransport === "stdio" || settings.mcpTransport === "sse" ? settings.mcpTransport : "http")
        .onChange(async value => {
          settings.mcpTransport = value === "stdio" || value === "sse" ? value : "http";
          await this.features.save();
          this.display();
        }));

    if (settings.mcpTransport === "stdio") {
      new Setting(page).setName("本机服务配置（JSON）")
        .setDesc("仅连接可信程序；服务将以当前用户权限运行。")
        .addTextArea(text => {
          text.inputEl.rows = 5;
          text.inputEl.style.width = "100%";
          text.setValue(String(settings.mcpStdioConfig || '{"command":"","args":[],"env":{},"cwd":""}'));
          text.onChange(async value => {
            settings.mcpStdioConfig = value;
            await this.features.save();
          });
        });
    } else {
      new Setting(page).setName("服务地址")
        .addText(text => text.setPlaceholder("https://server.example/mcp").setValue(String(settings.mcpEndpoint || "")).onChange(async value => {
          settings.mcpEndpoint = value.trim();
          await this.features.save();
        }));

      new Setting(page).setName("Bearer Token")
        .addText(text => {
          text.inputEl.type = "password";
          text.setValue(String(settings.mcpApiKey || "")).onChange(async value => {
            settings.mcpApiKey = value.trim();
            await this.features.save();
          });
        });
    }
  }

  private renderAppearanceSettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;
    new Setting(page).setName("自定义节点颜色")
      .setDesc("用逗号分隔 HEX 颜色，例如 #d14d41, #438c7a。")
      .addText(text => text.setPlaceholder("#d14d41, #438c7a, #5c6bc0").setValue((settings.customColors as string[]).join(", ")).onChange(async value => {
        settings.customColors = value.split(",").map((item: string) => item.trim()).filter(Boolean).slice(0, 12);
        await this.features.save();
      }));
    new Setting(page).setName("自定义节点 CSS")
      .setDesc("为节点添加自定义 class 后，可在这里设置对应样式。")
      .addTextArea(text => {
        text.inputEl.rows = 5;
        text.inputEl.style.width = "100%";
        text.setValue(String(settings.customCss || ""));
        text.onChange(async value => { settings.customCss = value; await this.features.save(); this.features.applyUserCss(); });
      });
  }

  private renderExportSettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;
    const intro = page.createDiv({ cls: "bc-settings-inline-heading" });
    intro.createEl("p", { text: "导出格式与范围通过 Canvas 导出命令选择。此处配置图像清晰度和背景。" });
    new Setting(page).setName("PNG / SVG 导出清晰度")
      .addDropdown(dropdown => {
        for (const ratio of [1, 1.5, 2, 3, 4]) dropdown.addOption(String(ratio), String(ratio) + "×");
        dropdown.setValue(String(Number(settings.exportPixelRatio) || 2)).onChange(async value => { settings.exportPixelRatio = Number(value); await this.features.save(); });
      });
    new Setting(page).setName("导出背景颜色")
      .setDesc("留空可保留透明背景。")
      .addText(text => text.setPlaceholder("透明背景").setValue(String(settings.exportBackgroundColor || "")).onChange(async value => {
        const candidate = value.trim();
        if (candidate) { const probe = document.createElement("span"); probe.style.backgroundColor = candidate; if (!probe.style.backgroundColor) return; }
        settings.exportBackgroundColor = candidate;
        await this.features.save();
      }));
  }

}