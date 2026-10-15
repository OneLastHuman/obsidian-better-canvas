export type AIUsageProtocol = "openai" | "anthropic" | "gemini";

export interface AIUsageTokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AIUsageRecord {
  id: string;
  timestamp: number;
  protocol: AIUsageProtocol;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface AIModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export type AIModelPriceTable = Record<string, AIModelPrice>;

export const AI_USAGE_EVENT = "better-canvas:ai-usage";
export const AI_USAGE_HISTORY_LIMIT = 1000;

function safeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function readFirstCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    const count = safeCount(value);
    if (count !== undefined) return count;
  }
  return undefined;
}

/** Normalize provider-reported token accounting without estimating tokens from text. */
export function extractProviderUsage(
  protocol: AIUsageProtocol,
  payload: unknown
): AIUsageTokenCounts | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, any>;
  const usage = protocol === "anthropic"
    ? body.usage ?? body.message?.usage
    : protocol === "gemini"
      ? body.usageMetadata ?? body.usage_metadata
      : body.usage;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = protocol === "anthropic"
    ? readFirstCount(usage.input_tokens, usage.inputTokens)
    : protocol === "gemini"
      ? readFirstCount(usage.promptTokenCount, usage.prompt_token_count, usage.inputTokens)
      : readFirstCount(usage.prompt_tokens, usage.input_tokens, usage.inputTokens);
  const outputTokens = protocol === "anthropic"
    ? readFirstCount(usage.output_tokens, usage.outputTokens)
    : protocol === "gemini"
      ? readFirstCount(usage.candidatesTokenCount, usage.candidates_token_count, usage.outputTokens)
      : readFirstCount(usage.completion_tokens, usage.output_tokens, usage.outputTokens);
  const totalTokens = readFirstCount(
    usage.total_tokens,
    usage.totalTokenCount,
    usage.total_token_count,
    usage.totalTokens
  );
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  };
}

export function mergeUsageCounts(
  previous: AIUsageTokenCounts,
  next: AIUsageTokenCounts | null
): AIUsageTokenCounts {
  if (!next) return previous;
  return {
    ...(previous.inputTokens !== undefined || next.inputTokens !== undefined
      ? { inputTokens: next.inputTokens ?? previous.inputTokens } : {}),
    ...(previous.outputTokens !== undefined || next.outputTokens !== undefined
      ? { outputTokens: next.outputTokens ?? previous.outputTokens } : {}),
    ...(previous.totalTokens !== undefined || next.totalTokens !== undefined
      ? { totalTokens: next.totalTokens ?? previous.totalTokens } : {})
  };
}

export function emitAIUsageEvent(
  protocol: AIUsageProtocol,
  model: string,
  counts: AIUsageTokenCounts = {}
): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const timestamp = Date.now();
  const uniqueId = `${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
  window.dispatchEvent(new CustomEvent(AI_USAGE_EVENT, {
    detail: { id: uniqueId, protocol, model, ...counts, timestamp }
  }));
}

export function normalizeAIUsageRecord(value: unknown): AIUsageRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const protocol = raw.protocol;
  if (protocol !== "openai" && protocol !== "anthropic" && protocol !== "gemini") return null;
  if (typeof raw.model !== "string" || !raw.model.trim()) return null;
  const timestamp = typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) && raw.timestamp > 0
    ? Math.floor(raw.timestamp)
    : Date.now();
  const inputTokens = safeCount(raw.inputTokens);
  const outputTokens = safeCount(raw.outputTokens);
  const totalTokens = safeCount(raw.totalTokens)
    ?? (inputTokens !== undefined && outputTokens !== undefined
      ? Math.min(Number.MAX_SAFE_INTEGER, inputTokens + outputTokens)
      : undefined);
  const id = typeof raw.id === "string" && raw.id.length <= 160
    ? raw.id
    : `${timestamp}-${protocol}-${raw.model.trim().slice(0, 60)}`;
  return {
    id,
    timestamp,
    protocol,
    model: raw.model.trim().slice(0, 200),
    inputTokens: inputTokens ?? null,
    outputTokens: outputTokens ?? null,
    totalTokens: totalTokens ?? null
  };
}

export function appendAIUsageRecord(
  history: unknown,
  value: unknown,
  limit = AI_USAGE_HISTORY_LIMIT
): AIUsageRecord[] {
  const record = normalizeAIUsageRecord(value);
  if (!record) return Array.isArray(history)
    ? history.map(normalizeAIUsageRecord).filter((item): item is AIUsageRecord => item !== null).slice(0, limit)
    : [];
  const records = Array.isArray(history)
    ? history.map(normalizeAIUsageRecord).filter((item): item is AIUsageRecord => item !== null)
    : [];
  return [record, ...records.filter(item => item.id !== record.id)].slice(0, Math.max(1, limit));
}

/** Parse rates in USD per million tokens, keyed by "protocol:model". */
export function parseAIModelPriceTable(json: string): AIModelPriceTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json || "{}");
  } catch {
    throw new Error("价格 JSON 格式无效。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("价格配置必须是 JSON 对象。");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 200) throw new Error("价格配置最多支持 200 个模型。");
  const result: AIModelPriceTable = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!/^(openai|anthropic|gemini):.+$/.test(key)) {
      throw new Error(`模型价格键“${key}”格式错误，应为 protocol:model。`);
    }
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      throw new Error(`模型“${key}”的价格必须是对象。`);
    }
    const price = rawValue as Record<string, unknown>;
    const input = price.inputPerMillion;
    const output = price.outputPerMillion;
    if (typeof input !== "number" || !Number.isFinite(input) || input < 0
        || typeof output !== "number" || !Number.isFinite(output) || output < 0) {
      throw new Error(`模型“${key}”必须设置非负数 inputPerMillion 和 outputPerMillion。`);
    }
    result[key] = { inputPerMillion: input, outputPerMillion: output };
  }
  return result;
}

export function estimateAIUsageCost(
  record: Pick<AIUsageRecord, "protocol" | "model" | "inputTokens" | "outputTokens">,
  prices: AIModelPriceTable
): number | null {
  if (record.inputTokens === null || record.outputTokens === null) return null;
  const price = prices[`${record.protocol}:${record.model}`];
  if (!price) return null;
  const cost = (record.inputTokens * price.inputPerMillion + record.outputTokens * price.outputPerMillion) / 1_000_000;
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}
