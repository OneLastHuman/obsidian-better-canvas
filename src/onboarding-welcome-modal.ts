import { App, Modal, setIcon } from "obsidian";
import { t } from "./i18n";

export interface WelcomeModalOptions {
  hasExample: boolean;
  onCreateExample: () => void;
  onOpenExample: () => void;
  onOpenGuide: () => void;
  onSkip: () => void;
  onClosed: () => void;
}

export class OnboardingWelcomeModal extends Modal {
  private completed = false;

  constructor(app: App, private readonly options: WelcomeModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("bc-welcome-modal");
    this.titleEl.setText("");
    this.contentEl.empty();

    const hero = this.contentEl.createDiv({ cls: "bc-welcome-hero" });
    const mark = hero.createDiv({ cls: "bc-welcome-mark", attr: { "aria-hidden": "true" } });
    setIcon(mark, "layout-dashboard");
    hero.createDiv({ cls: "bc-welcome-kicker", text: "Better Canvas" });
    hero.createEl("h2", { text: t("Sketch first, set up later.", "先画一张，再慢慢设置。") });
    hero.createEl("p", {
      cls: "bc-welcome-copy",
      text: t("Canvas editing, themes, and node styles need no AI setup. Start from an editable example.",
        "画布编辑、主题和节点样式无需配置 AI。从一张可编辑的示例开始。")
    });

    const actions = this.contentEl.createDiv({ cls: "bc-welcome-actions" });
    const primary = actions.createEl("button", {
      cls: "mod-cta bc-welcome-primary",
      text: this.options.hasExample ? t("Open example Canvas", "打开示例画布") : t("Create example Canvas", "创建示例画布"),
      attr: { type: "button" }
    });
    primary.addEventListener("click", () => {
      if (this.completed) return;
      this.completed = true;
      this.close();
      if (this.options.hasExample) this.options.onOpenExample();
      else this.options.onCreateExample();
    });

    actions.createEl("button", {
      text: t("Open quick start", "打开快速入门"),
      attr: { type: "button" }
    }).addEventListener("click", () => {
      if (this.completed) return;
      this.completed = true;
      this.close();
      this.options.onOpenGuide();
    });

    actions.createEl("button", {
      cls: "bc-welcome-skip",
      text: t("Not now", "暂不设置"),
      attr: { type: "button" }
    }).addEventListener("click", () => {
      if (this.completed) return;
      this.completed = true;
      this.close();
      this.options.onSkip();
    });

    const note = this.contentEl.createDiv({ cls: "bc-welcome-note" });
    setIcon(note.createSpan({ attr: { "aria-hidden": "true" } }), "command");
    note.createSpan({ text: t("You can come back later. Reopen the guide from the command palette; it won't pop up again.",
      "稍后还能回来。从命令面板重新打开引导，不会自动反复弹出。") });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.completed) {
      this.completed = true;
      this.options.onSkip();
    }
    this.options.onClosed();
  }
}

export class OnboardingGuideModal extends Modal {
  onOpen(): void {
    this.modalEl.addClass("bc-welcome-modal");
    this.setTitle(t("Better Canvas Quick Start", "Better Canvas 快速入门"));
    const steps = [
      [t("Drop in your first idea", "放下第一个想法"),
        t("Double-click empty Canvas space to create a text card.", "在画布空白处双击，创建文本卡片。")],
      [t("Pick a Canvas theme", "选择画布主题"),
        t("Click “Canvas theme” on the right side of the Canvas to change how the whole Canvas looks.",
          "点击画布右侧的「画布主题」，切换整张画布的外观。")],
      [t("Adjust node styles", "调整节点样式"),
        t("Select a card, then click “Node style” on the right side of the Canvas. With nothing selected, you can also create cards from a preset.",
          "选中卡片，点击画布右侧的「节点样式」。空选区时也可以从预设创建卡片。")],
      [t("Connect the next idea", "连接下一个想法"),
        t("With a card selected, press Tab to create a child card or Enter to create a sibling. While editing text, use Shift + Tab or Shift + Enter.",
          "选中卡片后按 Tab 创建子卡片，按 Enter 创建同级卡片。编辑文字时用 Shift + Tab 或 Shift + Enter。")],
      [t("Ask AI when you're ready", "准备好后再问 AI"),
        t("Right-click a card and choose “Ask AI”. The panel shows what the current backend is missing; Canvas editing needs no AI setup.",
          "右键卡片并选择「问 AI」。面板会提示当前后端缺少的配置，画布编辑无需配置 AI。")]
    ];
    const list = this.contentEl.createEl("ol", { cls: "bc-onboarding-guide" });
    for (const [title, description] of steps) {
      const item = list.createEl("li");
      item.createEl("strong", { text: title });
      item.createEl("p", { text: description });
    }
    this.contentEl.createEl("button", { text: t("Get started", "开始使用"), cls: "mod-cta", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
