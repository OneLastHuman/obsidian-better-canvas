import type { RemoteMcpResult } from "./mcp-result";
import type { RemoteMcpTool } from "./mcp";
import { t } from "./i18n";
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
  try { parsed = JSON.parse(raw); } catch { throw new Error(t("MCP prompt arguments are not valid JSON.", "MCP prompt 参数不是有效 JSON。")); }
  if (!isJsonObject(parsed)) {
    throw new Error(t("MCP prompt arguments must be a JSON object.", "MCP prompt 参数必须是 JSON object。"));
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== "string") {
      throw new Error(t("Each MCP prompt argument must be a named string.", "MCP prompt 的每个参数都必须是有名称的字符串。"));
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
  const confirmed = parseJsonObjectPrompt(raw, t("MCP call confirmation", "MCP 调用确认"));
  if (typeof confirmed.toolName !== "string" || !toolNames.includes(confirmed.toolName)) {
    throw new Error(t("toolName must be a tool exposed by the current MCP server.", "toolName 必须是当前 MCP 服务公开的工具名称。"));
  }
  if (!isJsonObject(confirmed.arguments)) {
    throw new Error(t("arguments must be a JSON object.", "arguments 必须是 JSON object。"));
  }
  return { toolName: confirmed.toolName, arguments: confirmed.arguments };
}

export interface McpCatalogPage<T> {
  items: T[];
  /** Count received from the server before normalization/deduplication. */
  rawEntryCount?: number;
  nextCursor?: string;
}

export function normalizeMcpTools(value: unknown): RemoteMcpTool[] {
  const tools: RemoteMcpTool[] = [];
  const entries: unknown[] = Array.isArray(value) ? value : [];
  for (const item of entries) {
    if (!isJsonObject(item) || typeof item.name !== "string") continue;
    tools.push({
      name: item.name,
      description: typeof item.description === "string" ? item.description : "",
      inputSchema: isJsonObject(item.inputSchema) ? item.inputSchema : {}
    });
  }
  return tools;
}

export function normalizeMcpResourcePage(value: unknown): McpCatalogPage<McpResource> {
  const record = isJsonObject(value) ? value : {};
  const raw: unknown[] = Array.isArray(record.resources) ? record.resources : [];
  const items: McpResource[] = [];
  for (const item of raw) {
    if (!isJsonObject(item) || typeof item.uri !== "string" || !item.uri.trim()) continue;
    items.push({
      uri: item.uri.trim(),
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.uri.trim(),
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
      ...(typeof item.mimeType === "string" && item.mimeType.trim() ? { mimeType: item.mimeType.trim() } : {})
    });
  }
  return { items, rawEntryCount: raw.length, ...(typeof record.nextCursor === "string" && record.nextCursor ? { nextCursor: record.nextCursor } : {}) };
}

export function normalizeMcpPromptPage(value: unknown): McpCatalogPage<McpPrompt> {
  const record = isJsonObject(value) ? value : {};
  const raw: unknown[] = Array.isArray(record.prompts) ? record.prompts : [];
  const items: McpPrompt[] = [];
  for (const item of raw) {
    if (!isJsonObject(item) || typeof item.name !== "string" || !item.name.trim()) continue;
    const args: McpPromptArgument[] = [];
    const rawArgs: unknown[] = Array.isArray(item.arguments) ? item.arguments : [];
    for (const arg of rawArgs) {
      if (!isJsonObject(arg) || typeof arg.name !== "string" || !arg.name.trim()) continue;
      args.push({
        name: arg.name.trim(),
        ...(typeof arg.description === "string" && arg.description.trim() ? { description: arg.description.trim() } : {}),
        ...(typeof arg.required === "boolean" ? { required: arg.required } : {})
      });
    }
    items.push({
      name: item.name.trim(),
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.trim() } : {}),
      arguments: args
    });
  }
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
  const lines = ["# MCP Resources", "", t("Resources: " + resources.length, "共 " + resources.length + " 个资源"), ""];
  for (const item of resources) {
    lines.push("- **" + item.name + "**", "  - URI: `" + item.uri + "`");
    if (item.mimeType) lines.push("  - MIME: " + item.mimeType);
    if (item.description) lines.push("  - " + item.description);
  }
  if (!resources.length) lines.push(t("This server does not expose any resources.", "此服务未公开 resources。"));
  return lines.join("\n").slice(0, 12000);
}

export function formatMcpPromptCatalog(prompts: ReadonlyArray<McpPrompt>): string {
  const lines = ["# MCP Prompts", "", t("Prompt templates: " + prompts.length, "共 " + prompts.length + " 个提示模板"), ""];
  for (const item of prompts) {
    lines.push("- **" + item.name + "**");
    if (item.description) lines.push("  - " + item.description);
    if (item.arguments.length) {
      lines.push(t("  - Arguments: ", "  - 参数: ") + item.arguments.map(arg =>
        arg.name + (arg.required ? t(" (required)", "（必填）") : "") + (arg.description ? " — " + arg.description : "")
      ).join("; "));
    }
  }
  if (!prompts.length) lines.push(t("This server does not expose any prompts.", "此服务未公开 prompts。"));
  return lines.join("\n").slice(0, 12000);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isJsonObject(value)) return value && typeof value === "object" ? JSON.stringify(value, null, 2) : "";
  const item = value;
  if (typeof item.text === "string") return item.text;
  if (item.type === "resource" && isJsonObject(item.resource)) {
    const resource = item.resource;
    if (typeof resource.text === "string") return resource.text;
    if (typeof resource.uri === "string") return "[Embedded resource: " + resource.uri + "]";
  }
  return JSON.stringify(value, null, 2);
}

function displayPromptContent(value: unknown): string {
  if (!isJsonObject(value)) return asText(value);
  const item = value;
  if (item.type === "image") {
    return "[Image attachment" + (typeof item.mimeType === "string" ? ": " + item.mimeType : "") + "]";
  }
  if (item.type === "resource" && isJsonObject(item.resource)) {
    const resource = item.resource;
    if (typeof resource.blob === "string") {
      return "[Embedded binary resource" + (typeof resource.mimeType === "string" ? ": " + resource.mimeType : "") + "]";
    }
  }
  return asText(value);
}

function extractImages(value: unknown, images: RemoteMcpResult["images"]): void {
  if (!isJsonObject(value)) return;
  const item = value;
  if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
    const mimeType = item.mimeType.toLowerCase().split(";")[0].trim();
    if (mimeType.startsWith("image/") && item.data.length <= 28_000_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(item.data)) {
      images.push({ mimeType, data: item.data });
    }
  } else if (item.type === "resource" && isJsonObject(item.resource)) {
    const resource = item.resource;
    if (typeof resource.blob === "string" && typeof resource.mimeType === "string") {
      const mimeType = resource.mimeType.toLowerCase().split(";")[0].trim();
      if (mimeType.startsWith("image/") && resource.blob.length <= 28_000_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(resource.blob)) {
        images.push({ mimeType, data: resource.blob });
      }
    }
  }
}

export function formatMcpResourceRead(uri: string, value: unknown): RemoteMcpResult {
  const record = isJsonObject(value) ? value : {};
  const contents: unknown[] = Array.isArray(record.contents) ? record.contents : [];
  const images: RemoteMcpResult["images"] = [];
  const text = contents.map((content, index) => {
    if (!isJsonObject(content)) {
      return t("[Resource content " + (index + 1) + "]", "[资源内容 " + (index + 1) + "]") + "\n" + asText(content);
    }
    if (content.type === "image" || content.type === "resource") extractImages(content, images);
    if (typeof content.text === "string") return content.text;
    if (typeof content.blob === "string") {
      const mimeType = typeof content.mimeType === "string" ? content.mimeType : "application/octet-stream";
      if (mimeType.toLowerCase().startsWith("image/")) {
        extractImages({ type: "image", mimeType, data: content.blob }, images);
        return t("[Attached resource image, MIME: " + mimeType + "]", "[已附加资源图像，MIME: " + mimeType + "]");
      }
      return t("[Resource is binary data, MIME: " + mimeType + "; content not embedded to avoid writing unknown binary into a text node]",
        "[资源为二进制数据，MIME: " + mimeType + "；为避免将未知二进制写入文本节点，未内嵌内容]");
    }
    return t("[Resource content " + (index + 1) + "]", "[资源内容 " + (index + 1) + "]") + "\n" + asText(content);
  }).filter(Boolean);
  if (!contents.length) return { text: "# MCP Resource\n\nURI: " + uri + "\n\n" + t("The server did not return any contents.", "服务器没有返回 contents。"), images };
  return { text: "# MCP Resource\n\nURI: " + uri + "\n\n" + text.join("\n\n").slice(0, 12000), images };
}

export function formatMcpPromptResult(name: string, value: unknown): RemoteMcpResult {
  const record = isJsonObject(value) ? value : {};
  const messages: unknown[] = Array.isArray(record.messages) ? record.messages : [];
  const images: RemoteMcpResult["images"] = [];
  const blocks: string[] = [];
  if (typeof record.description === "string" && record.description.trim()) {
    blocks.push(record.description.trim());
  }
  for (const message of messages) {
    const role = isJsonObject(message) && typeof message.role === "string" ? message.role : "message";
    const content: unknown = isJsonObject(message) ? message.content : undefined;
    if (Array.isArray(content)) {
      const parts: unknown[] = content;
      for (const item of parts) {
        extractImages(item, images);
        blocks.push("[" + role + "] " + displayPromptContent(item));
      }
    } else {
      extractImages(content, images);
      blocks.push("[" + role + "] " + displayPromptContent(content));
    }
  }
  return {
    text: ("# MCP Prompt: " + name + "\n\n" + (blocks.join("\n\n") || t("The server did not return any prompt messages.", "服务器没有返回提示词消息。"))).slice(0, 12000),
    images
  };
}
