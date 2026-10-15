import { describe, expect, it, vi } from "vitest";
import {
  modelCapabilityReportKey,
  probeModelCapabilities,
  type CapabilityCompleter
} from "./model-capabilities";
import type { AISettings, ChatMessage } from "./ai";

const settings: AISettings = {
  baseUrl: "https://example.test/v1",
  apiKey: "secret-key",
  model: "example-vision-model",
  imageModel: "",
  systemPrompt: "",
  protocol: "openai",
  backend: "opencode-acp"
};

describe("per-model capability probe", () => {
  it("runs explicit text and image-input requests through the API protocol and persists bounded results", async () => {
    const complete = vi.fn<CapabilityCompleter>(async (_settings: AISettings, _messages: ChatMessage[]) => "probe ok");
    const result = await probeModelCapabilities(
      { id: "provider-a", name: "Provider A" },
      settings,
      complete,
      () => new Date("2026-01-02T03:04:05.000Z")
    );

    expect(result).toMatchObject({
      profileId: "provider-a",
      profileName: "Provider A",
      protocol: "openai",
      model: "example-vision-model",
      testedAt: "2026-01-02T03:04:05.000Z",
      text: { status: "accepted" },
      imageInput: { status: "accepted" }
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][0].backend).toBe("api");
    expect(complete.mock.calls[0][1][1].content).toContain("BC_TEXT_PROBE_OK");
    const imageContent = complete.mock.calls[1][1][1].content;
    expect(Array.isArray(imageContent)).toBe(true);
    expect(imageContent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "image_url",
        image_url: expect.objectContaining({ url: expect.stringContaining("data:image/png;base64,") })
      })
    ]));
    expect(result.note).toContain("不会验证图片生成");
  });

  it("does not send the image request when the text request fails and redacts the API key", async () => {
    const complete = vi.fn<CapabilityCompleter>(async () => {
      throw new Error("request failed with key secret-key");
    });
    const result = await probeModelCapabilities(
      { id: "provider-a", name: "Provider A" },
      settings,
      complete
    );

    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.text.status).toBe("failed");
    expect(result.text.detail).not.toContain("secret-key");
    expect(result.text.detail).toContain("[redacted]");
    expect(result.imageInput.status).toBe("not-run");
  });

  it("records an empty text response as failure without spending a second request", async () => {
    const complete = vi.fn<CapabilityCompleter>(async () => "   ");
    const result = await probeModelCapabilities({ id: "p", name: "P" }, settings, complete);
    expect(result.text.status).toBe("failed");
    expect(result.imageInput.status).toBe("not-run");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful text result if image input is rejected", async () => {
    const complete = vi.fn<CapabilityCompleter>()
      .mockResolvedValueOnce("BC_TEXT_PROBE_OK")
      .mockRejectedValueOnce(new Error("images are not supported"));
    const result = await probeModelCapabilities({ id: "p", name: "P" }, settings, complete);
    expect(result.text.status).toBe("accepted");
    expect(result.imageInput.status).toBe("failed");
    expect(result.imageInput.detail).toContain("images are not supported");
  });

  it("keys reports separately by provider, protocol and model", () => {
    expect(modelCapabilityReportKey("provider-a", "OpenAI", "gpt-x"))
      .toBe("provider-a::openai::gpt-x");
    expect(modelCapabilityReportKey("provider-a", "openai", "gpt-y"))
      .not.toBe(modelCapabilityReportKey("provider-a", "openai", "gpt-x"));
    expect(modelCapabilityReportKey("provider-b", "openai", "gpt-x"))
      .not.toBe(modelCapabilityReportKey("provider-a", "openai", "gpt-x"));
  });
});
