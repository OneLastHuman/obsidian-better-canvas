import "obsidian";

// Obsidian installs its global DOM factories in every workspace window.
// Document.win is declared as Window, without those global function types.
declare global {
  interface Window {
    createEl: typeof createEl;
    createDiv: typeof createDiv;
    createSpan: typeof createSpan;
    createSvg: typeof createSvg;
  }
}
