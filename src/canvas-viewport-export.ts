const OMITTED_UI_CLASSES = [
  "canvas-control-item",
  "canvas-controls",
  "canvas-control",
  "canvas-card-menu",
  "canvas-menu-container",
  "bc-card-toolbar",
  "bc-card-action"
] as const;

/** html-to-image's filter callback: only static Canvas content belongs in the SVG. */
export function shouldIncludeViewportSvgNode(node: Pick<HTMLElement, "tagName" | "classList">): boolean {
  const tag = String(node?.tagName ?? "").toLowerCase();
  if (["iframe", "script", "object", "embed"].includes(tag)) return false;
  if (OMITTED_UI_CLASSES.some(className => node.classList?.contains(className))) return false;
  return true;
}

/**
 * Create an isolated export copy so SVG serialization never embeds the active
 * HTML preview iframe/srcdoc or interactive toolbar DOM. The live canvas is
 * deliberately never mutated.
 */
export function prepareViewportSvgExportClone(container: HTMLElement): HTMLElement {
  const clone = container.cloneNode(true) as HTMLElement;
  if (container.dataset?.bcTheme === "soft-notes") {
    const geometry = container.ownerDocument.getElementById("bc-soft-geometry");
    if (geometry) clone.appendChild(geometry.cloneNode(true));
  }
  const sourceFrames = Array.from(container.querySelectorAll("iframe"));
  const cloneFrames = Array.from(clone.querySelectorAll("iframe"));

  cloneFrames.forEach((frame, index) => {
    const source = sourceFrames[index];
    // A controlled text editor is safe to snapshot as inert DOM. Arbitrary HTML
    // previews still become labels, even when they are same-origin.
    if (source?.matches?.(".embed-iframe.is-controlled") && source.closest("[data-bc-soft-notes]")) {
      try {
        const content = source.contentDocument?.querySelector(".cm-content");
        if (content) {
          const snapshot = container.ownerDocument.createElement("div");
          snapshot.className = "markdown-source-view bc-export-editor-snapshot";
          snapshot.appendChild(content.cloneNode(true));
          // CodeMirror's empty img sentinels are cursor controls, not images;
          // html-to-image otherwise tries to load their empty sources.
          snapshot.querySelectorAll(".cm-widgetBuffer, .cm-fold-indicator").forEach(element => element.remove());
          frame.replaceWith(snapshot);
          return;
        }
      } catch { /* Cross-origin previews are omitted below. */ }
    }
    const label = container.ownerDocument.createElement("div");
    label.className = "bc-export-html-preview-label";
    label.textContent = "[HTML preview omitted from export]";
    const rect = source?.getBoundingClientRect?.();
    if (rect && rect.width > 0) label.style.width = rect.width + "px";
    if (rect && rect.height > 0) label.style.height = rect.height + "px";
    label.style.boxSizing = "border-box";
    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.justifyContent = "center";
    label.style.overflow = "hidden";
    label.style.border = "1px dashed var(--background-modifier-border)";
    label.style.background = "transparent";
    label.style.fontSize = "12px";
    label.style.opacity = "0.75";
    frame.replaceWith(label);
  });

  clone.querySelectorAll(OMITTED_UI_CLASSES.map(name => "." + name).join(", "))
    .forEach(element => element.remove());

  clone.querySelectorAll("iframe, script, object, embed").forEach(element => element.remove());

  const elements = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      } else if (/^(?:href|src|xlink:href|formaction)$/i.test(attribute.name) &&
          /^\s*javascript:/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return clone;
}
