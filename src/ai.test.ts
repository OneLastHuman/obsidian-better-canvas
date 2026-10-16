import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { chatCompletion, chatCompletionStream, generateImage, type AISettings } from "./ai";
import { runLocalCodex } from "./codex-cli";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
  Platform: { isDesktopApp: true }
}));

vi.mock("./codex-cli", () => ({ runLocalCodex: vi.fn() }));

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


describe("Codex CLI text backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runLocalCodex).mockResolvedValue("Codex answer");
  });

  it("routes regular text completions through the configured CLI", async () => {
    await expect(chatCompletion({ ...settings, backend: "codex-cli", codexBinaryPath: "/usr/bin/codex" }, messages))
      .resolves.toBe("Codex answer");
    expect(requestUrl).not.toHaveBeenCalled();
    expect(runLocalCodex).toHaveBeenCalledWith("USER:\nSay hello.", expect.objectContaining({
      binaryPath: "/usr/bin/codex",
      timeoutMs: 300_000,
      signal: expect.any(AbortSignal)
    }));
  });

  it("emits the CLI answer through the streaming callback", async () => {
    const deltas: string[] = [];
    const controller = new AbortController();
    const answer = await chatCompletionStream(
      { ...settings, backend: "codex-cli" },
      messages,
      controller.signal,
      delta => deltas.push(delta)
    );
    expect(answer).toBe("Codex answer");
    expect(deltas).toEqual(["Codex answer"]);
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
