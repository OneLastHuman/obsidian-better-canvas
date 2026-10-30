import type { CanvasNodeData } from "./canvas";
import { resolveCanvasNodeShape, type CanvasNodeStyleSource } from "./canvas-node-style";
import type { CanvasThemeId } from "./canvas-theme";
import { AUTO_RESIZE_LAYOUT, type AutoResizeLayout } from "./node-auto-resize";
import { roundedMapInsets } from "./rounded-map-style";
import { softNotesPreset } from "./soft-notes-style";

export interface RenderedNodeLayout extends AutoResizeLayout {
  contentHeight: number;
}

/** Insets can depend on the final size (for example, a diamond's safe area). */
export function fitContentDimension(
  content: number, min: number, max: number, overhead: (size: number) => number
): number {
  let low = min;
  let high = max;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (middle - overhead(middle) >= content) high = middle;
    else low = middle + 1;
  }
  return low;
}

type Insets = { top: number; right: number; bottom: number; left: number };

export function textShapeInsets(theme: CanvasThemeId, node: CanvasNodeData, width: number, height: number): Insets | null {
  const shape = resolveCanvasNodeShape(node as CanvasNodeStyleSource);
  if (theme === "soft-notes") {
    const [top, right, bottom, left] = softNotesPreset(node.bcSoftNotesPreset).inset;
    return { top: top * height, right: right * width, bottom: bottom * height, left: left * width };
  }
  if (node.bcAutoResize === true && ["pill", "circle", "ellipse"].includes(shape)) {
    return { top: height * .16, right: width * .16, bottom: height * .16, left: width * .16 };
  }
  if (theme === "rounded-map") {
    const inset = roundedMapInsets(shape, width, height);
    return { top: inset.y, right: inset.right, bottom: inset.bottom, left: inset.x };
  }
  if (node.bcAutoResize !== true) return null;
  if (["diamond", "decision", "right-arrow", "parallelogram", "input-output", "document"].includes(shape)) {
    const inset = roundedMapInsets(shape, width, height);
    return { top: inset.y, right: inset.right, bottom: inset.bottom, left: inset.x };
  }
  if (shape === "hexagon") return { top: 8, right: width * .26, bottom: 8, left: width * .26 };
  if (shape === "database") return { top: height * .14, right: 16, bottom: height * .14, left: 16 };
  return null;
}

const padding = (inset: Insets): string => `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px`;

export function decorateAutoResizeInsets(element: HTMLElement, node: CanvasNodeData, theme: CanvasThemeId): void {
  const enabled = node.type === "text" && node.bcAutoResize === true;
  if (enabled) element.dataset.bcAutoResize = "true";
  else delete element.dataset.bcAutoResize;
  const inset = enabled ? textShapeInsets(theme, node, node.width, node.height) : null;
  if (inset) {
    element.dataset.bcAutoShape = "true";
    const value = padding(inset);
    if (element.style.getPropertyValue("--bc-auto-content-padding") !== value) {
      element.style.setProperty("--bc-auto-content-padding", value);
    }
  } else if (element.dataset.bcAutoShape) {
    delete element.dataset.bcAutoShape;
    element.style.removeProperty("--bc-auto-content-padding");
  }
}

const px = (value: string): number => Number.parseFloat(value) || 0;

function renderedLineCount(sizer: HTMLElement): number {
  const doc = sizer.ownerDocument;
  const walker = doc.createTreeWalker(sizer, 4 /* SHOW_TEXT */);
  const range = doc.createRange();
  const lines: Array<{ top: number; bottom: number }> = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      const line = lines.find(item => rect.top < item.bottom - .5 && rect.bottom > item.top + .5);
      if (line) {
        line.top = Math.max(line.top, rect.top);
        line.bottom = Math.min(line.bottom, rect.bottom);
      } else {
        lines.push({ top: rect.top, bottom: rect.bottom });
      }
    }
  }
  return Math.max(1, lines.length);
}

/**
 * Measure the host's rendered Markdown with its current theme and fonts.
 * Temporary geometry is restored synchronously, before any frame can paint.
 * No cloned embeds are attached and no node data is changed during measurement.
 */
export function measureRenderedNodeLayout(
  element: HTMLElement, node: CanvasNodeData, theme: CanvasThemeId
): RenderedNodeLayout | null {
  const preview = element.querySelector<HTMLElement>(".markdown-preview-view");
  const sizer = preview?.querySelector<HTMLElement>(".markdown-preview-sizer");
  const content = preview?.closest<HTMLElement>(".canvas-node-content");
  const view = element.ownerDocument?.defaultView;
  if (!preview || !sizer || !content || !view || !element.isConnected ||
      !preview.offsetWidth || !sizer.textContent?.trim()) return null;

  const savedElement = element.style.cssText;
  const savedSizer = sizer.style.cssText;
  const scrollTop = preview.scrollTop;
  const scrollLeft = preview.scrollLeft;
  try {
    let horizontal = 0;
    let vertical = 0;
    for (let current: HTMLElement | null = preview; current; current = current.parentElement) {
      const style = view.getComputedStyle(current);
      horizontal += px(style.paddingLeft) + px(style.paddingRight) +
        px(style.borderLeftWidth) + px(style.borderRightWidth);
      vertical += px(style.paddingTop) + px(style.paddingBottom) +
        px(style.borderTopWidth) + px(style.borderBottomWidth);
      if (current === element) break;
    }
    const previewStyle = view.getComputedStyle(preview);
    for (const pseudo of ["::before", "::after"]) {
      const style = view.getComputedStyle(preview, pseudo);
      if (style.content !== "none" && style.content !== "normal") vertical += px(style.minHeight);
    }
    horizontal += preview.offsetWidth - preview.clientWidth -
      px(previewStyle.borderLeftWidth) - px(previewStyle.borderRightWidth);
    const dynamicInsets = textShapeInsets(theme, node, node.width, node.height);
    if (dynamicInsets) {
      const style = view.getComputedStyle(content);
      horizontal -= px(style.paddingLeft) + px(style.paddingRight);
      vertical -= px(style.paddingTop) + px(style.paddingBottom);
    }
    // Preserve the original two-pixel rounding allowance in both dimensions.
    horizontal += 2;
    vertical += 2;

    sizer.setCssStyles({ minHeight: "0", height: "auto", flex: "0 0 auto", width: "max-content", maxWidth: "none" });
    const scale = element.getBoundingClientRect().width / element.offsetWidth;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const naturalWidth = Math.ceil(sizer.getBoundingClientRect().width / scale - .01);
    const width = fitContentDimension(naturalWidth, AUTO_RESIZE_LAYOUT.minWidth, AUTO_RESIZE_LAYOUT.maxWidth, value => {
      const inset = textShapeInsets(theme, node, value, node.height);
      return horizontal + (inset ? inset.left + inset.right : 0);
    });

    element.style.width = `${width}px`;
    const inset = textShapeInsets(theme, node, width, node.height);
    if (inset && node.bcAutoResize === true) {
      element.style.setProperty("--bc-auto-content-padding", padding(inset));
    } else if (inset && theme === "soft-notes") {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        element.style.setProperty(`--bc-soft-${side}`, `${inset[side]}px`);
      }
    } else if (inset && theme === "rounded-map") {
      element.style.setProperty("--bc-rounded-padding", `${inset.top}px ${inset.right}px ${inset.bottom}px ${inset.left}px`);
    }
    sizer.setCssStyles({ width: "auto" });
    const contentHeight = Math.max(sizer.offsetHeight, sizer.scrollHeight);
    const height = fitContentDimension(contentHeight, AUTO_RESIZE_LAYOUT.minHeight, AUTO_RESIZE_LAYOUT.maxHeight, value => {
      const finalInset = textShapeInsets(theme, node, width, value);
      return vertical + (finalInset ? finalInset.top + finalInset.bottom : 0);
    });
    const lines = renderedLineCount(sizer);
    return { width, height, lines, alignment: lines === 1 ? "center" : "left", contentHeight };
  } finally {
    element.style.cssText = savedElement;
    sizer.style.cssText = savedSizer;
    preview.scrollTop = scrollTop;
    preview.scrollLeft = scrollLeft;
  }
}
