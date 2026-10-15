export type ProviderRequestProtocol = "openai" | "anthropic" | "gemini";

const RESERVED_KEYS = new Set([
  "model", "messages", "system", "contents", "systeminstruction", "generationconfig",
  "temperature", "max_tokens", "max_completion_tokens", "maxoutputtokens", "stream",
  "tools", "tool_choice", "authorization", "headers", "api_key", "apikey",
  "x-api-key", "x_goog_api_key", "access_token", "secret"
]);

const MAX_JSON_LENGTH = 16_384;
const MAX_TOP_LEVEL_KEYS = 64;
const MAX_TOTAL_VALUES = 500;
const MAX_DEPTH = 8;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isCredentialField(key: string): boolean {
  const normalized = key.toLowerCase();
  return ["api_key", "apikey", "x-api-key", "x_goog_api_key", "access_token", "authorization", "secret", "password"]
    .includes(normalized) || /(^|[_-])(api[_-]?key|access[_-]?token|authorization|secret|password)([_-]|$)/i.test(key);
}

function validateValue(value: unknown, path: string, depth: number, count: { value: number }): void {
  if (depth > MAX_DEPTH) throw new Error("请求参数 JSON 嵌套层级超过 8 层。");
  if (++count.value > MAX_TOTAL_VALUES) throw new Error("请求参数 JSON 内容过多（最多 500 个值）。");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("请求参数中的数字必须是有限值：" + path);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) validateValue(value[i], path + "[" + i + "]", depth + 1, count);
    return;
  }
  if (!isPlainRecord(value)) throw new Error("请求参数只允许 JSON object、array 和基本类型：" + path);
  for (const [key, child] of Object.entries(value)) {
    if (isCredentialField(key)) throw new Error("请求参数中不能包含凭据字段：" + path + "." + key);
    const normalizedKey = key.toLowerCase();
    if (["__proto__", "prototype", "constructor"].includes(normalizedKey)) {
      throw new Error("请求参数包含禁止的对象属性：" + key);
    }
    validateValue(child, path + "." + key, depth + 1, count);
  }
}

export function validateProviderParams(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error("高级请求参数必须是 JSON object，不能是数组或 null。");
  const entries = Object.entries(value);
  if (entries.length > MAX_TOP_LEVEL_KEYS) {
    throw new Error("高级请求参数最多支持 64 个顶层字段。");
  }
  const count = { value: 0 };
  for (const [key, child] of entries) {
    if (!key.trim()) throw new Error("请求参数字段名不能为空。");
    const lower = key.toLowerCase();
    if (RESERVED_KEYS.has(lower)) {
      throw new Error("字段“" + key + "”由 Better Canvas 控制，不能放进额外请求参数。");
    }
    if (/(^|[_-])(api[_-]?key|access[_-]?token|authorization|secret|password)([_-]|$)/i.test(key)) {
      throw new Error("请求参数中不能包含凭据字段：" + key);
    }
    validateValue(child, key, 1, count);
  }
  return value;
}

export function parseProviderParamsJson(raw: string): Record<string, unknown> {
  const rawSource = String(raw ?? "");
  if (rawSource.length > MAX_JSON_LENGTH) {
    throw new Error("高级请求参数 JSON 超过 16 KB 上限。");
  }
  const source = rawSource.trim();
  if (!source) return {};
  if (source.length > MAX_JSON_LENGTH) {
    throw new Error("高级请求参数 JSON 超过 16 KB 上限。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("高级请求参数不是有效的 JSON。");
  }
  return validateProviderParams(parsed);
}

export function resolveTemperature(
  value: unknown,
  fallback = 0.4,
  protocol: ProviderRequestProtocol = "openai"
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  const maximum = protocol === "anthropic" ? 1 : 2;
  if (!Number.isFinite(number) || number < 0 || number > maximum) {
    throw new Error("Temperature 必须是 0 到 " + maximum + " 之间的数字。");
  }
  return number;
}

/**
 * Undefined means keep the current protocol adapter's default.
 * Zero is treated the same way so existing profiles can use zero for default.
 */
export function resolveMaxOutputTokens(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (number === 0) return undefined;
  if (!Number.isInteger(number) || number < 1 || number > 200_000) {
    throw new Error("最大输出 token 数必须是 1 到 200000 的整数，或填 0 使用默认值。");
  }
  return number;
}

export function mergeProviderParams(
  protocol: ProviderRequestProtocol,
  body: Record<string, unknown>,
  params: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!params || Object.keys(params).length === 0) return body;
  const safe = validateProviderParams(params);
  if (protocol === "gemini") {
    const current = isPlainRecord(body.generationConfig) ? body.generationConfig : {};
    return { ...body, generationConfig: { ...current, ...safe } };
  }
  return { ...body, ...safe };
}
