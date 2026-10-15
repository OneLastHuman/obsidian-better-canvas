import { describe, expect, it } from "vitest";
import {
  appendAIUsageRecord,
  estimateAIUsageCost,
  extractProviderUsage,
  mergeUsageCounts,
  normalizeAIUsageRecord,
  parseAIModelPriceTable
} from "./ai-usage-core";

describe("AI usage normalization", () => {
  it("reads OpenAI-compatible usage", () => {
    expect(extractProviderUsage("openai", {
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }
    })).toEqual({ inputTokens: 120, outputTokens: 30, totalTokens: 150 });
  });

  it("reads Anthropic usage and supports split streaming events", () => {
    const input = extractProviderUsage("anthropic", {
      type: "message_start",
      message: { usage: { input_tokens: 81 } }
    });
    const output = extractProviderUsage("anthropic", {
      type: "message_delta",
      usage: { output_tokens: 19 }
    });
    expect(mergeUsageCounts(input ?? {}, output)).toEqual({ inputTokens: 81, outputTokens: 19 });
  });

  it("reads Gemini usage metadata", () => {
    expect(extractProviderUsage("gemini", {
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, totalTokenCount: 240 }
    })).toEqual({ inputTokens: 200, outputTokens: 40, totalTokens: 240 });
  });

  it("ignores absent or invalid provider usage instead of estimating token counts", () => {
    expect(extractProviderUsage("openai", { choices: [] })).toBeNull();
    expect(extractProviderUsage("openai", {
      usage: { prompt_tokens: -1, completion_tokens: "3" }
    })).toBeNull();
  });

  it("normalizes event details and computes total tokens when both sides are known", () => {
    expect(normalizeAIUsageRecord({
      protocol: "openai",
      model: " gpt-4o-mini ",
      timestamp: 123,
      inputTokens: 10,
      outputTokens: 5
    })).toMatchObject({
      protocol: "openai",
      model: "gpt-4o-mini",
      timestamp: 123,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    });
    expect(normalizeAIUsageRecord({ protocol: "invalid", model: "model" })).toBeNull();
  });

  it("keeps newest history first and applies the history limit", () => {
    const first = { protocol: "openai", model: "a", timestamp: 1, inputTokens: 1 };
    const second = { protocol: "openai", model: "b", timestamp: 2, outputTokens: 2 };
    const result = appendAIUsageRecord([first], second, 2);
    expect(result.map(item => item.model)).toEqual(["b", "a"]);
    expect(appendAIUsageRecord(result, { protocol: "gemini", model: "c", timestamp: 3 }, 2)
      .map(item => item.model)).toEqual(["c", "b"]);
  });
});

describe("AI usage pricing", () => {
  it("parses protocol/model prices in USD per million tokens", () => {
    expect(parseAIModelPriceTable('{"openai:gpt-4o-mini":{"inputPerMillion":0.15,"outputPerMillion":0.6}}'))
      .toEqual({ "openai:gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 } });
  });

  it("rejects malformed price tables and negative or missing rates", () => {
    expect(() => parseAIModelPriceTable("{")).toThrow("价格 JSON 格式无效");
    expect(() => parseAIModelPriceTable('[]')).toThrow("必须是 JSON 对象");
    expect(() => parseAIModelPriceTable('{"openai:gpt":{"inputPerMillion":-1,"outputPerMillion":1} }'))
      .toThrow("非负数");
    expect(() => parseAIModelPriceTable('{"gpt":{"inputPerMillion":1,"outputPerMillion":1} }'))
      .toThrow("protocol:model");
  });

  it("estimates cost only when both token counts and an exact model rate exist", () => {
    const rates = parseAIModelPriceTable('{"openai:gpt-4o-mini":{"inputPerMillion":0.15,"outputPerMillion":0.6}}');
    const record = {
      protocol: "openai" as const,
      model: "gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 500_000
    };
    expect(estimateAIUsageCost(record, rates)).toBeCloseTo(0.45);
    expect(estimateAIUsageCost({ ...record, outputTokens: null }, rates)).toBeNull();
    expect(estimateAIUsageCost({ ...record, model: "unknown" }, rates)).toBeNull();
  });
});
