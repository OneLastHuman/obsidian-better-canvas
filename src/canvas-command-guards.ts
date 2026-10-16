/** Shared command guards kept independent of Obsidian's runtime APIs. */
export function isCanvasReadOnly(canvas: any): boolean {
  return Boolean(canvas?.wrapperEl?.classList?.contains?.("bc-readonly"));
}
