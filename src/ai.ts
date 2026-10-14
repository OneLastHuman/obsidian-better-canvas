import { requestUrl } from "obsidian";

export type ChatMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
>;

export interface AISettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageModel: string;
  systemPrompt: string;
}

function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先在 Better Canvas 设置中填写 API Base URL。");
  return base.endsWith("/" + path) ? base : base + "/" + path;
}

function responseBody(response: any): any {
  try {
    return response.json;
  } catch {
    return response.text;
  }
}

function errorMessage(response: any, body: any): string {
  const detail = body?.error?.message ?? body?.message ?? response?.text;
  return `AI API 请求失败（HTTP ${response?.status ?? "unknown"}）${detail ? ": " + String(detail) : ""}`;
}

export async function chatCompletion(
  settings: AISettings,
  messages: Array<{ role: "system" | "user" | "assistant"; content: ChatMessageContent }>
): Promise<string> {
  if (!settings.model.trim()) throw new Error("请先在 Better Canvas 设置中填写 Chat model。");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  const response = await requestUrl({
    url: endpoint(settings.baseUrl, "chat/completions"),
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.model.trim(),
      messages,
      temperature: 0.4
    }),
    throw: false
  });
  const body = responseBody(response);
  if (response.status < 200 || response.status >= 300) throw new Error(errorMessage(response, body));

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content.map((item: any) => typeof item?.text === "string" ? item.text : "")
      .filter(Boolean).join("\n").trim();
    if (joined) return joined;
  }
  throw new Error("AI 服务返回了成功状态，但没有找到可用的文本内容。");
}

export async function chatCompletionStream(
  settings: AISettings,
  messages: Array<{ role: "system" | "user" | "assistant"; content: ChatMessageContent }>,
  signal: AbortSignal,
  onDelta: (delta: string) => void
): Promise<string> {
  if (!settings.model.trim()) throw new Error("请先在 Better Canvas 设置中填写 Chat model。");

  let accumulated = "";
  let response: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream, application/json"
    };
    if (settings.apiKey.trim()) headers.Authorization = "Bearer " + settings.apiKey.trim();
    response = await fetch(endpoint(settings.baseUrl, "chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model.trim(),
        messages,
        temperature: 0.4,
        stream: true
      }),
      signal
    });
  } catch (error) {
    if (signal.aborted) throw error;
    // Some Obsidian/mobile runtimes and custom gateways block streaming fetch/CORS.
    // Fall back to requestUrl so AI remains usable on those platforms.
    if (error instanceof TypeError) {
      const answer = await chatCompletion(settings, messages);
      onDelta(answer);
      return answer;
    }
    throw error;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message ?? parsed?.message ?? body;
    } catch {
      // Keep the raw response when the endpoint did not return JSON.
    }
    throw new Error("AI API 请求失败（HTTP " + response.status + "）" + (detail ? ": " + detail.slice(0, 1000) : ""));
  }

  if (!response.body) {
    const answer = await chatCompletion(settings, messages);
    onDelta(answer);
    return answer;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  const consumeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;
    let event: any;
    try { event = JSON.parse(payload); } catch { return false; }
    const delta = event?.choices?.[0]?.delta?.content;
    let text = "";
    if (typeof delta === "string") text = delta;
    else if (Array.isArray(delta)) {
      text = delta.map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
    }
    if (text) {
      accumulated += text;
      onDelta(text);
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
  return accumulated.trim();
}

export async function generateImage(
  settings: AISettings,
  prompt: string
): Promise<{ bytes: Uint8Array; extension: string }> {
  const model = settings.imageModel.trim() || settings.model.trim();
  if (!model) throw new Error("请先在设置中填写 Image model。");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  const response = await requestUrl({
    url: endpoint(settings.baseUrl, "images/generations"),
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
    throw: false
  });
  const body = responseBody(response);
  if (response.status < 200 || response.status >= 300) throw new Error(errorMessage(response, body));

  const first = body?.data?.[0];
  if (typeof first?.b64_json === "string") {
    const decoded = atob(first.b64_json);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
    return { bytes, extension: "png" };
  }
  if (typeof first?.url === "string") {
    const imageResponse = await requestUrl({ url: first.url, method: "GET", throw: false });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new Error(`下载生成图片失败（HTTP ${imageResponse.status}）。`);
    }
    const mime = String(imageResponse.headers?.["content-type"] ?? "").toLowerCase();
    const extension = mime.includes("jpeg") || mime.includes("jpg") ? "jpg"
      : mime.includes("webp") ? "webp" : "png";
    return { bytes: new Uint8Array(imageResponse.arrayBuffer), extension };
  }
  throw new Error("图像服务没有返回 b64_json 或可下载的图片 URL。");
}
