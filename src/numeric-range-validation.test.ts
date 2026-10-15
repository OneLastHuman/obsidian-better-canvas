import { describe, expect, it, vi } from "vitest";
import { validateNumericRangeInput } from "./numeric-range-validation";

function createTargets() {
  const attributes = new Map<string, string>();
  const input = {
    setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    removeAttribute: vi.fn((name: string) => attributes.delete(name))
  };
  const feedback = { textContent: "", hidden: true };
  return { attributes, input, feedback };
}

describe("validateNumericRangeInput", () => {
  it("marks an out-of-range value as invalid and states that it was not saved", () => {
    const { attributes, input, feedback } = createTargets();

    const value = validateNumericRangeInput("1001", 0, 1000, input, feedback);

    expect(value).toBeNull();
    expect(attributes.get("aria-invalid")).toBe("true");
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toContain("0–1000");
    expect(feedback.textContent).toContain("当前值尚未保存");
  });

  it("accepts inclusive range boundaries and clears the error after correction", () => {
    const { attributes, input, feedback } = createTargets();

    expect(validateNumericRangeInput("1001", 0, 1000, input, feedback)).toBeNull();
    expect(validateNumericRangeInput("1000", 0, 1000, input, feedback)).toBe(1000);
    expect(attributes.has("aria-invalid")).toBe(false);
    expect(feedback.hidden).toBe(true);
    expect(feedback.textContent).toBe("");
    expect(validateNumericRangeInput("0", 0, 1000, input, feedback)).toBe(0);
  });

  it("rejects blank, non-finite and fractional integer-only values without saving", () => {
    const { input, feedback } = createTargets();

    expect(validateNumericRangeInput("", 0, 1000, input, feedback)).toBeNull();
    expect(feedback.hidden).toBe(false);
    expect(validateNumericRangeInput("Infinity", 0, 1000, input, feedback)).toBeNull();
    expect(validateNumericRangeInput("1.5", 0, 200000, input, feedback, { integer: true })).toBeNull();
    expect(feedback.textContent).toContain("整数");
  });

  it("treats an allowed empty value as a no-op and clears a previous error", () => {
    const { attributes, input, feedback } = createTargets();

    expect(validateNumericRangeInput("3", 0, 2, input, feedback)).toBeNull();
    expect(validateNumericRangeInput("", 0, 2, input, feedback, { allowEmpty: true })).toBeNull();
    expect(attributes.has("aria-invalid")).toBe(false);
    expect(feedback.hidden).toBe(true);
    expect(feedback.textContent).toBe("");
  });
});
