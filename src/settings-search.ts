export interface SettingsSearchSection {
  title: string;
  description: string;
}

export interface SettingsSearchEntry {
  text: string;
}

export interface SettingsSearchResult {
  sectionMatches: boolean;
  entryMatches: boolean[];
  totalMatches: number;
}

/** Match a settings page's own metadata and its independently searchable entries. */
export function getSettingsSearchMatches(
  query: string,
  section: SettingsSearchSection,
  entries: readonly SettingsSearchEntry[]
): SettingsSearchResult {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesText = (text: string): boolean =>
    !normalizedQuery || text.toLocaleLowerCase().includes(normalizedQuery);
  const sectionMatches = Boolean(normalizedQuery) &&
    [section.title, section.description].some(text => matchesText(text));
  const entryMatches = entries.map(entry => matchesText(entry.text));
  const totalMatches = (sectionMatches ? 1 : 0) + entryMatches.filter(Boolean).length;

  return { sectionMatches, entryMatches, totalMatches };
}
