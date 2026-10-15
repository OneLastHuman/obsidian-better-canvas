/** Return the command label without a manually-added plugin prefix. Obsidian adds it in the palette. */
export function normalizeCommandDisplayName(name: string): string {
  return name.replace(/^(?:Better Canvas:\s*)+/i, "").trim();
}
