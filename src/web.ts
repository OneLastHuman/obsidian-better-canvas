import { requestUrl } from "obsidian";
import { validatePublicHttpUrl } from "./public-url";

export interface RetrievedPage {
  url: string;
  title: string;
  text: string;
  kind: "webpage";
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
  const text = ((candidates as HTMLElement | null)?.innerText ?? candidates?.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
  return { title: title.slice(0, 300), text: text.slice(0, 30000) };
}

async function fetchText(url: string): Promise<string> {
  const response = await requestUrl({ url, method: "GET", throw: false, headers: { "User-Agent": "Mozilla/5.0 BetterCanvas/0.1" } });
  if (response.status < 200 || response.status >= 300) {
    throw new Error("网页读取失败（HTTP " + response.status + "）。部分网站会阻止插件读取内容。");
  }
  return response.text;
}

export async function retrieveWebpage(rawUrl: string): Promise<RetrievedPage> {
  const url = validatePublicHttpUrl(rawUrl);
  const source = await fetchText(url.toString());
  const extracted = htmlToText(source);
  if (!extracted.text) throw new Error("网页没有可提取的正文文本。");
  return { url: url.toString(), title: extracted.title || url.hostname, text: extracted.text, kind: "webpage" };
}
