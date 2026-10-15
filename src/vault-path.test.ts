import { describe, expect, it } from "vitest";
import { joinVaultPath } from "./vault-path";

describe("joinVaultPath", () => {
  it("handles Vault root paths without leading separators", () => {
    expect(joinVaultPath("/", "name.canvas")).toBe("name.canvas");
    expect(joinVaultPath("", "name.canvas")).toBe("name.canvas");
  });

  it("normalizes separators and ignores empty fragments", () => {
    expect(joinVaultPath("/notes/", "/subfolder//", "new.canvas/")).toBe("notes/subfolder/new.canvas");
    expect(joinVaultPath("", null, "Better Canvas Exports", "canvas-export.canvas")).toBe(
      "Better Canvas Exports/canvas-export.canvas"
    );
  });

  it("preserves nested vault-relative folders", () => {
    expect(joinVaultPath("notes/projects", "new.canvas")).toBe("notes/projects/new.canvas");
  });
});
