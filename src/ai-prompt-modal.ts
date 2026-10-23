import { App, Modal, Platform, setIcon } from "obsidian";
import type { AIStatus } from "./onboarding-ai";

interface AIPromptOptions {
  sourceLabel: string;
  modelLabel: string;
  aiStatus?: AIStatus;
  onOpenSettings?: () => void;
  onSubmit: (value: string) => unknown;
}

const STARTERS = [
  { label: "提炼要点", prompt: "请提炼这些笔记的核心要点，并保留重要细节。" },
  { label: "深入解释", prompt: "请解释这些笔记中的关键概念，并用具体例子帮助我理解。" },
  { label: "继续探索", prompt: "基于这些笔记，有哪些值得继续探索的问题？请给出下一步建议。" }
];

export class AIPromptModal extends Modal {
  private draft = "";
  private submitted = false;
  private status: AIStatus | undefined;
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: AIPromptOptions) {
    super(app);
    this.status = options.aiStatus;
  }

  /** Keep the text in this modal instance so settings can open without losing it. */
  prepareForSettings(): string {
    this.draft = this.inputEl?.value ?? this.draft;
    return this.draft;
  }

  setDraft(value: string): void {
    this.draft = value;
  }

  onOpen(): void {
    this.modalEl.addClass("bc-ai-prompt");
    this.modalEl.toggleClass("bc-ai-prompt-unconfigured", this.status?.state === "missing");
    this.setTitle("问 AI");
    this.contentEl.empty();
    this.status = this.options.aiStatus;
    this.submitted = false;

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
    this.inputEl = input;
    input.value = this.draft;
    const toolbar = composer.createDiv({ cls: "bc-ai-prompt-toolbar" });
    toolbar.createSpan({ cls: "bc-ai-prompt-model", text: this.options.modelLabel, attr: { title: this.options.modelLabel } });
    const shortcutLabel = Platform.isMacOS ? "⌘ ↵" : "Ctrl ↵";
    const submit = toolbar.createEl("button", {
      cls: "mod-cta bc-ai-prompt-send",
      attr: { type: "button", "aria-label": "发送", title: `发送 · ${shortcutLabel}；回答将添加为关联卡片` }
    });
    setIcon(submit, "arrow-up");
    submit.disabled = !input.value.trim();
    submit.addEventListener("click", () => {
      const value = input.value.trim();
      if (!value || this.submitted) return;
      if (this.status?.state === "missing") {
        this.highlightMissingStatus();
        return;
      }
      this.submitted = true;
      this.close();
      void this.options.onSubmit(value);
    });
    input.addEventListener("input", () => {
      this.draft = input.value;
      submit.disabled = !input.value.trim();
      this.statusEl?.classList.remove("is-highlighted");
    });
    input.addEventListener("keydown", event => {
      if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submit.click();
      }
    });

    this.statusEl = this.contentEl.createDiv({ cls: "bc-ai-prompt-status", attr: { role: "status", "aria-live": "polite" } });
    this.renderStatus();

    const footer = this.contentEl.createDiv({ cls: "bc-ai-prompt-footer" });
    const starters = footer.createDiv({ cls: "bc-ai-prompt-starters", attr: { "aria-label": "快捷提问" } });
    for (const starter of STARTERS) {
      const button = starters.createEl("button", { cls: "bc-ai-prompt-starter", text: starter.label, attr: { type: "button" } });
      button.addEventListener("click", () => {
        input.value = input.value.trim() ? `${input.value}\n${starter.prompt}` : starter.prompt;
        this.draft = input.value;
        submit.disabled = false;
        this.statusEl?.classList.remove("is-highlighted");
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
    footer.createSpan({ cls: "bc-ai-prompt-shortcut", text: `${shortcutLabel} 发送` });
    input.focus();
  }

  private renderStatus(): void {
    if (!this.statusEl || !this.status) return;
    this.statusEl.empty();
    this.statusEl.toggleClass("is-ready", this.status.state === "ready");
    this.statusEl.toggleClass("is-missing", this.status.state === "missing");
    this.statusEl.toggleClass("is-unknown", this.status.state === "unknown");
    const icon = this.statusEl.createSpan({ cls: "bc-ai-prompt-status-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, this.status.state === "ready" ? "check-circle" : this.status.state === "missing" ? "alert-circle" : "circle-help");
    const body = this.statusEl.createDiv({ cls: "bc-ai-prompt-status-body" });
    const headline = body.createDiv({ cls: "bc-ai-prompt-status-headline" });
    headline.createSpan({ cls: "bc-ai-prompt-status-backend", text: this.status.backendLabel });
    headline.createSpan({ cls: "bc-ai-prompt-status-summary", text: this.status.summary });
    body.createEl("p", { cls: "bc-ai-prompt-status-detail", text: this.status.detail });
    if (this.options.onOpenSettings) {
      const action = body.createEl("button", {
        cls: "bc-ai-prompt-settings-link",
        text: "去 AI 设置",
        attr: { type: "button" }
      });
      action.addEventListener("click", () => {
        this.prepareForSettings();
        this.close();
        this.options.onOpenSettings?.();
      });
    }
  }

  private highlightMissingStatus(): void {
    if (!this.statusEl) return;
    this.statusEl.classList.remove("is-highlighted");
    void this.statusEl.offsetWidth;
    this.statusEl.classList.add("is-highlighted");
    this.statusEl.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    this.inputEl?.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
