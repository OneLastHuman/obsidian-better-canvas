import { describe, expect, it, vi } from "vitest";
import { confirmAndRemoveProviderProfile } from "./provider-profile-actions";

describe("confirmAndRemoveProviderProfile", () => {
  it("does not delete or switch providers when the user cancels", () => {
    const profiles = [
      { id: "openai", name: "OpenAI Compatible" },
      { id: "anthropic", name: "Anthropic Custom" }
    ];
    const confirmDelete = vi.fn(() => false);

    const result = confirmAndRemoveProviderProfile(profiles, "anthropic", "anthropic", confirmDelete);

    expect(confirmDelete).toHaveBeenCalledWith(
      "确定删除当前使用的 AI 服务商“Anthropic Custom”吗？删除后将切换到“OpenAI Compatible”。此操作无法撤销。"
    );
    expect(result.confirmed).toBe(false);
    expect(result.activeProviderId).toBe("anthropic");
    expect(profiles.map(profile => profile.id)).toEqual(["openai", "anthropic"]);
  });

  it("removes a non-active provider only after confirmation without changing the active provider", () => {
    const profiles = [
      { id: "openai", name: "OpenAI Compatible" },
      { id: "anthropic", name: "Anthropic Custom" },
      { id: "gemini", name: "Gemini Custom" }
    ];
    const confirmDelete = vi.fn(() => true);

    const result = confirmAndRemoveProviderProfile(profiles, "anthropic", "openai", confirmDelete);

    expect(confirmDelete).toHaveBeenCalledWith("确定删除 AI 服务商“Anthropic Custom”吗？此操作无法撤销。");
    expect(result.confirmed).toBe(true);
    expect(result.activeProviderId).toBe("openai");
    expect(result.activeProfile).toBeUndefined();
    expect(profiles.map(profile => profile.id)).toEqual(["openai", "gemini"]);
  });

  it("switches to the first remaining provider after confirming deletion of the active provider", () => {
    const profiles = [
      { id: "openai", name: "OpenAI Compatible" },
      { id: "anthropic", name: "Anthropic Custom" },
      { id: "gemini", name: "Gemini Custom" }
    ];
    const confirmDelete = vi.fn((_message: string) => true);

    const result = confirmAndRemoveProviderProfile(profiles, "anthropic", "anthropic", confirmDelete);

    expect(result.confirmed).toBe(true);
    expect(result.activeProviderId).toBe("openai");
    expect(result.activeProfile).toEqual({ id: "openai", name: "OpenAI Compatible" });
    expect(profiles.map(profile => profile.id)).toEqual(["openai", "gemini"]);
    expect(confirmDelete.mock.calls[0][0]).toContain("删除后将切换到“OpenAI Compatible”");
  });

  it("does not prompt or remove the only remaining provider", () => {
    const profiles = [{ id: "openai", name: "OpenAI Compatible" }];
    const confirmDelete = vi.fn(() => true);

    const result = confirmAndRemoveProviderProfile(profiles, "openai", "openai", confirmDelete);

    expect(result.confirmed).toBe(false);
    expect(result.activeProviderId).toBe("openai");
    expect(profiles).toEqual([{ id: "openai", name: "OpenAI Compatible" }]);
    expect(confirmDelete).not.toHaveBeenCalled();
  });

  it("does not prompt or mutate when the requested profile no longer exists", () => {
    const profiles = [{ id: "openai", name: "OpenAI Compatible" }, { id: "gemini", name: "Gemini Custom" }];
    const confirmDelete = vi.fn(() => true);

    const result = confirmAndRemoveProviderProfile(profiles, "missing", "openai", confirmDelete);

    expect(result.confirmed).toBe(false);
    expect(result.activeProviderId).toBe("openai");
    expect(profiles.map(profile => profile.id)).toEqual(["openai", "gemini"]);
    expect(confirmDelete).not.toHaveBeenCalled();
  });
});
