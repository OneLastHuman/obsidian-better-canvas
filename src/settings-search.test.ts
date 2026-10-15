import { describe, expect, it } from "vitest";
import { getSettingsSearchMatches } from "./settings-search";

describe("getSettingsSearchMatches", () => {
  const section = { title: "AI 服务", description: "模型、提示词与生成" };
  const entries = [
    { text: "Temperature" },
    { text: "添加 AI 服务商" },
    { text: "AI 服务商" }
  ];

  it("matches independent action buttons, even when no setting row matches", () => {
    const result = getSettingsSearchMatches("添加 AI 服务商", section, entries);

    expect(result.sectionMatches).toBe(false);
    expect(result.entryMatches).toEqual([false, true, false]);
    expect(result.totalMatches).toBe(1);
  });

  it("matches section titles and exposes a page result without a matching setting row", () => {
    const result = getSettingsSearchMatches("AI 服务", section, [entries[0]]);

    expect(result.sectionMatches).toBe(true);
    expect(result.entryMatches).toEqual([false]);
    expect(result.totalMatches).toBe(1);
  });

  it("matches section descriptions and ordinary settings", () => {
    const descriptionResult = getSettingsSearchMatches("提示词", section, []);
    const settingResult = getSettingsSearchMatches("temperature", section, entries);

    expect(descriptionResult.sectionMatches).toBe(true);
    expect(descriptionResult.totalMatches).toBe(1);
    expect(settingResult.entryMatches).toEqual([true, false, false]);
    expect(settingResult.totalMatches).toBe(1);
  });

  it("trims queries and leaves every entry visible when the query is empty", () => {
    const result = getSettingsSearchMatches("  ", section, entries);

    expect(result.sectionMatches).toBe(false);
    expect(result.entryMatches).toEqual([true, true, true]);
  });
});
