export interface RemoteMcpImage {
  data: string;
  mimeType: string;
}

export interface RemoteMcpResult {
  text: string;
  images: RemoteMcpImage[];
}

/** Normalize MCP text/image content blocks without discarding binary payloads. */
export function normalizeMcpToolResult(value: any): RemoteMcpResult {
  if (Array.isArray(value?.content)) {
    const text = value.content
      .filter((part: any) => typeof part?.text === "string")
      .map((part: any) => part.text as string)
      .join("\n");
    const images: RemoteMcpImage[] = value.content
      .filter((part: any) =>
        part?.type === "image" &&
        typeof part?.data === "string" &&
        part.data.length > 0 &&
        typeof part?.mimeType === "string"
      )
      .map((part: any) => ({ data: part.data, mimeType: part.mimeType }));
    const other = value.content
      .filter((part: any) => part?.type !== "text" && part?.type !== "image")
      .map((part: any) => JSON.stringify(part))
      .join("\n");
    return { text: [text, other].filter(Boolean).join("\n"), images };
  }
  return {
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    images: []
  };
}
