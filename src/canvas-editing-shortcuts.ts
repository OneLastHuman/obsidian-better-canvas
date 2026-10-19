type KeydownHandler = (event: KeyboardEvent) => void;

interface EditingIframeBinding {
  doc: Document;
  handler: KeydownHandler;
  onLoad: () => void;
}

/**
 * Binds shortcut keydown listeners to Obsidian Canvas editing iframes.
 *
 * Canvas text editing runs in a same-origin iframe. Key events from that
 * document do not bubble to the canvas container in the parent document, so
 * shortcuts must be observed on the iframe document itself. The registry keeps
 * one listener per iframe document and rebinds when the iframe reloads.
 */
export class EditingIframeShortcutRegistry {
  private readonly bindings = new Map<HTMLIFrameElement, EditingIframeBinding>();

  constructor(private readonly handler: KeydownHandler) {}

  /**
   * Binds every editing iframe under `root` and drops stale bindings.
   * Bindings that belong to another canvas container are left untouched.
   */
  sync(root: ParentNode): void {
    const editingIframes = new Set<HTMLIFrameElement>();
    for (const iframe of Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe"))) {
      if (!iframe.closest(".canvas-node.is-editing")) continue;
      editingIframes.add(iframe);
      this.bind(iframe);
    }

    for (const iframe of Array.from(this.bindings.keys())) {
      if (editingIframes.has(iframe)) continue;
      if (iframe.isConnected && iframe.closest(".canvas-node.is-editing")) continue;
      this.unbind(iframe);
    }
  }

  /** Binds one editing iframe, rebinding if its document was replaced. */
  bind(iframe: HTMLIFrameElement): void {
    if (!iframe.isConnected || !iframe.closest(".canvas-node.is-editing")) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const current = this.bindings.get(iframe);
    if (current?.doc === doc) return;
    if (current) this.unbind(iframe);

    const onLoad = (): void => this.bind(iframe);
    const binding: EditingIframeBinding = { doc, handler: this.handler, onLoad };
    doc.addEventListener("keydown", binding.handler, true);
    iframe.addEventListener("load", onLoad);
    this.bindings.set(iframe, binding);
  }

  dispose(): void {
    for (const iframe of Array.from(this.bindings.keys())) this.unbind(iframe);
  }

  private unbind(iframe: HTMLIFrameElement): void {
    const binding = this.bindings.get(iframe);
    if (!binding) return;
    binding.doc.removeEventListener("keydown", binding.handler, true);
    iframe.removeEventListener("load", binding.onLoad);
    this.bindings.delete(iframe);
  }
}
