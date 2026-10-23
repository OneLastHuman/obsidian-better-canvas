import { describe, expect, it, vi } from "vitest";

// This stub tests modal actions, not Obsidian rendering or browser layout.
const { ElementStub } = vi.hoisted(() => {
  class ElementStub {
    children: ElementStub[] = [];
    classes = new Set<string>();
    events = new Map<string, (event: any) => void>();
    text = "";
    value = "";
    disabled = false;
    offsetWidth = 1;
    focus = vi.fn();
    scrollIntoView = vi.fn();
    classList = {
      add: (name: string) => this.classes.add(name),
      remove: (name: string) => this.classes.delete(name)
    };

    constructor(public tag = "div", public options: any = {}) {
      this.text = options.text ?? "";
      for (const cls of String(options.cls ?? "").split(" ").filter(Boolean)) this.classes.add(cls);
    }
    addClass(name: string) { this.classes.add(name); }
    toggleClass(name: string, enabled: boolean) {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    }
    createEl(tag: string, options = {}) {
      const child = new ElementStub(tag, options);
      this.children.push(child);
      return child;
    }
    createDiv(options = {}) { return this.createEl("div", options); }
    createSpan(options = {}) { return this.createEl("span", options); }
    setText(text: string) { this.text = text; }
    prepend() {}
    setSelectionRange() {}
    empty() { this.children = []; }
    addEventListener(name: string, callback: (event: any) => void) { this.events.set(name, callback); }
    click() { if (!this.disabled) this.events.get("click")?.({}); }
    descendants(): ElementStub[] {
      return this.children.flatMap(child => [child, ...child.descendants()]);
    }
  }
  return { ElementStub };
});

vi.mock("obsidian", () => ({
  App: class {},
  Platform: { isMacOS: false },
  setIcon: vi.fn(),
  Modal: class {
    modalEl = new ElementStub();
    titleEl = new ElementStub();
    contentEl = new ElementStub();
    onClose() {}
    setTitle(text: string) { this.titleEl.setText(text); }
    close() { this.onClose(); }
  }
}));

import { AIPromptModal } from "./ai-prompt-modal";
import { OnboardingGuideModal, OnboardingWelcomeModal } from "./onboarding-welcome-modal";
import { resolveAIStatus } from "./onboarding-ai";

function elements(modal: { contentEl: HTMLElement }) {
  return (modal.contentEl as unknown as InstanceType<typeof ElementStub>).descendants();
}

function welcome(hasExample = false) {
  const options = {
    hasExample,
    onCreateExample: vi.fn(), onOpenExample: vi.fn(), onOpenGuide: vi.fn(), onSkip: vi.fn(), onClosed: vi.fn()
  };
  const modal = new OnboardingWelcomeModal({} as any, options);
  modal.onOpen();
  return { modal, options };
}

describe("welcome actions", () => {
  it("treats dismissal by the host close control or Escape as skipping", () => {
    const { modal, options } = welcome();
    modal.close();
    modal.close();
    expect(options.onSkip).toHaveBeenCalledOnce();
    expect(options.onCreateExample).not.toHaveBeenCalled();
  });

  it("creates the example once without also marking it skipped", () => {
    const { modal, options } = welcome();
    const create = elements(modal).find(element => element.text === "创建示例画布")!;
    create.click();
    create.click();
    expect(options.onCreateExample).toHaveBeenCalledOnce();
    expect(options.onSkip).not.toHaveBeenCalled();
    expect(options.onClosed).toHaveBeenCalledOnce();
  });

  it("opens a previously recorded example instead of creating another", () => {
    const { modal, options } = welcome(true);
    elements(modal).find(element => element.text === "打开示例画布")!.click();
    expect(options.onOpenExample).toHaveBeenCalledOnce();
    expect(options.onCreateExample).not.toHaveBeenCalled();
  });

  it("offers a built-in guide without opening or writing a Vault path", () => {
    const { modal, options } = welcome();
    elements(modal).find(element => element.text === "打开快速入门")!.click();
    expect(options.onOpenGuide).toHaveBeenCalledOnce();
    expect(options.onSkip).not.toHaveBeenCalled();
    const guide = new OnboardingGuideModal({} as any);
    guide.onOpen();
    expect(elements(guide).filter(element => element.tag === "li")).toHaveLength(5);
    expect(elements(guide).some(element => element.text.includes("无需配置 AI"))).toBe(true);
  });
});

function prompt(missing: boolean, draft = "My original question") {
  const options = {
    sourceLabel: "My source",
    modelLabel: "test-model",
    aiStatus: resolveAIStatus({
      baseUrl: missing ? "https://api.openai.com/v1" : "http://localhost:11434/v1",
      model: "test-model", apiKey: ""
    }),
    onOpenSettings: vi.fn(),
    onSubmit: vi.fn()
  };
  const modal = new AIPromptModal({} as any, options);
  modal.setDraft(draft);
  modal.onOpen();
  const input = elements(modal).find(element => element.tag === "textarea")!;
  const send = elements(modal).find(element => element.options.attr?.["aria-label"] === "发送")!;
  const status = elements(modal).find(element => element.classes.has("bc-ai-prompt-status"))!;
  return { modal, options, input, send, status };
}

describe("AI onboarding actions", () => {
  it("keeps send clickable and uses the same missing-configuration rule for keyboard and mouse", () => {
    const { input, send, status, options } = prompt(true);
    expect(send.disabled).toBe(false);
    send.click();
    expect(status.classes.has("is-highlighted")).toBe(true);
    status.classes.delete("is-highlighted");
    input.events.get("keydown")!({ ctrlKey: true, key: "Enter", preventDefault: vi.fn() });
    expect(status.classes.has("is-highlighted")).toBe(true);
    expect(input.value).toBe("My original question");
    expect(options.onSubmit).not.toHaveBeenCalled();
  });

  it("preserves the edited question while opening settings", () => {
    const { modal, input, options } = prompt(true);
    input.value = "Edited question";
    input.events.get("input")!({});
    elements(modal).find(element => element.text === "去 AI 设置")!.click();
    expect(options.onOpenSettings).toHaveBeenCalledOnce();
    expect(modal.prepareForSettings()).toBe("Edited question");
    expect(options.onSubmit).not.toHaveBeenCalled();
  });

  it("allows a configured local API request once and ignores IME composition", () => {
    const { input, send, options } = prompt(false);
    input.events.get("keydown")!({ ctrlKey: true, key: "Enter", isComposing: true, preventDefault: vi.fn() });
    expect(options.onSubmit).not.toHaveBeenCalled();
    send.click();
    send.click();
    expect(options.onSubmit).toHaveBeenCalledExactlyOnceWith("My original question");
  });

  it("keeps whitespace-only questions disabled even with valid configuration", () => {
    const { send, options } = prompt(false, "   ");
    expect(send.disabled).toBe(true);
    send.click();
    expect(options.onSubmit).not.toHaveBeenCalled();
  });
});
