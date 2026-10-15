import { describe, expect, it } from "vitest";
import {
  mergeProviderParams,
  parseProviderParamsJson,
  resolveMaxOutputTokens,
  resolveTemperature,
  validateProviderParams
} from "./provider-params";

describe("validated provider-specific request parameters", () => {
  it("parses nested JSON objects and accepts provider-specific extension fields", () => {
    expect(parseProviderParamsJson('{"top_p":0.85,"response_format":{"type":"json_object"},"stop":["END"]}'))
      .toEqual({
        top_p: 0.85,
        response_format: { type: "json_object" },
        stop: ["END"]
      });
    expect(parseProviderParamsJson("")).toEqual({});
    expect(parseProviderParamsJson("  ")).toEqual({});
  });

  it("rejects invalid JSON, arrays, null, excessive size and excessive keys", () => {
    expect(() => parseProviderParamsJson("{")).toThrow(/有效的 JSON/);
    expect(() => parseProviderParamsJson("[]")).toThrow(/JSON object/);
    expect(() => parseProviderParamsJson("null")).toThrow(/JSON object/);
    expect(() => parseProviderParamsJson(" ".repeat(16_385))).toThrow(/16 KB/);
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => ["param_" + i, i]));
    expect(() => validateProviderParams(many)).toThrow(/64 个/);
  });

  it("rejects reserved request-shape and credential fields", () => {
    for (const raw of [
      '{"model":"other-model"}',
      '{"messages":[]}',
      '{"generationConfig":{}}',
      '{"temperature":1}',
      '{"max_tokens":100}',
      '{"authorization":"Bearer secret"}',
      '{"api_key":"secret"}',
      '{"metadata":{"authorization":"Bearer secret"}}',
      '{"constructor":{"prototype":{}}}'
    ]) {
      expect(() => parseProviderParamsJson(raw)).toThrow();
    }
  });

  it("rejects deep and excessively large structured values", () => {
    expect(() => parseProviderParamsJson('{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":{"i":1}}}}}}}}}'))
      .toThrow(/嵌套层级/);
    const nested = { entries: Array.from({ length: 510 }, (_, i) => i) };
    expect(() => validateProviderParams(nested)).toThrow(/500 个值/);
  });

  it("merges OpenAI-compatible and Anthropic extras at the body root", () => {
    const original = { model: "selected", messages: [{ role: "user", content: "hi" }], temperature: 0.2 };
    expect(mergeProviderParams("openai", original, { top_p: 0.8 })).toEqual({ ...original, top_p: 0.8 });
    expect(mergeProviderParams("anthropic", { model: "selected", max_tokens: 1024 }, { top_k: 20 }))
      .toEqual({ model: "selected", max_tokens: 1024, top_k: 20 });
  });

  it("merges Gemini extras into generationConfig without replacing model content", () => {
    expect(mergeProviderParams("gemini", {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    }, { topP: 0.8, topK: 32 })).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, topP: 0.8, topK: 32 }
    });
  });

  it("validates sampling temperature and output token limits", () => {
    expect(resolveTemperature(undefined)).toBe(0.4);
    expect(resolveTemperature("1.25")).toBe(1.25);
    expect(() => resolveTemperature(2.1)).toThrow(/0 到 2/);
    expect(() => resolveTemperature(1.1, 0.4, "anthropic")).toThrow(/0 到 1/);
    expect(resolveTemperature(1, 0.4, "anthropic")).toBe(1);
    expect(() => resolveTemperature(Number.NaN)).toThrow(/0 到 2/);
    expect(resolveMaxOutputTokens(undefined)).toBeUndefined();
    expect(resolveMaxOutputTokens("0")).toBeUndefined();
    expect(resolveMaxOutputTokens("2048")).toBe(2048);
    expect(() => resolveMaxOutputTokens(1.5)).toThrow(/整数/);
    expect(() => resolveMaxOutputTokens(200001)).toThrow(/200000/);
  });
});
