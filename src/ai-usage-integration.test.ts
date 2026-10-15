import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { chatCompletion, chatCompletionStream, type AISettings } from "./ai";
import { AI_USAGE_EVENT } from "./ai-usage-core";

vi.mock("obsidian", () => ({
  requestUrl: vi.fn()
}));

const settings: AISettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  imageModel: "",
  systemPrompt: ""
};
const messages = [{ role: "user" as const, content: "Say hello." }];

class TestCustomEvent {
  type: string;
  detail: unknown;

  constructor(type: string, init: { detail: unknown }) {
    this.type = type;
    this.detail = init.detail;
  }
}

const dispatchEventSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { dispatchEvent: dispatchEventSpy });
  vi.stubGlobal("CustomEvent", TestCustomEvent);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI usage event integration", () => {
  it("emits provider token counts only after a successful non-streaming completion", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      json: {
        choices: [{ message: { content: "Hello." } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
      },
      text: ""
    } as any);

    await expect(chatCompletion(settings, messages)).resolves.toBe("Hello.");

    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0] as TestCustomEvent;
    expect(event.type).toBe(AI_USAGE_EVENT);
    expect(event.detail).toMatchObject({
      protocol: "openai",
      model: "gpt-4o-mini",
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16
    });
  });

  it("does not emit a usage record for a failed HTTP response", async () => {
    vi.mocked(requestUrl).mockResolvedValue({
      status: 500,
      json: { error: { message: "provider failure" } },
      text: ""
    } as any);

    await expect(chatCompletion(settings, messages)).rejects.toThrow(/HTTP 500/);
    expect(dispatchEventSpy).not.toHaveBeenCalled();
  });

  it("collects streaming usage-only chunks and requests usage from the official OpenAI endpoint", async () => {
    const streamBody = [
      "data: " + JSON.stringify({ choices: [{ delta: { content: "Hello." } }] }) + "\n\n",
      "data: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) + "\n\n",
      "data: [DONE]\n\n"
    ].join("");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(streamBody, { status: 200, headers: { "content-type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletionStream(settings, messages, new AbortController().signal, vi.fn()))
      .resolves.toBe("Hello.");

    const requestInit = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(requestInit?.body));
    expect(requestBody.stream_options).toEqual({ include_usage: true });
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0] as TestCustomEvent;
    expect(event.detail).toMatchObject({
      protocol: "openai",
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12
    });
  });

  it("does not send OpenAI-specific stream options to compatible gateways", async () => {
    const gatewaySettings = { ...settings, baseUrl: "https://gateway.example/v1" };
    const streamBody = [
      "data: " + JSON.stringify({ choices: [{ delta: { content: "ok" } }] }) + "\n\n",
      "data: [DONE]\n\n"
    ].join("");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(streamBody, { status: 200, headers: { "content-type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletionStream(gatewaySettings, messages, new AbortController().signal, vi.fn()))
      .resolves.toBe("ok");

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.stream_options).toBeUndefined();
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
  });
});
