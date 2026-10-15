import { describe, expect, it } from "vitest";
import { isCanvasReadOnly, shouldSubmitPromptValue } from "./canvas-command-guards";

describe("Canvas edit guard", () => {
  it("detects the Better Canvas readonly state without requiring DOM objects", () => {
    expect(isCanvasReadOnly({ wrapperEl: { classList: { contains: (name: string) => name === "bc-readonly" } } })).toBe(true);
    expect(isCanvasReadOnly({ wrapperEl: { classList: { contains: () => false } } })).toBe(false);
    expect(isCanvasReadOnly({})).toBe(false);
    expect(isCanvasReadOnly(null)).toBe(false);
  });
});

describe("prompt submission", () => {
  it("continues treating empty input as cancel unless clearing is explicitly enabled", () => {
    expect(shouldSubmitPromptValue("value")).toBe(true);
    expect(shouldSubmitPromptValue("  ")).toBe(false);
    expect(shouldSubmitPromptValue("  ", true)).toBe(true);
    expect(shouldSubmitPromptValue("", false)).toBe(false);
  });
});
