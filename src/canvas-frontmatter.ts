/**
 * Helpers for editing JSON Canvas document frontmatter.
 *
 * JSON Canvas stores its optional frontmatter-like properties under
 * `metadata.frontmatter`. These helpers intentionally preserve all other
 * document and metadata fields so a property edit cannot discard nodes,
 * edges, or metadata written by other plugins.
 */

export type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: string, label: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} 必须是有效的 JSON。`);
  }
  if (!isJsonObject(value)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }
  return value;
}

function assertSafeTopLevelKeys(value: JsonObject): void {
  const forbidden = ["__proto__", "prototype", "constructor"];
  const key = Object.keys(value).find(candidate => forbidden.includes(candidate));
  if (key) throw new Error(`不允许使用保留属性名：${key}`);
}

export interface CanvasFrontmatterSnapshot {
  document: JsonObject;
  metadata: JsonObject;
  frontmatter: JsonObject;
}

/** Read a Canvas JSON document and normalize absent metadata/frontmatter to empty objects. */
export function readCanvasFrontmatter(rawCanvas: string): CanvasFrontmatterSnapshot {
  const document = parseJsonObject(rawCanvas, "Canvas 文件");
  const metadata = isJsonObject(document.metadata) ? document.metadata : {};
  const frontmatter = isJsonObject(metadata.frontmatter) ? metadata.frontmatter : {};
  return { document, metadata, frontmatter };
}

/**
 * Replace the full frontmatter object while retaining all other Canvas fields.
 * The current document is passed in at save time so concurrent Canvas changes
 * (for example, new nodes) are not overwritten by an older modal snapshot.
 */
export function replaceCanvasFrontmatter(
  rawCanvas: string,
  rawFrontmatter: string
): { serialized: string; metadata: JsonObject; frontmatter: JsonObject } {
  const snapshot = readCanvasFrontmatter(rawCanvas);
  const frontmatter = parseJsonObject(rawFrontmatter, "Canvas frontmatter");
  assertSafeTopLevelKeys(frontmatter);

  const metadata: JsonObject = {
    ...snapshot.metadata,
    version: snapshot.metadata.version ?? "1.0-1.0",
    frontmatter
  };
  const document: JsonObject = { ...snapshot.document, metadata };

  return {
    serialized: JSON.stringify(document, null, 2),
    metadata,
    frontmatter
  };
}
