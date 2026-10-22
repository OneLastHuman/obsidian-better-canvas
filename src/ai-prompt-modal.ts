import { App, Modal, Platform, setIcon } from "obsidian";

interface AIPromptOptions {
  sourceLabel: string;
  modelLabel: string;
  onSubmit: (value: string) => unknown;
}

const STARTERS = [
  { label: "提炼要点", prompt: "请提炼这些笔记的核心要点，并保留重要细节。" },
  { label: "深入解释", prompt: "请解释这些笔记中的关键概念，并用具体例子帮助我理解。" },
  { label: "继续探索", prompt: "基于这些笔记，有哪些值得继续探索的问题？请给出下一步建议。" }
];

export class AIPromptModal extends Modal {
  constructor(app: App, private readonly options: AIPromptOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("bc-ai-prompt");
    this.setTitle("问 AI");
    this.contentEl.empty();

    const mark = this.titleEl.createSpan({ cls: "bc-ai-prompt-mark", attr: { "aria-hidden": "true" } });
    setIcon(mark, "sparkles");
    this.titleEl.prepend(mark);

    const contextLabel = `${this.options.sourceLabel} · 含相邻节点`;
    const context = this.contentEl.createDiv({
      cls: "bc-ai-prompt-context",
      attr: { title: `以「${this.options.sourceLabel}」和直接相连的节点作为上下文` }
    });
    setIcon(context.createSpan({ cls: "bc-ai-prompt-context-icon", attr: { "aria-hidden": "true" } }), "file-text");
    context.createSpan({ cls: "bc-ai-prompt-source-name", text: contextLabel });

    const composer = this.contentEl.createDiv({ cls: "bc-ai-prompt-composer" });
    const input = composer.createEl("textarea", {
      cls: "bc-ai-prompt-input",
      attr: { rows: "5", placeholder: "有什么想问的？", "aria-label": "你的问题" }
    });
    const toolbar = composer.createDiv({ cls: "bc-ai-prompt-toolbar" });
    toolbar.createSpan({ cls: "bc-ai-prompt-model", text: this.options.modelLabel, attr: { title: this.options.modelLabel } });
    const shortcutLabel = Platform.isMacOS ? "⌘ ↵" : "Ctrl ↵";
    const submit = toolbar.createEl("button", {
      cls: "mod-cta bc-ai-prompt-send",
      attr: { type: "button", "aria-label": "发送", title: `发送 · ${shortcutLabel}；回答将添加为关联卡片` }
    });
    setIcon(submit, "arrow-up");
    submit.disabled = true;
    let submitted = false;
    submit.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value || submitted) return;
      submitted = true;
      this.close();
      void this.options.onSubmit(value);
    });
    input.addEventListener("input", () => { submit.disabled = !input.value.trim(); });
    input.addEventListener("keydown", event => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submit.click();
      }
    });

    const footer = this.contentEl.createDiv({ cls: "bc-ai-prompt-footer" });
    const starters = footer.createDiv({ cls: "bc-ai-prompt-starters", attr: { "aria-label": "快捷提问" } });
    for (const starter of STARTERS) {
      const button = starters.createEl("button", { cls: "bc-ai-prompt-starter", text: starter.label, attr: { type: "button" } });
      button.addEventListener("click", () => {
        input.value = input.value.trim() ? `${input.value}\n${starter.prompt}` : starter.prompt;
        submit.disabled = false;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
    footer.createSpan({ cls: "bc-ai-prompt-shortcut", text: `${shortcutLabel} 发送` });
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
