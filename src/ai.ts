import { Platform, requestUrl, type RequestUrlResponse } from "obsidian";
import { runLocalCodex } from "./codex-cli";
import { requestStream } from "./desktop-stream-request";
import { decodeBase64Image, detectImageFormat } from "./image-payload";
import { hasUnsupportedACPContent, runOpenCodeACP } from "./opencode-acp";
import { mergeProviderParams, resolveMaxOutputTokens, resolveTemperature } from "./provider-params";
import { emitAIUsageEvent, extractProviderUsage, mergeUsageCounts, type AIUsageTokenCounts } from "./ai-usage-core";
import { runLocalAgent } from "./local-agent-cli";
import { isAdditionalAgentBackend, localAgentConfig, type TextBackend, type LocalAgentConfig } from "./local-agent-settings";
import { t } from "./i18n";

export type AIProtocol = "openai" | "anthropic" | "gemini";

export type ChatMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "file_data"; file_data: { file_uri: string; mime_type?: string } }
>;

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
  systemPrompt: string;
  /** Text-generation backend; image generation receives separate API settings. */
  backend?: TextBackend;
  localAgents?: Record<string, LocalAgentConfig>;
  /** Optional absolute path to the OpenCode CLI; defaults to opencode on PATH. */
  opencodeBinaryPath?: string;
  opencodeModel?: string;
  /** Optional absolute path to Codex CLI; defaults to codex on PATH. */
  codexBinaryPath?: string;
  codexModel?: string;
  protocol?: AIProtocol;
  /** Optional sampling temperature; defaults to 0.4. */
  temperature?: number;
  /** Optional output-token ceiling; undefined keeps the protocol adapter default. */
  maxOutputTokens?: number;
  /** Validated extra provider request fields; protocol-owned fields are reserved. */
  providerParams?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

function protocolOf(settings: AISettings): AIProtocol {
  return settings.protocol === "anthropic" || settings.protocol === "gemini"
    ? settings.protocol
    : "openai";
}

function rootUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error(t("Set the API Base URL in Better Canvas settings first.", "请先在 Better Canvas 设置中填写 API Base URL。"));
  return base;
}

function endpoint(baseUrl: string, path: string): string {
  const base = rootUrl(baseUrl);
  if (base.endsWith("/" + path) || base.endsWith(path)) return base;
  return base + "/" + path.replace(/^\/+/, "");
}

function geminiEndpoint(settings: AISettings, streaming: boolean, modelOverride?: string): string {
  const base = rootUrl(settings.baseUrl);
  const model = String(modelOverride || settings.model).trim().replace(/^models\//, "");
  if (!model) throw new Error(t("Set the Gemini model in Better Canvas settings first.", "请先在 Better Canvas 设置中填写 Gemini model。"));
  const action = streaming ? "streamGenerateContent" : "generateContent";
  const alreadyAction = base.match(/^(.*\/models\/[^/:]+):(generateContent|streamGenerateContent)$/);
  const result = alreadyAction
    ? alreadyAction[1] + ":" + action
    : base + "/models/" + encodeURIComponent(model) + ":" + action;
  return streaming ? result + (result.includes("?") ? "&" : "?") + "alt=sse" : result;
}

function bodyOf(response: RequestUrlResponse): unknown {
  const json: unknown = response.json;
  if (json && typeof json === "object") return json;
  const raw = response.text;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return raw;
  }
}

function responseError(status: number, body: unknown, rawText?: string): Error {
  const message = body && typeof body === "object" && "message" in body ? body.message : undefined;
  const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
  const nestedMessage = error && typeof error === "object" && "message" in error ? error.message : undefined;
  const detail = nestedMessage ?? message ?? rawText ?? (typeof body === "string" ? body : "");
  const detailText = typeof detail === "string" ? detail
    : typeof detail === "number" || typeof detail === "boolean" ? String(detail)
    : rawText ?? "";
  return new Error(t(`AI API request failed (HTTP ${status})`, `AI API 请求失败（HTTP ${status}）`) + (detail && detailText ? ": " + detailText.slice(0, 1200) : ""));
}

function contentText(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("\n");
}

function imageDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  return match ? { mimeType: match[1], data: match[2].replace(/\s/g, "") } : null;
}

function openAIHeaders(settings: AISettings, accept = "application/json"): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: accept };
  if (settings.apiKey.trim()) headers.Authorization = "Bearer " + settings.apiKey.trim();
  return headers;
}

function nativeHeaders(settings: AISettings, protocol: AIProtocol, accept = "application/json"): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: accept };
  if (settings.apiKey.trim()) {
    if (protocol === "anthropic") headers["x-api-key"] = settings.apiKey.trim();
    else if (protocol === "gemini") headers["x-goog-api-key"] = settings.apiKey.trim();
  }
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  return headers;
}

type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

type GeminiPart =
  | { text: string }
  | { fileData: { fileUri: string; mimeType?: string } }
  | { inlineData: { mimeType: string; data: string } };

function anthropicContent(content: ChatMessageContent): string | AnthropicContentPart[] {
  if (typeof content === "string") return content;
  return content.map<AnthropicContentPart>(part => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "file_data") {
      return { type: "text", text: "[Video URL omitted: native URL video context is supported only by the Gemini adapter]" };
    }
    const image = imageDataUrl(part.image_url.url);
    if (!image) return { type: "text", text: "[Image omitted: Anthropic native API currently accepts only base64 data URLs in this adapter]" };
    return {
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.data }
    };
  });
}

function geminiParts(content: ChatMessageContent): GeminiPart[] {
  if (typeof content === "string") return [{ text: content }];
  const result: GeminiPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      result.push({ text: part.text });
      continue;
    }
    if (part.type === "file_data") {
      result.push({
        fileData: {
          fileUri: part.file_data.file_uri,
          ...(part.file_data.mime_type ? { mimeType: part.file_data.mime_type } : {})
        }
      });
      continue;
    }
    const image = imageDataUrl(part.image_url.url);
    if (image) result.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    else result.push({ text: "[Image URL omitted: this adapter sends inline image data only]" });
  }
  return result;
}

function toAnthropicRequest(settings: AISettings, messages: ChatMessage[], streaming: boolean): Record<string, unknown> {
  const system = messages.filter(message => message.role === "system").map(message => contentText(message.content)).join("\n\n");
  const userMessages = messages.filter(message => message.role !== "system").map(message => ({
    role: message.role,
    content: anthropicContent(message.content)
  }));
  const maxOutputTokens = resolveMaxOutputTokens(settings.maxOutputTokens);
  return mergeProviderParams("anthropic", {
    model: settings.model.trim(),
    max_tokens: maxOutputTokens ?? 4096,
    ...(system ? { system } : {}),
    messages: userMessages,
    temperature: resolveTemperature(settings.temperature, 0.4, "anthropic"),
    ...(streaming ? { stream: true } : {})
  }, settings.providerParams);
}

function toGeminiRequest(settings: AISettings, messages: ChatMessage[], streaming: boolean): Record<string, unknown> {
  const system = messages.filter(message => message.role === "system").map(message => contentText(message.content)).join("\n\n");
  const contents = messages.filter(message => message.role !== "system").map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: geminiParts(message.content)
  }));
  const maxOutputTokens = resolveMaxOutputTokens(settings.maxOutputTokens);
  return mergeProviderParams("gemini", {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      temperature: resolveTemperature(settings.temperature, 0.4, "gemini"),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(streaming ? {} : {})
    }
  }, settings.providerParams);
}

function toOpenAIRequest(settings: AISettings, messages: ChatMessage[], streaming: boolean): Record<string, unknown> {
  const maxOutputTokens = resolveMaxOutputTokens(settings.maxOutputTokens);
  const body = mergeProviderParams("openai", {
    model: settings.model.trim(),
    messages,
    temperature: resolveTemperature(settings.temperature, 0.4, "openai"),
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(streaming ? { stream: true } : {})
  }, settings.providerParams);
  // OpenAI only returns usage in stream chunks when this option is requested.
  // Do not send this vendor-specific field to arbitrary OpenAI-compatible gateways.
  if (streaming) {
    try {
      if (new URL(settings.baseUrl).hostname.toLowerCase() === "api.openai.com") {
        body.stream_options = { include_usage: true };
      }
    } catch {
      // URL validation is handled by endpoint() before the request is sent.
    }
  }
  return body;
}

function textPart(value: unknown): string {
  return value && typeof value === "object" && "text" in value && typeof value.text === "string" ? value.text : "";
}

function geminiResponseParts(body: unknown): unknown[] {
  if (!body || typeof body !== "object" || !("candidates" in body) || !Array.isArray(body.candidates)) return [];
  const candidates: unknown[] = body.candidates;
  const first = candidates[0];
  if (!first || typeof first !== "object" || !("content" in first)) return [];
  const content = first.content;
  if (!content || typeof content !== "object" || !("parts" in content) || !Array.isArray(content.parts)) return [];
  const parts: unknown[] = content.parts;
  return parts;
}

function openAIResponseContent(body: unknown, section: "message" | "delta"): unknown {
  if (!body || typeof body !== "object" || !("choices" in body) || !Array.isArray(body.choices)) return undefined;
  const choices: unknown[] = body.choices;
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = section === "message"
    ? ("message" in first ? first.message : undefined)
    : ("delta" in first ? first.delta : undefined);
  return message && typeof message === "object" && "content" in message ? message.content : undefined;
}

function parseCompletion(protocol: AIProtocol, body: unknown): string {
  // bodyOf() preserves an unparsable success response as raw text so HTTP
  // error responses can include their original message. A 2xx response must
  // not leak JSON.parse's implementation-specific exception into the Notice.
  if (typeof body === "string") {
    throw new Error(t("The AI service returned a success status but no usable text content.", "AI 服务返回了成功状态，但没有找到可用的文本内容。"));
  }
  if (protocol === "anthropic") {
    const content: unknown = body && typeof body === "object" && "content" in body ? body.content : undefined;
    const parts: unknown[] = Array.isArray(content) ? content : [];
    const text = parts.filter(part => part && typeof part === "object" && "type" in part && part.type === "text")
      .map(textPart).join("");
    if (text.trim()) return text.trim();
  } else if (protocol === "gemini") {
    const text = geminiResponseParts(body).map(textPart).join("");
    if (text.trim()) return text.trim();
  } else {
    const content = openAIResponseContent(body, "message");
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const parts: unknown[] = content;
      const joined = parts.map(textPart).filter(Boolean).join("\n").trim();
      if (joined) return joined;
    }
  }
  throw new Error(t("The AI service returned a success status but no usable text content.", "AI 服务返回了成功状态，但没有找到可用的文本内容。"));
}

async function completeWithCodex(
  settings: AISettings,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  if (!Platform.isDesktopApp) throw new Error(t("The Codex CLI backend only works in the Obsidian desktop app.", "Codex CLI 后端仅支持 Obsidian 桌面版。"));
  if (hasUnsupportedACPContent(messages)) {
    throw new Error(t("Codex CLI only supports text tasks right now. This request includes image or file context; switch to an LLM API backend.", "Codex CLI 当前仅支持文本任务。此请求包含图片或文件上下文，请切换到大模型 API 后端。"));
  }
  const prompt = messages.map(message =>
    message.role.toUpperCase() + ":\n" + contentText(message.content)
  ).join("\n\n");
  return runLocalCodex(prompt, {
    binaryPath: settings.codexBinaryPath,
    model: settings.codexModel,
    signal,
    timeoutMs: 300_000
  });
}

export async function chatCompletion(
  settings: AISettings,
  messages: ChatMessage[]
): Promise<string> {
  if (isAdditionalAgentBackend(settings.backend)) {
    if (!Platform.isDesktopApp) throw new Error(t("Local agents only work in the Obsidian desktop app.", "本地 Agent 仅支持 Obsidian 桌面版。"));
    if (hasUnsupportedACPContent(messages)) throw new Error(t("Local agents only support text tasks right now. Switch to a model service API for image or file context.", "本地 Agent 当前仅支持文本任务。图片或文件上下文请切换到模型服务 API。"));
    return runLocalAgent(messages, { backend: settings.backend, ...localAgentConfig(settings, settings.backend) });
  }
  if (settings.backend === "opencode-acp") {
    if (!Platform.isDesktopApp) throw new Error(t("OpenCode ACP only works in the Obsidian desktop app.", "OpenCode ACP 仅支持 Obsidian 桌面版。"));
    if (hasUnsupportedACPContent(messages)) {
      throw new Error(t("Local OpenCode ACP only supports text tasks right now. This request includes image or file context; switch to an API backend to keep multimodal content.", "本机 OpenCode ACP 当前仅支持文本任务。此请求包含图片或文件上下文，请切换到 API 后端以保留多模态内容。"));
    }
    return runOpenCodeACP(messages, { binaryPath: settings.opencodeBinaryPath, model: settings.opencodeModel });
  }
  if (settings.backend === "codex-cli") {
    return completeWithCodex(settings, messages, new AbortController().signal);
  }
  if (!settings.model.trim()) throw new Error(t("Set the chat model in Better Canvas settings first.", "请先在 Better Canvas 设置中填写 Chat model。"));
  const protocol = protocolOf(settings);
  let response: RequestUrlResponse;
  if (protocol === "anthropic") {
    response = await requestUrl({
      url: endpoint(settings.baseUrl, "messages"),
      method: "POST",
      headers: nativeHeaders(settings, protocol),
      body: JSON.stringify(toAnthropicRequest(settings, messages, false)),
      throw: false
    });
  } else if (protocol === "gemini") {
    response = await requestUrl({
      url: geminiEndpoint(settings, false),
      method: "POST",
      headers: nativeHeaders(settings, protocol),
      body: JSON.stringify(toGeminiRequest(settings, messages, false)),
      throw: false
    });
  } else {
    response = await requestUrl({
      url: endpoint(settings.baseUrl, "chat/completions"),
      method: "POST",
      headers: openAIHeaders(settings),
      body: JSON.stringify(toOpenAIRequest(settings, messages, false)),
      throw: false
    });
  }
  const body = bodyOf(response);
  if (response.status < 200 || response.status >= 300) throw responseError(response.status, body, response.text);
  const completion = parseCompletion(protocol, body);
  emitAIUsageEvent(protocol, settings.model, extractProviderUsage(protocol, body) ?? {});
  return completion;
}

export async function chatCompletionStream(
  settings: AISettings,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (delta: string) => void
): Promise<string> {
  if (isAdditionalAgentBackend(settings.backend)) {
    if (!Platform.isDesktopApp) throw new Error(t("Local agents only work in the Obsidian desktop app.", "本地 Agent 仅支持 Obsidian 桌面版。"));
    if (hasUnsupportedACPContent(messages)) throw new Error(t("Local agents only support text tasks right now. Switch to a model service API for image or file context.", "本地 Agent 当前仅支持文本任务。图片或文件上下文请切换到模型服务 API。"));
    return runLocalAgent(messages, { backend: settings.backend, ...localAgentConfig(settings, settings.backend), signal, onDelta });
  }
  if (settings.backend === "opencode-acp") {
    if (!Platform.isDesktopApp) throw new Error(t("OpenCode ACP only works in the Obsidian desktop app.", "OpenCode ACP 仅支持 Obsidian 桌面版。"));
    if (hasUnsupportedACPContent(messages)) {
      throw new Error(t("Local OpenCode ACP only supports text tasks right now. This request includes image or file context; switch to an API backend to keep multimodal content.", "本机 OpenCode ACP 当前仅支持文本任务。此请求包含图片或文件上下文，请切换到 API 后端以保留多模态内容。"));
    }
    return runOpenCodeACP(messages, { binaryPath: settings.opencodeBinaryPath, model: settings.opencodeModel, signal, onDelta });
  }
  if (settings.backend === "codex-cli") {
    const answer = await completeWithCodex(settings, messages, signal);
    if (signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
    onDelta(answer);
    return answer;
  }
  if (!settings.model.trim()) throw new Error(t("Set the chat model in Better Canvas settings first.", "请先在 Better Canvas 设置中填写 Chat model。"));
  const protocol = protocolOf(settings);
  const streamingUrl = protocol === "gemini"
    ? geminiEndpoint(settings, true)
    : endpoint(settings.baseUrl, protocol === "anthropic" ? "messages" : "chat/completions");
  const headers = protocol === "openai"
    ? openAIHeaders(settings, "text/event-stream, application/json")
    : nativeHeaders(settings, protocol, "text/event-stream, application/json");
  const body = protocol === "anthropic"
    ? toAnthropicRequest(settings, messages, true)
    : protocol === "gemini"
      ? toGeminiRequest(settings, messages, true)
      : toOpenAIRequest(settings, messages, true);

  let response: Response;
  try {
    response = await requestStream(streamingUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof TypeError) {
      const answer = await chatCompletion(settings, messages);
      if (signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
      onDelta(answer);
      return answer;
    }
    throw error;
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let bodyError: unknown = raw;
    try { bodyError = JSON.parse(raw); } catch { /* keep raw message */ }
    throw responseError(response.status, bodyError, raw);
  }
  if (!response.body) {
    const answer = await chatCompletion(settings, messages);
    if (signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
    onDelta(answer);
    return answer;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let reportedUsage: AIUsageTokenCounts = {};
  let done = false;

  const consumeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;
    let event: unknown;
    try { event = JSON.parse(payload); } catch { return false; }

    reportedUsage = mergeUsageCounts(reportedUsage, extractProviderUsage(protocol, event));
    let delta = "";
    if (protocol === "anthropic") {
      if (event && typeof event === "object" && "type" in event) {
        if (event.type === "content_block_delta" && "delta" in event) delta = textPart(event.delta);
        else if (event.type === "content_block_start" && "content_block" in event) delta = textPart(event.content_block);
      }
    } else if (protocol === "gemini") {
      delta = geminiResponseParts(event).map(textPart).join("");
    } else {
      const value = openAIResponseContent(event, "delta");
      if (typeof value === "string") delta = value;
      else if (Array.isArray(value)) {
        const parts: unknown[] = value;
        delta = parts.map(textPart).filter(Boolean).join("");
      }
    }
    if (delta) {
      accumulated += delta;
      onDelta(delta);
    }
    return false;
  };

  while (!done) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException("The AI request was aborted.", "AbortError");
    }
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (consumeLine(line)) {
        done = true;
        break;
      }
    }
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);
  if (signal.aborted) throw new DOMException("The AI request was aborted.", "AbortError");
  if (!accumulated.trim()) throw new Error(t("The AI service ended the request without returning displayable text.", "AI 服务结束了请求，但没有返回可显示的文本内容。"));
  emitAIUsageEvent(protocol, settings.model, reportedUsage);
  return accumulated.trim();
}

export async function generateImage(
  settings: AISettings,
  prompt: string
): Promise<{ bytes: Uint8Array; extension: string }> {
  const protocol = protocolOf(settings);
  const model = settings.imageModel.trim() || settings.model.trim();
  if (!model) throw new Error(t("Set the image model in settings first.", "请先在设置中填写 Image model。"));

  if (protocol === "anthropic") {
    throw new Error(t("The Anthropic native Messages API has no image generation endpoint. Switch to a Gemini or OpenAI-compatible profile that supports image generation.", "Anthropic 原生 Messages API 不提供图像生成 endpoint。请切换到支持图像生成的 Gemini 或 OpenAI 兼容 profile。"));
  }

  if (protocol === "gemini") {
    const imageSettings = { ...settings, model };
    const response = await requestUrl({
      url: geminiEndpoint(imageSettings, false, model),
      method: "POST",
      headers: nativeHeaders(settings, protocol),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      }),
      throw: false
    });
    const body = bodyOf(response);
    if (response.status < 200 || response.status >= 300) throw responseError(response.status, body, response.text);
    const parts = geminiResponseParts(body);
    let imageData: string | undefined;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = "inlineData" in part ? part.inlineData : undefined;
      const inline = inlineData ?? ("inline_data" in part ? part.inline_data : undefined);
      if (inline && typeof inline === "object" && "data" in inline && typeof inline.data === "string") {
        imageData = inline.data;
        break;
      }
    }
    if (imageData === undefined) {
      throw new Error(t("The Gemini image model returned no image content; check that this model supports image generation.", "Gemini 图像模型未返回图片内容；请确认该模型支持图像生成。"));
    }
    const validated = decodeBase64Image(imageData);
    return { bytes: validated.bytes, extension: validated.extension };
  }

  const response = await requestUrl({
    url: endpoint(settings.baseUrl, "images/generations"),
    method: "POST",
    headers: openAIHeaders(settings),
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024"
    }),
    throw: false
  });
  const body = bodyOf(response);
  if (response.status < 200 || response.status >= 300) throw responseError(response.status, body, response.text);

  const data: unknown[] = body && typeof body === "object" && "data" in body && Array.isArray(body.data) ? body.data : [];
  const first = data[0];
  if (first && typeof first === "object" && "b64_json" in first && typeof first.b64_json === "string") {
    const validated = decodeBase64Image(first.b64_json);
    return { bytes: validated.bytes, extension: validated.extension };
  }
  if (first && typeof first === "object" && "url" in first && typeof first.url === "string") {
    const imageResponse = await requestUrl({ url: first.url, method: "GET", throw: false });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new Error(t(`Failed to download the generated image (HTTP ${imageResponse.status}).`, `下载生成图片失败（HTTP ${imageResponse.status}）。`));
    }
    const bytes = new Uint8Array(imageResponse.arrayBuffer);
    const detected = detectImageFormat(bytes);
    return { bytes, extension: detected.extension };
  }
  throw new Error(t("The image service returned neither b64_json nor a downloadable image URL.", "图像服务没有返回 b64_json 或可下载的图片 URL。"));
}
