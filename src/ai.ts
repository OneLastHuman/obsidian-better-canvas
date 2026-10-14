import { requestUrl } from "obsidian";

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
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string> {
  if (!settings.apiKey.trim()) throw new Error("请先在 Better Canvas 设置中填写 API Key。");
  if (!settings.model.trim()) throw new Error("请先在 Better Canvas 设置中填写 Chat model。");

  const response = await requestUrl({
    url: endpoint(settings.baseUrl, "chat/completions"),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey.trim()}`
    },
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

export async function generateImage(
  settings: AISettings,
  prompt: string
): Promise<{ bytes: Uint8Array; extension: string }> {
  if (!settings.apiKey.trim()) throw new Error("请先在 Better Canvas 设置中填写 API Key。");
  const model = settings.imageModel.trim() || settings.model.trim();
  if (!model) throw new Error("请先在设置中填写 Image model。");

  const response = await requestUrl({
    url: endpoint(settings.baseUrl, "images/generations"),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey.trim()}`
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json"
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
