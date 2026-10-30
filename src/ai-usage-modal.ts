import { App, Modal, Notice } from "obsidian";
import { estimateAIUsageCost, parseAIModelPriceTable, type AIModelPriceTable, type AIUsageRecord } from "./ai-usage-core";

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
      text: `请求 ${this.history.length} 次 · 输入 ${formatNumber(input)} tokens · 输出 ${formatNumber(output)} tokens · 可计价 ${pricedCount} 次 · 已知费率估算合计 ${pricedCount > 0 ? formatCost(cost) : "暂无可估算费用"}`
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
    const textarea = root.createEl("textarea", { cls: "bc-modal-prompt-textarea", attr: { rows: "8", "aria-label": "AI 模型每百万 token 价格 JSON" } });
    textarea.value = this.priceJson || "{}";

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
