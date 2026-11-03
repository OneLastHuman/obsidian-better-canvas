import { afterEach, describe, expect, it } from "vitest";
import { isChinese, setLanguage, t } from "./i18n";

describe("i18n", () => {
  afterEach(() => setLanguage("zh"));

  it("defaults to English copy for non-Chinese interface languages", () => {
    setLanguage("en");
    expect(isChinese()).toBe(false);
    expect(t("Open a Canvas first.", "请先打开 Canvas。")).toBe("Open a Canvas first.");
    setLanguage("de");
    expect(t("Open a Canvas first.", "请先打开 Canvas。")).toBe("Open a Canvas first.");
  });

  it("uses Chinese copy for every Chinese locale variant", () => {
    for (const language of ["zh", "zh-CN", "zh-TW", "zh-Hant"]) {
      setLanguage(language);
      expect(isChinese()).toBe(true);
      expect(t("Open a Canvas first.", "请先打开 Canvas。")).toBe("请先打开 Canvas。");
    }
  });
});
