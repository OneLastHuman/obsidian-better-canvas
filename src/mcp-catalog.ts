import type { RemoteMcpResult } from "./mcp-result";
import { isJsonObject, parseJsonObjectPrompt } from "./prompt-input";

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments: McpPromptArgument[];
}

export function parseMcpPromptArguments(raw: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("MCP prompt 参数不是有效 JSON。"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP prompt 参数必须是 JSON object。");
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key.trim() || typeof value !== "string") {
      throw new Error("MCP prompt 的每个参数都必须是有名称的字符串。");
    }
    output[key] = value;
  }
  return output;
}

export interface McpToolConfirmation {
  toolName: string;
  arguments: Record<string, unknown>;
}

/** Parse the confirmed tool-call JSON before anything is sent to the MCP server. */
export function parseMcpToolConfirmation(raw: string, toolNames: string[]): McpToolConfirmation {
  const confirmed = parseJsonObjectPrompt(raw, "MCP 调用确认");
  if (typeof confirmed.toolName !== "string" || !toolNames.includes(confirmed.toolName)) {
    throw new Error("toolName 必须是当前 MCP 服务公开的工具名称。");
  }
  if (!isJsonObject(confirmed.arguments)) {
    throw new Error("arguments 必须是 JSON object。");
  }
  return { toolName: confirmed.toolName, arguments: confirmed.arguments };
}

export interface McpCatalogPage<T> {
  items: T[];
  /** Count received from the server before normalization/deduplication. */
  rawEntryCount?: number;
  nextCursor?: string;
}

export function normalizeMcpResourcePage(value: unknown): McpCatalogPage<McpResource> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = Array.isArray(record.resources) ? record.resources : [];
  const items = raw.filter((item: any) => typeof item?.uri === "string" && item.uri.trim())
    .map((item: any) => ({
      uri: item.uri.trim(),
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.uri.trim(),
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
      ...(typeof item.mimeType === "string" && item.mimeType.trim() ? { mimeType: item.mimeType.trim() } : {})
    }));
  return { items, rawEntryCount: raw.length, ...(typeof record.nextCursor === "string" && record.nextCursor ? { nextCursor: record.nextCursor } : {}) };
}

export function normalizeMcpPromptPage(value: unknown): McpCatalogPage<McpPrompt> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = Array.isArray(record.prompts) ? record.prompts : [];
  const items = raw.filter((item: any) => typeof item?.name === "string" && item.name.trim())
    .map((item: any) => ({
      name: item.name.trim(),
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
      arguments: Array.isArray(item.arguments) ? item.arguments.filter((arg: any) =>
        typeof arg?.name === "string" && arg.name.trim()
      ).map((arg: any) => ({
        name: arg.name.trim(),
        ...(typeof arg.description === "string" && arg.description.trim() ? { description: arg.description.trim() } : {}),
        ...(typeof arg.required === "boolean" ? { required: arg.required } : {})
      })) : []
    }));
  return { items, rawEntryCount: raw.length, ...(typeof record.nextCursor === "string" && record.nextCursor ? { nextCursor: record.nextCursor } : {}) };
}

const MCP_CATALOG_MAX_PAGES = 50;
const MCP_CATALOG_MAX_ENTRIES = 1000;

/** Fetch paged catalogs with hard raw-entry and pagination bounds. */
export async function collectMcpCatalogPages<T>(
  fetchPage: (cursor?: string) => Promise<McpCatalogPage<T>>,
  keyOf: (item: T) => string,
  maxPages = MCP_CATALOG_MAX_PAGES
): Promise<T[]> {
  // Keep the optional lower test limit, but callers cannot raise the hard cap.
  const pageLimit = Number.isInteger(maxPages) && maxPages > 0
    ? Math.min(maxPages, MCP_CATALOG_MAX_PAGES)
    : MCP_CATALOG_MAX_PAGES;
  const output: T[] = [];
  const seenKeys = new Set<string>();
  const seenCursors = new Set<string>();
  let receivedEntryCount = 0;
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("MCP catalog returned a repeated pagination cursor.");
      seenCursors.add(cursor);
    }
    const page = await fetchPage(cursor);
    if (!page || !Array.isArray(page.items)) {
      throw new Error("MCP catalog returned an invalid page.");
    }

    const reportedCount = page.rawEntryCount;
    const pageEntryCount = typeof reportedCount === "number" &&
      Number.isSafeInteger(reportedCount) && reportedCount >= page.items.length
      ? reportedCount
      : page.items.length;
    receivedEntryCount += pageEntryCount;
    if (receivedEntryCount > MCP_CATALOG_MAX_ENTRIES) {
      throw new Error("MCP catalog exceeded the 1000-entry safety limit.");
    }

    for (const item of page.items) {
      const key = keyOf(item);
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);
      output.push(item);
      if (output.length > MCP_CATALOG_MAX_ENTRIES) {
        throw new Error("MCP catalog exceeded the 1000-entry safety limit.");
      }
    }
    if (!page.nextCursor) return output;
    cursor = page.nextCursor;
  }
  throw new Error("MCP catalog pagination exceeded the " + pageLimit + "-page safety limit.");
}

export function formatMcpResourceCatalog(resources: ReadonlyArray<McpResource>): string {
  const lines = ["# MCP Resources", "", "共 " + resources.length + " 个资源", ""];
  for (const item of resources) {
    lines.push("- **" + item.name + "**", "  - URI: \`" + item.uri + "\`");
    if (item.mimeType) lines.push("  - MIME: " + item.mimeType);
    if (item.description) lines.push("  - " + item.description);
  }
  if (!resources.length) lines.push("此服务未公开 resources。");
  return lines.join("\n").slice(0, 12000);
}

export function formatMcpPromptCatalog(prompts: ReadonlyArray<McpPrompt>): string {
  const lines = ["# MCP Prompts", "", "共 " + prompts.length + " 个提示模板", ""];
  for (const item of prompts) {
    lines.push("- **" + item.name + "**");
    if (item.description) lines.push("  - " + item.description);
    if (item.arguments.length) {
      lines.push("  - 参数: " + item.arguments.map(arg =>
        arg.name + (arg.required ? "（必填）" : "") + (arg.description ? " — " + arg.description : "")
      ).join("; "));
    }
  }
  if (!prompts.length) lines.push("此服务未公开 prompts。");
  return lines.join("\n").slice(0, 12000);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if (typeof item.text === "string") return item.text;
  if (item.type === "resource" && item.resource && typeof item.resource === "object") {
    const resource = item.resource as Record<string, unknown>;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return "[Embedded resource: " + resource.uri + "]";
  }
  return JSON.stringify(value, null, 2);
}

function displayPromptContent(value: unknown): string {
  if (!value || typeof value !== "object") return asText(value);
  const item = value as Record<string, unknown>;
  if (item.type === "image") {
    return "[Image attachment" + (typeof item.mimeType === "string" ? ": " + item.mimeType : "") + "]";
  }
  if (item.type === "resource" && item.resource && typeof item.resource === "object") {
    const resource = item.resource as Record<string, unknown>;
    if (typeof resource.blob === "string") {
      return "[Embedded binary resource" + (typeof resource.mimeType === "string" ? ": " + resource.mimeType : "") + "]";
    }
  }
  return asText(value);
}

function extractImages(value: unknown, images: RemoteMcpResult["images"]): void {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
    const mimeType = item.mimeType.toLowerCase().split(";")[0].trim();
    if (mimeType.startsWith("image/") && item.data.length <= 28_000_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(item.data)) {
      images.push({ mimeType, data: item.data });
    }
  } else if (item.type === "resource" && item.resource && typeof item.resource === "object") {
    const resource = item.resource as Record<string, unknown>;
    if (typeof resource.blob === "string" && typeof resource.mimeType === "string") {
      const mimeType = resource.mimeType.toLowerCase().split(";")[0].trim();
      if (mimeType.startsWith("image/") && resource.blob.length <= 28_000_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(resource.blob)) {
        images.push({ mimeType, data: resource.blob });
      }
    }
  }
}

export function formatMcpResourceRead(uri: string, value: unknown): RemoteMcpResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const contents = Array.isArray(record.contents) ? record.contents : [];
  const images: RemoteMcpResult["images"] = [];
  const text = contents.map((content: any, index: number) => {
    if (content?.type === "image" || content?.type === "resource") extractImages(content, images);
    if (typeof content?.text === "string") return content.text;
    if (typeof content?.blob === "string") {
      const mimeType = typeof content.mimeType === "string" ? content.mimeType : "application/octet-stream";
      if (mimeType.toLowerCase().startsWith("image/")) {
        extractImages({ type: "image", mimeType, data: content.blob }, images);
        return "[已附加资源图像，MIME: " + mimeType + "]";
      }
      return "[资源为二进制数据，MIME: " + mimeType + "；为避免将未知二进制写入文本节点，未内嵌内容]";
    }
    if (typeof content?.text === "string") return content.text;
    return "[资源内容 " + (index + 1) + "]\n" + asText(content);
  }).filter(Boolean);
  if (!contents.length) return { text: "# MCP Resource\n\nURI: " + uri + "\n\n服务器没有返回 contents。", images };
  return { text: "# MCP Resource\n\nURI: " + uri + "\n\n" + text.join("\n\n").slice(0, 12000), images };
}

export function formatMcpPromptResult(name: string, value: unknown): RemoteMcpResult {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const images: RemoteMcpResult["images"] = [];
  const blocks: string[] = [];
  if (typeof record.description === "string" && record.description.trim()) {
    blocks.push(record.description.trim());
  }
  for (const message of messages) {
    const role = typeof message?.role === "string" ? message.role : "message";
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        extractImages(item, images);
        blocks.push("[" + role + "] " + displayPromptContent(item));
      }
    } else {
      extractImages(content, images);
      blocks.push("[" + role + "] " + displayPromptContent(content));
    }
  }
  return {
    text: ("# MCP Prompt: " + name + "\n\n" + (blocks.join("\n\n") || "服务器没有返回提示词消息。")).slice(0, 12000),
    images
  };
}
