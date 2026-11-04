/** Shared command guards kept independent of Obsidian's runtime APIs. */
export function isCanvasReadOnly(
  canvas: { wrapperEl?: { classList?: Pick<DOMTokenList, "contains"> } } | null | undefined
): boolean {
  return Boolean(canvas?.wrapperEl?.classList?.contains?.("bc-readonly"));
}
