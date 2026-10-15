export interface MaterializableCanvasLink {
  title: string;
  detail: string;
  target: string;
  sourcePath: string;
  external?: boolean;
  sourceNodeId?: string;
}

/** Canonical keys are used to avoid adding duplicate file/URL nodes. */
export function materializableLinkKey(target: string, external = false): string | undefined {
  const value = target.trim();
  if (!value) return undefined;
  if (external) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
      url.hash = url.hash; // Preserve meaningful URL fragments.
      return "url:" + url.toString();
    } catch {
      return undefined;
    }
  }
  const hashIndex = value.indexOf("#");
  const path = (hashIndex >= 0 ? value.slice(0, hashIndex) : value).trim();
  const subpath = hashIndex >= 0 ? value.slice(hashIndex + 1).trim() : "";
  if (!path) return undefined;
  return "file:" + path + (subpath ? "#" + subpath : "");
}

/**
 * Return a stable, first-occurrence-wins list, omitting malformed targets and
 * entries already represented by Canvas file/link nodes.
 */
export function dedupeMaterializableCanvasLinks(
  entries: MaterializableCanvasLink[],
  existingKeys: Iterable<string> = []
): MaterializableCanvasLink[] {
  const seen = new Set<string>();
  for (const existingKey of existingKeys) {
    // Existing HTTP keys may have been stored without URL's canonical trailing slash.
    const normalizedKey = existingKey.startsWith("url:")
      ? materializableLinkKey(existingKey.slice("url:".length), true)
      : undefined;
    seen.add(normalizedKey ?? existingKey);
  }
  const output: MaterializableCanvasLink[] = [];
  for (const entry of entries) {
    const key = materializableLinkKey(entry.target, Boolean(entry.external));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push({ ...entry, target: entry.target.trim() });
  }
  return output;
}
