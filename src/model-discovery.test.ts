import { describe, expect, it } from "vitest";
import { normalizeModelNames } from "./model-list";

describe("provider model-list normalization", () => {
  it("normalizes OpenAI-compatible model IDs and removes duplicates", () => {
    expect(normalizeModelNames("openai", {
      data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }, { id: "gpt-4o-mini" }]
    })).toEqual(["gpt-4o", "gpt-4o-mini"]);
  });

  it("normalizes Anthropic model IDs", () => {
    expect(normalizeModelNames("anthropic", { data: [{ id: "claude-3-7-sonnet" }] }))
      .toEqual(["claude-3-7-sonnet"]);
  });

  it("normalizes Gemini names and filters non-generative models", () => {
    expect(normalizeModelNames("gemini", { models: [
      { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }
    ] })).toEqual(["gemini-2.0-flash", "gemini-2.5-pro"]);
  });

  it("handles empty or unexpected payloads safely", () => {
    expect(normalizeModelNames("openai", null)).toEqual([]);
    expect(normalizeModelNames("openai", { data: [{ object: "model" }, null] })).toEqual([]);
  });
});
