import { requestUrl } from "obsidian";
import { hasUnsupportedACPContent, runOpenCodeACP } from "./opencode-acp";
import { mergeProviderParams, resolveMaxOutputTokens, resolveTemperature } from "./provider-params";
import { emitAIUsageEvent, extractProviderUsage, mergeUsageCounts, type AIUsageTokenCounts } from "./ai-usage";

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
  /** Text-generation backend; image generation remains on the configured API endpoint. */
  backend?: "api" | "opencode-acp";
  /** Optional absolute path to the OpenCode CLI; defaults to opencode on PATH. */
  opencodeBinaryPath?: string;
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
  if (!base) throw new Error("请先在 Better Canvas 设置中填写 API Base URL。");
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
  if (!model) throw new Error("请先在 Better Canvas 设置中填写 Gemini model。");
  const action = streaming ? "streamGenerateContent" : "generateContent";
  const alreadyAction = base.match(/^(.*\/models\/[^/:]+):(generateContent|streamGenerateContent)$/);
  const result = alreadyAction
    ? alreadyAction[1] + ":" + action
    : base + "/models/" + encodeURIComponent(model) + ":" + action;
  return streaming ? result + (result.includes("?") ? "&" : "?") + "alt=sse" : result;
}

function bodyOf(response: any): any {
  if (response?.json && typeof response.json === "object") return response.json;
  const raw = String(response?.text ?? "");
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function responseError(status: number, body: any, rawText?: string): Error {
  const detail = body?.error?.message ?? body?.message ?? rawText ?? (typeof body === "string" ? body : "");
  return new Error("AI API 请求失败（HTTP " + status + "）" + (detail ? ": " + String(detail).slice(0, 1200) : ""));
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

function anthropicContent(content: ChatMessageContent): any {
  if (typeof content === "string") return content;
  return content.map(part => {
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

function geminiParts(content: ChatMessageContent): any[] {
  if (typeof content === "string") return [{ text: content }];
  const result: any[] = [];
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
  return mergeProviderParams("openai", {
    model: settings.model.trim(),
    messages,
    temperature: resolveTemperature(settings.temperature, 0.4, "openai"),
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(streaming ? { stream: true } : {})
  }, settings.providerParams);
}

function parseCompletion(protocol: AIProtocol, body: any): string {
  if (protocol === "anthropic") {
    const text = Array.isArray(body?.content)
      ? body.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("")
      : "";
    if (text.trim()) return text.trim();
  } else if (protocol === "gemini") {
    const parts = body?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("") : "";
    if (text.trim()) return text.trim();
  } else {
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content.map((item: any) => typeof item?.text === "string" ? item.text : "").filter(Boolean).join("\n").trim();
      if (joined) return joined;
    }
  }
  throw new Error("AI 服务返回了成功状态，但没有找到可用的文本内容。");
}

export async function chatCompletion(
  settings: AISettings,
  messages: ChatMessage[]
): Promise<string> {
  if (settings.backend === "opencode-acp") {
    if (hasUnsupportedACPContent(messages)) {
      throw new Error("本机 OpenCode ACP 当前仅支持文本任务。此请求包含图片或文件上下文，请切换到 API 后端以保留多模态内容。");
    }
    return runOpenCodeACP(messages, { binaryPath: settings.opencodeBinaryPath });
  }
  if (!settings.model.trim()) throw new Error("请先在 Better Canvas 设置中填写 Chat model。");
  const protocol = protocolOf(settings);
  let response: any;
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
  if (settings.backend === "opencode-acp") {
    if (hasUnsupportedACPContent(messages)) {
      throw new Error("本机 OpenCode ACP 当前仅支持文本任务。此请求包含图片或文件上下文，请切换到 API 后端以保留多模态内容。");
    }
    return runOpenCodeACP(messages, { binaryPath: settings.opencodeBinaryPath, signal, onDelta });
  }
  if (!settings.model.trim()) throw new Error("请先在 Better Canvas 设置中填写 Chat model。");
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
    response = await fetch(streamingUrl, {
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
    let bodyError: any = raw;
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
    let event: any;
    try { event = JSON.parse(payload); } catch { return false; }

    reportedUsage = mergeUsageCounts(reportedUsage, extractProviderUsage(protocol, event));
    let delta = "";
    if (protocol === "anthropic") {
      if (event?.type === "content_block_delta" && typeof event?.delta?.text === "string") delta = event.delta.text;
      else if (event?.type === "content_block_start" && typeof event?.content_block?.text === "string") delta = event.content_block.text;
    } else if (protocol === "gemini") {
      const parts = event?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) delta = parts.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    } else {
      const value = event?.choices?.[0]?.delta?.content;
      if (typeof value === "string") delta = value;
      else if (Array.isArray(value)) delta = value.map((part: any) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("");
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
  if (!accumulated.trim()) throw new Error("AI 服务结束了请求，但没有返回可显示的文本内容。");
  emitAIUsageEvent(protocol, settings.model, reportedUsage);
  return accumulated.trim();
}

export async function generateImage(
  settings: AISettings,
  prompt: string
): Promise<{ bytes: Uint8Array; extension: string }> {
  const protocol = protocolOf(settings);
  const model = settings.imageModel.trim() || settings.model.trim();
  if (!model) throw new Error("请先在设置中填写 Image model。");

  if (protocol === "anthropic") {
    throw new Error("Anthropic 原生 Messages API 不提供图像生成 endpoint。请切换到支持图像生成的 Gemini 或 OpenAI 兼容 profile。");
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
    const parts = body?.candidates?.[0]?.content?.parts;
    const image = Array.isArray(parts) ? parts.find((part: any) => {
      const inline = part?.inlineData ?? part?.inline_data;
      return typeof inline?.data === "string";
    }) : null;
    const inline = image?.inlineData ?? image?.inline_data;
    if (typeof inline?.data !== "string") {
      throw new Error("Gemini 图像模型未返回图片内容；请确认该模型支持图像生成。");
    }
    const decoded = atob(inline.data);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
    const mime = String(inline.mimeType ?? inline.mime_type ?? "image/png").toLowerCase();
    const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
    return { bytes, extension };
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

  const first = body?.data?.[0];
  if (typeof first?.b64_json === "string") {
    const decoded = atob(first.b64_json);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return { bytes, extension: "png" };
  }
  if (typeof first?.url === "string") {
    const imageResponse = await requestUrl({ url: first.url, method: "GET", throw: false });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new Error("下载生成图片失败（HTTP " + imageResponse.status + "）。");
    }
    const mime = String(imageResponse.headers?.["content-type"] ?? "").toLowerCase();
    const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg"
      : mime.includes("webp") ? "webp" : "png";
    return { bytes: new Uint8Array(imageResponse.arrayBuffer), extension };
  }
  throw new Error("图像服务没有返回 b64_json 或可下载的图片 URL。");
}
