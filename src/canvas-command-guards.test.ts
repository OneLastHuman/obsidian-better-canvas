import { describe, expect, it } from "vitest";
import { isCanvasReadOnly } from "./canvas-command-guards";

describe("Canvas edit guard", () => {
  it("detects the Better Canvas readonly state without requiring DOM objects", () => {
    expect(isCanvasReadOnly({ wrapperEl: { classList: { contains: (name: string) => name === "bc-readonly" } } })).toBe(true);
    expect(isCanvasReadOnly({ wrapperEl: { classList: { contains: () => false } } })).toBe(false);
    expect(isCanvasReadOnly({})).toBe(false);
    expect(isCanvasReadOnly(null)).toBe(false);
  });
});
