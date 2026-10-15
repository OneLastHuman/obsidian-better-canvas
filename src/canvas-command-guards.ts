/** Shared command/input guards kept independent of Obsidian's runtime APIs. */
export function isCanvasReadOnly(canvas: any): boolean {
  return Boolean(canvas?.wrapperEl?.classList?.contains?.("bc-readonly"));
}

/** Empty values are usually cancelled prompts; only explicit clearable fields opt in. */
export function shouldSubmitPromptValue(value: string, allowEmpty = false): boolean {
  return allowEmpty || value.trim().length > 0;
}
