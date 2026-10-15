import { describe, expect, it } from "vitest";
import {
  normalizeNamedPromptProfiles,
  removeNamedPromptProfile,
  upsertNamedPromptProfile
} from "./prompt-profiles";

describe("named system prompt profiles", () => {
  it("normalizes stored profile data and filters invalid or duplicate entries", () => {
    expect(normalizeNamedPromptProfiles([
      { id: "a", name: "Research", prompt: "Use citations" },
      { id: "a", name: "Duplicate", prompt: "Ignore" },
      { id: "", name: "No id", prompt: "Ignore" },
      null,
      { id: "b", name: "Empty prompt", prompt: "  " }
    ])).toEqual([{ id: "a", name: "Research", prompt: "Use citations" }]);
    expect(normalizeNamedPromptProfiles(null)).toEqual([]);
  });

  it("creates named prompt profiles with trimmed values", () => {
    expect(upsertNamedPromptProfile([], " Research ", " Use sources. ", "p1"))
      .toEqual([{ id: "p1", name: "Research", prompt: "Use sources." }]);
  });

  it("updates a profile with the same name instead of creating duplicates", () => {
    const profiles = [{ id: "p1", name: "Research", prompt: "Old" }];
    expect(upsertNamedPromptProfile(profiles, "research", "New prompt", "p2"))
      .toEqual([{ id: "p1", name: "research", prompt: "New prompt" }]);
  });

  it("rejects empty profile name, empty prompt, and duplicate IDs", () => {
    expect(() => upsertNamedPromptProfile([], " ", "prompt", "p1")).toThrow(/名称不能为空/);
    expect(() => upsertNamedPromptProfile([], "name", " ", "p1")).toThrow(/内容不能为空/);
    expect(() => upsertNamedPromptProfile([{ id: "p1", name: "one", prompt: "prompt" }], "two", "prompt", "p1"))
      .toThrow(/重复/);
  });

  it("removes the requested profile and preserves the others", () => {
    const profiles = [
      { id: "p1", name: "One", prompt: "one" },
      { id: "p2", name: "Two", prompt: "two" }
    ];
    expect(removeNamedPromptProfile(profiles, "p1")).toEqual([profiles[1]]);
  });
});
