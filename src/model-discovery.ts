import { requestUrl } from "obsidian";
import type { AIProtocol, AISettings } from "./ai";

function baseUrl(value: string): string {
  const base = value.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先在设置中配置 AI API Base URL。");
  return base;
}

function modelsUrl(settings: AISettings): string {
  const base = baseUrl(settings.baseUrl);
  if (settings.protocol === "gemini") {
    // A profile may store either the API root or a concrete model action URL.
    const actionless = base.replace(/\/models\/[^/:]+:(?:generateContent|streamGenerateContent)$/, "");
    return /\/models$/i.test(actionless) ? actionless : actionless + "/models";
  }
  return /\/models$/i.test(base) ? base : base + "/models";
}

export { normalizeModelNames } from "./model-list";
import { normalizeModelNames } from "./model-list";

/** Discover models from an OpenAI-compatible, Anthropic, or Gemini model endpoint. */
export async function discoverModels(settings: AISettings): Promise<string[]> {
  const protocol: AIProtocol = settings.protocol === "anthropic" || settings.protocol === "gemini"
    ? settings.protocol
    : "openai";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (settings.apiKey.trim()) {
    if (protocol === "anthropic") headers["x-api-key"] = settings.apiKey.trim();
    else if (protocol === "gemini") headers["x-goog-api-key"] = settings.apiKey.trim();
    else headers.Authorization = "Bearer " + settings.apiKey.trim();
  }
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";

  const response = await requestUrl({
    url: modelsUrl({ ...settings, protocol }),
    method: "GET",
    headers,
    throw: false
  });

  let body: any = response.json;
  if (!body || typeof body !== "object") {
    try { body = JSON.parse(String(response.text ?? "")); }
    catch { body = { message: response.text }; }
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = body?.error?.message ?? body?.message ?? response.text;
    throw new Error("获取模型列表失败（HTTP " + response.status + "）" +
      (detail ? "：" + String(detail).slice(0, 500) : ""));
  }

  const models = normalizeModelNames(protocol, body);
  if (!models.length) {
    throw new Error("供应商返回成功，但没有可识别的模型 ID。请检查 API 权限，或手动输入模型名称。");
  }
  return models;
}
