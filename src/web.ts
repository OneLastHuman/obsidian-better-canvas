import { requestUrl } from "obsidian";

export interface RetrievedPage {
  url: string;
  title: string;
  text: string;
  kind: "webpage" | "youtube";
}

function validatePublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入完整的网页 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 http 和 https URL。");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host === "0.0.0.0" || host === "::1" || host === "[::1]" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("为避免意外访问本机或内网地址，不处理 localhost、私有 IP 或 .local 域名。");
  }
  return url;
}

function htmlToText(html: string): { title: string; text: string } {
  if (typeof DOMParser === "undefined") {
    const clean = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ")
      .trim();
    return { title: "", text: clean.slice(0, 30000) };
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("meta[property='og:title']")?.getAttribute("content")
    ?? doc.querySelector("title")?.textContent?.trim()
    ?? doc.querySelector("h1")?.textContent?.trim()
    ?? "";
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,iframe,form,aside").forEach(el => el.remove());
  const candidates = doc.querySelector("article, main, [role='main']") ?? doc.body;
  const text = (candidates?.innerText ?? candidates?.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
  return { title: title.slice(0, 300), text: text.slice(0, 30000) };
}

export function isYouTubeUrl(url: URL): boolean {
  return url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com") ||
    url.hostname === "youtu.be" || url.hostname.endsWith(".youtu.be");
}

export function getYouTubeVideoId(url: URL): string | null {
  if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
  return match?.[1] ?? null;
}

async function fetchText(url: string): Promise<string> {
  const response = await requestUrl({ url, method: "GET", throw: false, headers: { "User-Agent": "Mozilla/5.0 BetterCanvas/0.1" } });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("网页读取失败（HTTP " + response.status + "）。部分网站会阻止插件读取内容。");
  }
  return response.text;
}

function decodeTranscript(xml: string): string {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    return Array.from(doc.querySelectorAll("text, p"))
      .map(el => (el.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

export async function retrieveWebpage(rawUrl: string): Promise<RetrievedPage> {
  const url = validatePublicHttpUrl(rawUrl);
  const source = await fetchText(url.toString());
  const extracted = htmlToText(source);
  if (!extracted.text) throw new Error("网页没有可提取的正文文本。");
  return { url: url.toString(), title: extracted.title || url.hostname, text: extracted.text, kind: "webpage" };
}

export async function retrieveYouTubeTranscript(rawUrl: string, language = "en"): Promise<RetrievedPage> {
  const url = validatePublicHttpUrl(rawUrl);
  if (!isYouTubeUrl(url)) throw new Error("URL 不是 YouTube 视频链接。");
  const videoId = getYouTubeVideoId(url);
  if (!videoId) throw new Error("无法从 YouTube URL 解析视频 ID。");

  let title = "YouTube " + videoId;
  try {
    const oembed = await fetchText("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url.toString()));
    const parsed = JSON.parse(oembed);
    if (typeof parsed.title === "string") title = parsed.title;
  } catch {
    // The transcript can still be used if oEmbed is blocked.
  }

  const langs = [...new Set([language.trim() || "en", "en"])];
  let transcript = "";
  for (const lang of langs) {
    const urls = [
      "https://www.youtube.com/api/timedtext?v=" + encodeURIComponent(videoId) + "&lang=" + encodeURIComponent(lang) + "&fmt=srv3",
      "https://www.youtube.com/api/timedtext?v=" + encodeURIComponent(videoId) + "&lang=" + encodeURIComponent(lang) + "&kind=asr&fmt=srv3"
    ];
    for (const endpoint of urls) {
      try {
        const xml = await fetchText(endpoint);
        transcript = decodeTranscript(xml);
        if (transcript.length > 20) break;
      } catch {
        // Try the next available captions variant.
      }
    }
    if (transcript.length > 20) break;
  }
  if (transcript.length <= 20) {
    throw new Error("没有读取到可用的公开视频字幕。该视频可能禁用了字幕、要求登录，或 YouTube 已更改字幕接口。");
  }
  return { url: url.toString(), title, text: transcript.slice(0, 30000), kind: "youtube" };
}
