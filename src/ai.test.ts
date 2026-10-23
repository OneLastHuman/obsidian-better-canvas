import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, requestUrl } from "obsidian";
import { chatCompletion, chatCompletionStream, generateImage, type AISettings } from "./ai";
import { runLocalCodex } from "./codex-cli";
import { runOpenCodeACP } from "./opencode-acp";
import { runLocalAgent } from "./local-agent-cli";
import { LOCAL_AGENTS, isAdditionalAgentBackend } from "./local-agent-settings";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn(),
  Platform: { isDesktopApp: true }
}));

vi.mock("./codex-cli", () => ({ runLocalCodex: vi.fn() }));
vi.mock("./opencode-acp", async importOriginal => ({
  ...await importOriginal<typeof import("./opencode-acp")>(),
  runOpenCodeACP: vi.fn()
}));
vi.mock("./local-agent-cli", () => ({ runLocalAgent: vi.fn() }));

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
    await expect(chatCompletion({ ...settings, backend: "codex-cli", codexBinaryPath: "/usr/bin/codex", codexModel: "custom-codex" }, messages))
      .resolves.toBe("Codex answer");
    expect(requestUrl).not.toHaveBeenCalled();
    expect(runLocalCodex).toHaveBeenCalledWith("USER:\nSay hello.", expect.objectContaining({
      binaryPath: "/usr/bin/codex",
      model: "custom-codex",
      timeoutMs: 300_000,
      signal: expect.any(AbortSignal)
    }));
  });

  it("emits the CLI answer through the streaming callback", async () => {
    const deltas: string[] = [];
    const controller = new AbortController();
    const answer = await chatCompletionStream(
      { ...settings, backend: "codex-cli", codexModel: "stream-codex" },
      messages,
      controller.signal,
      delta => deltas.push(delta)
    );
    expect(answer).toBe("Codex answer");
    expect(deltas).toEqual(["Codex answer"]);
    expect(runLocalCodex).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ model: "stream-codex" }));
  });
});

describe("local text backend routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runLocalAgent).mockResolvedValue("Agent answer");
    vi.mocked(runOpenCodeACP).mockResolvedValue("ACP answer");
  });

  it("passes the independent OpenCode model to both completion paths", async () => {
    const selected: AISettings = { ...settings, backend: "opencode-acp", opencodeModel: "provider/chosen", codexModel: "other" };
    await expect(chatCompletion(selected, messages)).resolves.toBe("ACP answer");
    const controller = new AbortController();
    const onDelta = vi.fn();
    await chatCompletionStream(selected, messages, controller.signal, onDelta);
    expect(runOpenCodeACP).toHaveBeenNthCalledWith(1, messages, expect.objectContaining({ model: "provider/chosen" }));
    expect(runOpenCodeACP).toHaveBeenNthCalledWith(2, messages, expect.objectContaining({ model: "provider/chosen", signal: controller.signal, onDelta }));
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it.each(LOCAL_AGENTS.filter(agent => isAdditionalAgentBackend(agent.id)))("routes $name with its own path and model", async agent => {
    const selected: AISettings = {
      ...settings,
      backend: agent.id,
      localAgents: { [agent.id]: { binaryPath: "/bin/selected-agent", model: "selected-model" } }
    };
    await expect(chatCompletion(selected, messages)).resolves.toBe("Agent answer");
    const signal = new AbortController().signal;
    const onDelta = vi.fn();
    await chatCompletionStream(selected, messages, signal, onDelta);
    expect(runLocalAgent).toHaveBeenNthCalledWith(1, messages, {
      backend: agent.id, binaryPath: "/bin/selected-agent", model: "selected-model"
    });
    expect(runLocalAgent).toHaveBeenNthCalledWith(2, messages, {
      backend: agent.id, binaryPath: "/bin/selected-agent", model: "selected-model", signal, onDelta
    });
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it.each(LOCAL_AGENTS)("rejects image context for $name before starting a process", async agent => {
    await expect(chatCompletion({ ...settings, backend: agent.id }, [{
      role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,eA==" } }]
    }])).rejects.toThrow(/图片|多模态/);
    expect(runLocalAgent).not.toHaveBeenCalled();
    expect(runOpenCodeACP).not.toHaveBeenCalled();
    expect(runLocalCodex).not.toHaveBeenCalled();
  });

  it.each(LOCAL_AGENTS)("rejects $name on mobile before starting a process", async agent => {
    const original = Platform.isDesktopApp;
    (Platform as { isDesktopApp: boolean }).isDesktopApp = false;
    try {
      await expect(chatCompletion({ ...settings, backend: agent.id }, messages)).rejects.toThrow(/桌面/);
      expect(runLocalAgent).not.toHaveBeenCalled();
      expect(runOpenCodeACP).not.toHaveBeenCalled();
      expect(runLocalCodex).not.toHaveBeenCalled();
    } finally {
      (Platform as { isDesktopApp: boolean }).isDesktopApp = original;
    }
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
