/**
 * Minimal UI localization. English is the default; Chinese is selected when
 * Obsidian's interface language is Chinese. Call sites pass both variants so
 * the copy stays next to the markup it belongs to.
 */
export type UiLanguage = "en" | "zh";

let override: UiLanguage | null = null;

function normalize(language: string | null | undefined): UiLanguage {
  return (language ?? "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * Obsidian sets `documentElement.lang` from its interface language before
 * plugins load, so module-level labels pick the right locale even before
 * `onload` runs. Tests and the plugin entry point can pin it explicitly.
 */
export function currentLanguage(): UiLanguage {
  if (override) return override;
  if (typeof document !== "undefined") {
    return normalize(document.documentElement.lang || navigator.language);
  }
  return "en";
}

export function setLanguage(language: string | null | undefined): void {
  override = normalize(language);
}

export function isChinese(): boolean {
  return currentLanguage() === "zh";
}

export function t(english: string, chinese: string): string {
  return currentLanguage() === "zh" ? chinese : english;
}
