import { setIcon } from "obsidian";

export interface EmptyCanvasTipOptions {
  onDismiss?: () => void;
}

const TIP_CLASS = "bc-onboarding-empty-tip";
const TIP_SELECTOR = "." + TIP_CLASS;

function isTipHost(container: HTMLElement): boolean {
  return Boolean(container.querySelector?.(".canvas-wrapper, .canvas") || container.classList?.contains("canvas"));
}

function tipFor(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(TIP_SELECTOR);
}

export function showEmptyCanvasTip(container: HTMLElement, options: EmptyCanvasTipOptions = {}): boolean {
  if (!isTipHost(container) || tipFor(container)) return false;
  const canvas = container.querySelector<HTMLElement>(".canvas-wrapper, .canvas") ?? container;
  if (!canvas) return false;
  canvas.classList.add("bc-onboarding-empty-tip-host");

  const tip = canvas.createDiv({
    cls: TIP_CLASS,
    attr: { role: "note", "aria-label": "空画布提示" }
  });
  const icon = tip.createSpan({ cls: "bc-onboarding-empty-tip-icon", attr: { "aria-hidden": "true" } });
  setIcon(icon, "lightbulb");
  const body = tip.createDiv({ cls: "bc-onboarding-empty-tip-body" });
  body.createEl("strong", { text: "从这里开始" });
  body.createEl("p", { text: "在空白处双击创建卡片。右侧工具栏提供画布主题和节点样式。" });
  const shortcut = body.createDiv({ cls: "bc-onboarding-empty-tip-shortcut" });
  shortcut.createSpan({ text: "选中卡片后按" });
  shortcut.createEl("kbd", { text: "Tab" });
  shortcut.createSpan({ text: "或" });
  shortcut.createEl("kbd", { text: "Enter" });
  shortcut.createSpan({ text: "创建" });
  const close = tip.createEl("button", {
    cls: "bc-onboarding-empty-tip-close",
    attr: { type: "button", "aria-label": "关闭空画布提示", title: "关闭提示" }
  });
  setIcon(close, "x");
  close.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    dismissEmptyCanvasTip(container);
    options.onDismiss?.();
  });
  return true;
}

export function dismissEmptyCanvasTip(container: HTMLElement): boolean {
  const tip = tipFor(container);
  if (!tip) return false;
  const host = tip.parentElement;
  tip.remove();
  host?.classList.remove("bc-onboarding-empty-tip-host");
  return true;
}

export function removeEmptyCanvasTips(root: ParentNode = document): void {
  for (const tip of Array.from(root.querySelectorAll?.(TIP_SELECTOR) ?? [])) {
    tip.parentElement?.classList.remove("bc-onboarding-empty-tip-host");
    tip.remove();
  }
}

export function shouldOfferEmptyTip(
  stateEnabled: boolean,
  canvas: { nodes?: { size?: number }; getData?: () => { nodes?: unknown[] }; wrapperEl?: Element } | null,
  container: HTMLElement | null
): boolean {
  if (!stateEnabled || !canvas || !container) return false;
  if (canvas.wrapperEl?.classList?.contains?.("bc-readonly")) return false;
  const nodes = canvas.nodes;
  const count = typeof nodes?.size === "number" ? nodes.size
    : typeof canvas.getData === "function" ? (canvas.getData()?.nodes?.length ?? 0)
      : 0;
  return count === 0;
}
