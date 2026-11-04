import { isJsonObject } from "./prompt-input";

export interface RemoteMcpImage {
  data: string;
  mimeType: string;
}

export interface RemoteMcpResult {
  text: string;
  images: RemoteMcpImage[];
}

/** Normalize MCP text/image content blocks without discarding binary payloads. */
export function normalizeMcpToolResult(value: unknown): RemoteMcpResult {
  if (isJsonObject(value) && Array.isArray(value.content)) {
    const content: unknown[] = value.content;
    const text: string[] = [];
    const other: string[] = [];
    const images: RemoteMcpImage[] = [];
    for (const part of content) {
      if (isJsonObject(part)) {
        if (typeof part.text === "string") text.push(part.text);
        if (part.type === "image" && typeof part.data === "string" &&
            part.data.length > 0 && typeof part.mimeType === "string") {
          images.push({ data: part.data, mimeType: part.mimeType });
        }
        if (part.type === "text" || part.type === "image") continue;
      }
      const serialized = JSON.stringify(part);
      if (serialized !== undefined) other.push(serialized);
    }
    return { text: [text.join("\n"), other.join("\n")].filter(Boolean).join("\n"), images };
  }
  return {
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "",
    images: []
  };
}
