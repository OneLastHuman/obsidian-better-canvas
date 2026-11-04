import type { AIProtocol } from "./ai";

/** Convert common provider model-list formats into stable model IDs. */
export function normalizeModelNames(protocol: AIProtocol, payload: unknown): string[] {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const records: unknown[] = Array.isArray(body.data) ? body.data
    : Array.isArray(body.models) ? body.models
    : Array.isArray(body.items) ? body.items
    : [];

  const names = records.flatMap((record) => {
    if (typeof record === "string") return [record];
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    if (protocol === "gemini" && Array.isArray(item.supportedGenerationMethods) &&
        !item.supportedGenerationMethods.includes("generateContent")) return [];
    const name = typeof item.id === "string" ? item.id
      : typeof item.name === "string" ? item.name
      : typeof item.model === "string" ? item.model
      : "";
    if (!name.trim()) return [];
    return [protocol === "gemini" ? name.replace(/^models\//, "") : name];
  });

  return [...new Set(names.map((name: string) => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

