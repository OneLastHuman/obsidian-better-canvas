import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { chatCompletion, generateImage, type AISettings } from "./ai";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn()
}));

const settings: AISettings = {
  baseUrl: "https://ai.example.test/v1",
  apiKey: "",
  model: "test-model",
  imageModel: "",
  systemPrompt: ""
};
const messages = [{ role: "user" as const, content: "Say hello." }];

describe("AI completion response errors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces malformed JSON from a successful response with a friendly error", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: "garbage-not-json-at-all"
    } as any);

    await expect(chatCompletion(settings, messages))
      .rejects.toThrow("AI 服务返回了成功状态，但没有找到可用的文本内容。");
  });

  it("handles an empty successful response without exposing a JSON parser error", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: ""
    } as any);

    await expect(chatCompletion(settings, messages))
      .rejects.toThrow("AI 服务返回了成功状态，但没有找到可用的文本内容。");
  });

  it("continues parsing valid completion payloads", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "Hello." } }] })
    } as any);

    await expect(chatCompletion(settings, messages)).resolves.toBe("Hello.");
  });

  it("preserves the existing structured error for non-2xx responses", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 500,
      text: JSON.stringify({ error: { message: "boom" } })
    } as any);

    await expect(chatCompletion(settings, messages))
      .rejects.toThrow("AI API 请求失败（HTTP 500）: boom");
  });
});

describe("AI image generation payload validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-image base64 before callers can persist it as a PNG", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ data: [{ b64_json: "dGhpcy1pcy1ub3QtYS1wbmc=" }] })
    } as any);

    await expect(generateImage({ ...settings, imageModel: "test-image-model" }, "draw a cat"))
      .rejects.toThrow(/不是受支持的图片格式/);
  });

  it("uses the signature, not the MIME label, to choose the image extension", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      text: JSON.stringify({ data: [{ b64_json: " /9j/2Q==" }] })
    } as any);

    await expect(generateImage({ ...settings, imageModel: "test-image-model" }, "draw a cat"))
      .resolves.toMatchObject({ extension: "jpg" });
  });
});
