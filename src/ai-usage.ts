import { App, Modal, Notice } from "obsidian";

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
  window.dispatchEvent(new CustomEvent(AI_USAGE_EVENT, {
    detail: { protocol, model, ...counts, timestamp: Date.now() }
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
    ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
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
    if (!/^(openai|anthropic|gemini):.+$/i.test(key)) {
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
  return (record.inputTokens * price.inputPerMillion + record.outputTokens * price.outputPerMillion) / 1_000_000;
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatCost(value: number | null): string {
  if (value === null) return "未计费";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(value);
}

export class AIUsageModal extends Modal {
  constructor(
    app: App,
    private readonly history: AIUsageRecord[],
    private readonly priceJson: string,
    private readonly onSavePrices: (json: string) => Promise<void>,
    private readonly onClearHistory: () => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl("h2", { text: "AI 用量与成本" });
    root.createEl("p", {
      text: "仅记录成功完成的 API 文本请求及服务端返回的 token 用量，不保存提示词、响应正文、API Key 或请求 URL。OpenCode ACP 本地请求和图像生成暂不纳入统计。费用为按下方费率计算的估算值。"
    });

    let prices: AIModelPriceTable = {};
    try {
      prices = parseAIModelPriceTable(this.priceJson);
    } catch {
      // Show token counts even if a previously saved price JSON is invalid.
    }
    const priced = this.history.map(record => estimateAIUsageCost(record, prices));
    const cost = priced.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const pricedCount = priced.filter(value => value !== null).length;
    const input = this.history.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0);
    const output = this.history.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0);
    root.createEl("p", {
      text: `请求 ${this.history.length} 次 · 输入 ${formatNumber(input)} tokens · 输出 ${formatNumber(output)} tokens · 可计价 ${pricedCount} 次 · 已知费率估算合计 ${formatCost(cost)}`
    });
    root.createEl("p", { text: "未返回 token 用量或未配置费率的请求仍计入请求数，但不计入估算总价。" });

    const table = root.createEl("table");
    const head = table.createEl("thead").createEl("tr");
    ["时间", "协议 / 模型", "输入", "输出", "估算费用"].forEach(label => head.createEl("th", { text: label }));
    const body = table.createEl("tbody");
    for (let index = 0; index < Math.min(100, this.history.length); index++) {
      const record = this.history[index];
      const row = body.createEl("tr");
      row.createEl("td", { text: new Date(record.timestamp).toLocaleString() });
      row.createEl("td", { text: `${record.protocol}: ${record.model}` });
      row.createEl("td", { text: formatNumber(record.inputTokens) });
      row.createEl("td", { text: formatNumber(record.outputTokens) });
      row.createEl("td", { text: formatCost(priced[index] ?? null) });
    }
    if (this.history.length === 0) {
      body.createEl("tr").createEl("td", { text: "暂无记录。", attr: { colspan: "5" } });
    }

    root.createEl("h3", { text: "模型费率配置" });
    root.createEl("p", {
      text: '输入每百万 tokens 的美元费率，按“协议:模型”精确匹配，例如 {"openai:gpt-4o-mini":{"inputPerMillion":0.15,"outputPerMillion":0.6}}。费率由用户填写；不同网关/供应商的价格可能不同。'
    });
    const textarea = root.createEl("textarea", { attr: { rows: "8", "aria-label": "AI 模型每百万 token 价格 JSON" } });
    textarea.value = this.priceJson || "{}";
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";

    const actions = root.createDiv({ cls: "modal-button-container" });
    const save = actions.createEl("button", { text: "保存费率", cls: "mod-cta" });
    save.addEventListener("click", async () => {
      try {
        parseAIModelPriceTable(textarea.value);
        await this.onSavePrices(textarea.value);
        this.close();
        new Notice("已保存 AI 模型费率。");
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "保存费率失败。");
      }
    });
    const clear = actions.createEl("button", { text: "清空用量历史" });
    clear.addEventListener("click", async () => {
      await this.onClearHistory();
      this.close();
      new Notice("已清空 AI 用量历史。");
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
