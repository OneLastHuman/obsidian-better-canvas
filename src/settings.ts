import { App, Notice, PluginSettingTab, Setting } from "obsidian";

type SettingSection = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

export default class BetterCanvasSettingsTab extends PluginSettingTab {
  private plugin: any;
  private activeSection = "canvas";
  private searchTerm = "";

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

    const searchWrap = sidebar.createDiv({ cls: "bc-settings-search" });
    const search = searchWrap.createEl("input", {
      attr: { type: "search", placeholder: "查找设置…", "aria-label": "查找设置" }
    });
    search.value = this.searchTerm;

    const sections: SettingSection[] = [
      { id: "canvas", icon: "▦", title: "画布", description: "布局、节点尺寸与关系" },
      { id: "ai", icon: "✳", title: "AI 服务", description: "模型、提示词与生成" },
      { id: "integrations", icon: "↔", title: "连接与索引", description: "MCP、字幕与链接" },
      { id: "appearance", icon: "◐", title: "外观与导出", description: "颜色、样式与文件" },
      { id: "advanced", icon: "⚙", title: "高级", description: "命令行与模板管理" }
    ];

    const nav = sidebar.createDiv({ cls: "bc-settings-nav", attr: { "aria-label": "设置分类" } });
    const pagesHost = shell.createDiv({ cls: "bc-settings-main" });
    const pages = new Map<string, HTMLElement>();
    const navButtons = new Map<string, HTMLButtonElement>();
    const emptyState = pagesHost.createDiv({ cls: "bc-settings-empty", text: "没有找到匹配的设置。" });
    emptyState.hide();

    for (const section of sections) {
      const button = nav.createEl("button", {
        cls: "bc-settings-nav-button",
        attr: { type: "button", "aria-pressed": "false" }
      });
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
      const query = this.searchTerm.trim().toLocaleLowerCase();
      let totalMatches = 0;

      for (const section of sections) {
        const page = pages.get(section.id)!;
        const button = navButtons.get(section.id)!;
        const rows = Array.from(page.querySelectorAll<HTMLElement>(".setting-item, .bc-settings-provider"));
        let pageMatches = 0;

        for (const row of rows) {
          const match = !query || (row.textContent ?? "").toLocaleLowerCase().includes(query);
          row.toggleClass("bc-settings-search-hidden", !match);
          if (match) pageMatches++;
        }

        const visible = query ? pageMatches > 0 : section.id === this.activeSection;
        page.style.display = visible ? "" : "none";
        button.toggleClass("is-active", !query && section.id === this.activeSection);
        button.toggleClass("has-match", Boolean(query) && pageMatches > 0);
        button.setAttribute("aria-pressed", String(!query && section.id === this.activeSection));
        totalMatches += pageMatches;
      }

      if (query && totalMatches === 0) emptyState.show();
      else emptyState.hide();
    };

    for (const section of sections) {
      navButtons.get(section.id)!.addEventListener("click", () => {
        this.activeSection = section.id;
        this.searchTerm = "";
        search.value = "";
        updateView();
      });
    }

    this.renderCanvasSettings(pages.get("canvas")!);
    this.renderAISettings(pages.get("ai")!);
    this.renderIntegrationSettings(pages.get("integrations")!);
    this.renderAppearanceSettings(pages.get("appearance")!);
    this.renderAdvancedSettings(pages.get("advanced")!);

    search.addEventListener("input", () => {
      this.searchTerm = search.value;
      updateView();
    });

    updateView();
  }

  private syncLegacyProvider(profile: any, settings: any): void {
    if (settings.activeProviderId !== profile.id) return;
    settings.baseUrl = String(profile.baseUrl ?? "");
    settings.apiKey = String(profile.apiKey ?? "");
    settings.model = String(profile.model ?? "");
    settings.imageModel = String(profile.imageModel ?? "");
  }

  private async saveProvider(profile: any, settings: any): Promise<void> {
    this.syncLegacyProvider(profile, settings);
    await this.features.save();
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

    new Setting(page).setName("水平间距")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "1000";
        text.setValue(String(this.plugin.settings.gapX ?? 100)).onChange(async value => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 0 && number <= 1000) {
            this.plugin.settings.gapX = number;
            await this.features.save();
          }
        });
      });

    new Setting(page).setName("垂直间距")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.max = "1000";
        text.setValue(String(this.plugin.settings.gapY ?? 44)).onChange(async value => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 0 && number <= 1000) {
            this.plugin.settings.gapY = number;
            await this.features.save();
          }
        });
      });

    new Setting(page).setName("网格大小")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "500";
        text.setValue(String(settings.gridSize ?? 20)).onChange(async value => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 1 && number <= 500) {
            settings.gridSize = number;
            await this.features.save();
          }
        });
      });

    new Setting(page).setName("默认节点宽度")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "120";
        text.inputEl.max = "1200";
        text.setValue(String(settings.defaultNodeWidth ?? 280)).onChange(async value => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 120 && number <= 1200) {
            settings.defaultNodeWidth = number;
            await this.features.save();
          }
        });
      });

    new Setting(page).setName("默认节点高度")
      .addText(text => {
        text.inputEl.type = "number";
        text.inputEl.min = "80";
        text.inputEl.max = "1000";
        text.setValue(String(settings.defaultNodeHeight ?? 140)).onChange(async value => {
          const number = Number(value);
          if (Number.isFinite(number) && number >= 80 && number <= 1000) {
            settings.defaultNodeHeight = number;
            await this.features.save();
          }
        });
      });

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
  }

  private renderAISettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;

    const providerIntro = page.createDiv({ cls: "bc-settings-inline-heading" });
    providerIntro.createEl("h4", { text: "AI 服务商" });
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

    const profileList = page.createDiv({ cls: "bc-settings-provider-list" });
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
        const index = (settings.providerProfiles as any[]).findIndex(item => item.id === profile.id);
        if (index >= 0) settings.providerProfiles.splice(index, 1);
        if (settings.activeProviderId === profile.id) {
          settings.activeProviderId = settings.providerProfiles[0].id;
          this.syncLegacyProvider(settings.providerProfiles[0], settings);
        }
        await this.features.save();
        this.display();
      });

      new Setting(card).setName("名称")
        .addText(text => text.setPlaceholder("例如：OpenAI").setValue(String(profile.name || "")).onChange(async value => {
          profile.name = value;
          title.setText(value || "未命名服务");
          await this.saveProvider(profile, settings);
        }));

      new Setting(card).setName("协议")
        .addDropdown(dropdown => dropdown
          .addOption("openai", "OpenAI 兼容")
          .addOption("anthropic", "Anthropic")
          .addOption("gemini", "Gemini")
          .setValue(profile.protocol === "anthropic" || profile.protocol === "gemini" ? profile.protocol : "openai")
          .onChange(async value => {
            profile.protocol = value;
            await this.saveProvider(profile, settings);
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

      new Setting(card).setName("图片模型")
        .addText(text => text.setPlaceholder("不使用图片生成可留空").setValue(String(profile.imageModel || "")).onChange(async value => {
          profile.imageModel = value.trim();
          await this.saveProvider(profile, settings);
        }));
    };

    (settings.providerProfiles as any[]).forEach(renderProfile);

    const addProvider = page.createEl("button", { text: "添加 AI 服务商", cls: "mod-cta bc-settings-add-provider" });
    addProvider.type = "button";
    addProvider.addEventListener("click", async () => {
      const profile = {
        id: "provider-" + Date.now().toString(36),
        name: "新服务商",
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-4o-mini",
        imageModel: "gpt-image-1"
      };
      settings.providerProfiles.push(profile);
      settings.activeProviderId = profile.id;
      this.syncLegacyProvider(profile, settings);
      await this.features.save();
      this.display();
    });

    new Setting(page).setName("文本 AI 后端")
      .addDropdown(dropdown => dropdown
        .addOption("api", "使用上方服务商")
        .addOption("opencode-acp", "本机 OpenCode")
        .setValue(settings.backend === "opencode-acp" ? "opencode-acp" : "api")
        .onChange(async value => {
          settings.backend = value === "opencode-acp" ? "opencode-acp" : "api";
          await this.features.save();
          this.display();
        }));

    if (settings.backend === "opencode-acp") {
      new Setting(page).setName("OpenCode 可执行文件")
        .addText(text => text.setPlaceholder("opencode").setValue(String(settings.opencodeBinaryPath || "opencode")).onChange(async value => {
          settings.opencodeBinaryPath = value.trim() || "opencode";
          await this.features.save();
        }));
    }

    new Setting(page).setName("系统提示词")
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

    new Setting(page).setName("复习闪卡输出模式")
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
      new Setting(page).setName("复习卡组保存目录")
        .setDesc("Vault 内的相对目录。已有同名笔记会自动使用新文件名，不会被覆盖。")
        .addText(text => text.setPlaceholder("Better Canvas/Flashcards")
          .setValue(String(settings.spacedRepetitionFolder || "Better Canvas/Flashcards"))
          .onChange(async value => {
            settings.spacedRepetitionFolder = value.trim() || "Better Canvas/Flashcards";
            await this.features.save();
          }));
      new Setting(page).setName("复习卡组标签")
        .setDesc("输入主题路径，例如 science/biology；最终标签为 #flashcards/science/biology。")
        .addText(text => text.setPlaceholder("better-canvas")
          .setValue(String(settings.spacedRepetitionDeck || "better-canvas"))
          .onChange(async value => {
            settings.spacedRepetitionDeck = value.trim() || "better-canvas";
            await this.features.save();
          }));
    }

    new Setting(page).setName("生成图片保存位置")
      .addText(text => text.setPlaceholder("Better Canvas/Generated Images").setValue(String(settings.attachmentFolder || "Better Canvas/Generated Images")).onChange(async value => {
        settings.attachmentFolder = value.trim() || "Better Canvas/Generated Images";
        await this.features.save();
      }));
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
        text.onChange(async value => {
          settings.customCss = value;
          await this.features.save();
          this.features.applyUserCss();
        });
      });

    new Setting(page).setName("PNG / SVG 导出清晰度")
      .addDropdown(dropdown => {
        for (const ratio of [1, 1.5, 2, 3, 4]) dropdown.addOption(String(ratio), String(ratio) + "×");
        dropdown.setValue(String(Number(settings.exportPixelRatio) || 2)).onChange(async value => {
          settings.exportPixelRatio = Number(value);
          await this.features.save();
        });
      });

    new Setting(page).setName("导出背景颜色")
      .setDesc("留空可保留透明背景。")
      .addText(text => text.setPlaceholder("透明背景").setValue(String(settings.exportBackgroundColor || "")).onChange(async value => {
        const candidate = value.trim();
        if (candidate) {
          const probe = document.createElement("span");
          probe.style.backgroundColor = candidate;
          if (!probe.style.backgroundColor) return;
        }
        settings.exportBackgroundColor = candidate;
        await this.features.save();
      }));
  }

  private renderAdvancedSettings(page: HTMLElement): void {
    const settings = this.features.settings() as any;

    new Setting(page).setName("Codex CLI 可执行文件")
      .setDesc("留空时使用系统 PATH 中的 codex。")
      .addText(text => text.setPlaceholder("codex 或绝对路径").setValue(String(settings.codexBinaryPath || "")).onChange(async value => {
        settings.codexBinaryPath = value.trim();
        await this.features.save();
      }));

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
}