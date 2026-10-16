import { describe, expect, it, vi } from "vitest";
import { parseJsonObjectPrompt, promptValidator, resolvePromptSubmission } from "./prompt-input";

describe("prompt submission", () => {
  it("continues treating empty input as cancel unless clearing is explicitly enabled", () => {
    expect(resolvePromptSubmission("")).toEqual({ kind: "cancelled" });
    expect(resolvePromptSubmission("   ")).toEqual({ kind: "cancelled" });
    expect(resolvePromptSubmission("", { allowEmpty: true })).toEqual({ kind: "submit", value: "" });
    expect(resolvePromptSubmission("value")).toEqual({ kind: "submit", value: "value" });
  });

  it("reports invalid input instead of submitting it, so the modal can stay open", () => {
    const validate = (value: string) => (value === "{" ? "参数 JSON 无效。请检查后重试。" : null);
    expect(resolvePromptSubmission("{", { validate })).toEqual({
      kind: "invalid",
      message: "参数 JSON 无效。请检查后重试。"
    });
    expect(resolvePromptSubmission('{"a":1}', { validate })).toEqual({ kind: "submit", value: '{"a":1}' });
  });

  it("does not validate values that are already treated as cancel", () => {
    const validate = vi.fn(() => "never shown");
    expect(resolvePromptSubmission("  ", { validate })).toEqual({ kind: "cancelled" });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("JSON object prompt input", () => {
  it("parses JSON objects and keeps the parser details out of the user-facing message", () => {
    expect(parseJsonObjectPrompt('{"tool":"echo","n":1}', "参数")).toEqual({ tool: "echo", n: 1 });

    let message = "";
    try {
      parseJsonObjectPrompt("{", "参数");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("参数 JSON 无效。请检查后重试。");
    expect(message).not.toMatch(/position|column|line \d|Expected|Unexpected/i);
  });

  it("rejects arrays, null and primitives because MCP tool arguments must be an object", () => {
    for (const raw of ["[1]", "null", "3", '"text"', "true"]) {
      expect(() => parseJsonObjectPrompt(raw, "参数")).toThrowError("输入必须是 JSON 对象，例如 {}。");
    }
  });

  it("reuses the domain parser message as the modal validation message", () => {
    const validate = promptValidator(value => parseJsonObjectPrompt(value, "参数"));
    expect(validate("{")).toBe("参数 JSON 无效。请检查后重试。");
    expect(validate("[1]")).toBe("输入必须是 JSON 对象，例如 {}。");
    expect(validate('{"a":1}')).toBeNull();
  });

  it("falls back to generic wording when a parser throws a non-Error", () => {
    /* eslint-disable no-throw-literal */
    const validate = promptValidator(() => {
      throw "boom";
    });
    /* eslint-enable no-throw-literal */
    expect(validate("anything")).toBe("输入的 JSON 无效。请检查后重试。");
  });
});
