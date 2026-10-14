import type { AIProtocol } from "./ai";

/** Convert common provider model-list formats into stable model IDs. */
export function normalizeModelNames(protocol: AIProtocol, payload: unknown): string[] {
  const body = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const records = Array.isArray(body.data) ? body.data
    : Array.isArray(body.models) ? body.models
    : Array.isArray(body.items) ? body.items
    : [];

  const names = records.flatMap((record: any) => {
    if (typeof record === "string") return [record];
    if (!record || typeof record !== "object") return [];
    if (protocol === "gemini" && Array.isArray(record.supportedGenerationMethods) &&
        !record.supportedGenerationMethods.includes("generateContent")) return [];
    const name = typeof record.id === "string" ? record.id
      : typeof record.name === "string" ? record.name
      : typeof record.model === "string" ? record.model
      : "";
    if (!name.trim()) return [];
    return [protocol === "gemini" ? name.replace(/^models\//, "") : name];
  });

  return [...new Set(names.map((name: string) => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

