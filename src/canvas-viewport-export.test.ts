import { describe, expect, it, vi } from "vitest";
import { prepareViewportSvgExportClone, shouldIncludeViewportSvgNode } from "./canvas-viewport-export";

function node(tagName: string, classes: string[] = []): HTMLElement {
  return {
    tagName,
    classList: { contains: (name: string) => classes.includes(name) }
  } as unknown as HTMLElement;
}

describe("viewport SVG export filter", () => {
  it("carries Soft Notes clip definitions into the isolated export", () => {
    const geometryCopy = {};
    const geometry = { cloneNode: vi.fn(() => geometryCopy) };
    const clone = { attributes: [], appendChild: vi.fn(), querySelectorAll: () => [] };
    const container = {
      dataset: { bcTheme: "soft-notes" },
      ownerDocument: { getElementById: vi.fn(() => geometry) },
      cloneNode: () => clone,
      querySelectorAll: () => []
    };
    prepareViewportSvgExportClone(container as unknown as HTMLElement);
    expect(container.ownerDocument.getElementById).toHaveBeenCalledWith("bc-soft-geometry");
    expect(geometry.cloneNode).toHaveBeenCalledWith(true);
    expect(clone.appendChild).toHaveBeenCalledWith(geometryCopy);
  });

  it("excludes active and executable embedded content", () => {
    expect(shouldIncludeViewportSvgNode(node("IFRAME"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("SCRIPT"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("OBJECT"))).toBe(false);
    expect(shouldIncludeViewportSvgNode(node("EMBED"))).toBe(false);
  });

  it("snapshots a controlled Soft Notes text editor without exporting its iframe", () => {
    const contentCopy = {};
    const source = {
      matches: () => true,
      closest: () => ({}),
      contentDocument: { querySelector: () => ({ cloneNode: () => contentCopy }) }
    };
    const frame = { replaceWith: vi.fn() };
    const cursorSentinel = { remove: vi.fn() };
    const snapshot = { className: "", appendChild: vi.fn(), querySelectorAll: () => [cursorSentinel] };
    const clone = {
      attributes: [],
      querySelectorAll: (selector: string) => selector === "iframe" ? [frame] : []
    };
    const container = {
      ownerDocument: { createElement: () => snapshot },
      cloneNode: () => clone,
      querySelectorAll: () => [source]
    };
    prepareViewportSvgExportClone(container as unknown as HTMLElement);
    expect(frame.replaceWith).toHaveBeenCalledWith(snapshot);
    expect(snapshot.className).toContain("markdown-source-view");
    expect(snapshot.appendChild).toHaveBeenCalledWith(contentCopy);
    expect(cursorSentinel.remove).toHaveBeenCalledOnce();
  });

  it("excludes Canvas controls and Better Canvas card toolbars", () => {
    for (const className of [
      "canvas-control-item",
      "canvas-controls",
      "canvas-control",
      "canvas-card-menu",
      "canvas-menu-container",
      "bc-card-toolbar",
      "bc-card-action"
    ]) {
      expect(shouldIncludeViewportSvgNode(node("DIV", [className]))).toBe(false);
    }
  });


  it("replaces active iframe previews with static labels and removes export UI and executable markup", () => {
    const sourceFrame = {
      srcdoc: '<script>window.__unsafe = true</script>',
      getBoundingClientRect: () => ({ width: 320, height: 180 })
    };
    const cloneFrame: any = {
      replaceWith: vi.fn((value: any) => { cloneFrame.replacement = value; })
    };
    const toolbar = { remove: vi.fn() };
    const script = { remove: vi.fn() };
    const unsafeElement: any = {
      attributes: [
        { name: "onclick", value: "run()" },
        { name: "href", value: "javascript:run()" },
        { name: "title", value: "safe" }
      ],
      removeAttribute(name: string) {
        this.attributes = this.attributes.filter((attribute: any) => attribute.name !== name);
      }
    };
    const clone: any = {
      attributes: [],
      removeAttribute: vi.fn(),
      querySelectorAll: (selector: string) => {
        if (selector === "iframe") return [cloneFrame];
        if (selector.startsWith(".canvas-control-item")) return [toolbar];
        if (selector === "iframe, script, object, embed") return [script];
        if (selector === "*") return [unsafeElement];
        return [];
      }
    };
    const container: any = {
      ownerDocument: {
        createElement: () => ({
          style: {} as Record<string, string>,
          className: "",
          textContent: "",
          setCssStyles(styles: Record<string, string>) { Object.assign(this.style, styles); }
        })
      },
      cloneNode: vi.fn(() => clone),
      querySelectorAll: (selector: string) => selector === "iframe" ? [sourceFrame] : []
    };

    const result = prepareViewportSvgExportClone(container);

    expect(result).toBe(clone);
    expect(cloneFrame.replaceWith).toHaveBeenCalledOnce();
    expect(cloneFrame.replacement.textContent).toBe("[HTML preview omitted from export]");
    expect(cloneFrame.replacement.style.width).toBe("320px");
    expect(cloneFrame.replacement.style.height).toBe("180px");
    expect(toolbar.remove).toHaveBeenCalledOnce();
    expect(script.remove).toHaveBeenCalledOnce();
    expect(unsafeElement.attributes).toEqual([{ name: "title", value: "safe" }]);
    expect(sourceFrame.srcdoc).toContain("<script>");
    expect(container.cloneNode).toHaveBeenCalledWith(true);
  });

  it("keeps ordinary Canvas nodes and their text content eligible for export", () => {
    expect(shouldIncludeViewportSvgNode(node("DIV", ["canvas-node"]))).toBe(true);
    expect(shouldIncludeViewportSvgNode(node("SPAN", ["markdown-preview-view"]))).toBe(true);
  });
});
