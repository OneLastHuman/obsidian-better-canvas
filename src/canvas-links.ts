export interface WikiLinkReference {
  targetPath: string;
  subpath?: string;
  alias?: string;
  original: string;
}

/**
 * Parse Obsidian wikilinks and embeds from Markdown or Canvas text. This is a
 * lexical helper only; target resolution stays with Obsidian's metadata cache.
 */
export function extractWikiLinks(text: string): WikiLinkReference[] {
  if (typeof text !== "string" || !text) return [];
  const references: WikiLinkReference[] = [];
  const pattern = /!?\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    const pipeIndex = raw.indexOf("|");
    const targetWithSubpath = (pipeIndex >= 0 ? raw.slice(0, pipeIndex) : raw).trim();
    const alias = pipeIndex >= 0 ? raw.slice(pipeIndex + 1).trim() : undefined;
    const hashIndex = targetWithSubpath.indexOf("#");
    const targetPath = (hashIndex >= 0 ? targetWithSubpath.slice(0, hashIndex) : targetWithSubpath).trim();
    const subpath = hashIndex >= 0 ? targetWithSubpath.slice(hashIndex + 1).trim() : undefined;
    if (!targetPath) continue;

    references.push({
      targetPath,
      ...(subpath ? { subpath } : {}),
      ...(alias ? { alias } : {}),
      original: match[0]
    });
  }
  return references;
}
