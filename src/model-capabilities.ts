import type { AISettings, ChatMessage } from "./ai";

export type CapabilityRequestStatus = "accepted" | "failed" | "not-run";

export interface CapabilityCheck {
  status: CapabilityRequestStatus;
  latencyMs?: number;
  detail?: string;
}

export interface ModelCapabilityReport {
  profileId: string;
  profileName: string;
  protocol: "openai" | "anthropic" | "gemini";
  model: string;
  testedAt: string;
  text: CapabilityCheck;
  imageInput: CapabilityCheck;
  note: string;
}

export type CapabilityCompleter = (
  settings: AISettings,
  messages: ChatMessage[]
) => Promise<string>;

export function modelCapabilityReportKey(
  profileId: string,
  protocol: string,
  model: string
): string {
  return [profileId.trim(), protocol.trim().toLowerCase(), model.trim()].join("::");
}

function errorDetail(error: unknown, apiKey: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 240) || "请求失败。";
}

function checked(status: CapabilityRequestStatus, startedAt: number, detail?: string): CapabilityCheck {
  return {
    status,
    latencyMs: Math.max(0, Date.now() - startedAt),
    ...(detail ? { detail } : {})
  };
}

/**
 * Explicit smoke probe for a configured profile/model. It sends one short text
 * request and, only if that succeeds, one request containing a tiny PNG data URL.
 * "accepted" means the endpoint returned usable text; it is not proof that the
 * provider actually attended to image content or supports every multimodal route.
 */
export async function probeModelCapabilities(
  profile: { id: string; name: string },
  settings: AISettings,
  complete: CapabilityCompleter,
  now: () => Date = () => new Date()
): Promise<ModelCapabilityReport> {
  const protocol = settings.protocol === "anthropic" || settings.protocol === "gemini"
    ? settings.protocol
    : "openai";
  const report: ModelCapabilityReport = {
    profileId: profile.id,
    profileName: profile.name,
    protocol,
    model: settings.model.trim(),
    testedAt: now().toISOString(),
    text: { status: "not-run" },
    imageInput: { status: "not-run" },
    note: "探测仅验证文本请求与图片输入请求是否返回可用文本；不会验证图片生成、PDF、视频/YouTube、URL context 或 search grounding。"
  };
  const apiSettings: AISettings = { ...settings, protocol, backend: "api" };

  const textMessages: ChatMessage[] = [
    {
      role: "system",
      content: "This is a capability smoke test. Respond with a short plain-text acknowledgement."
    },
    {
      role: "user",
      content: "Reply with exactly: BC_TEXT_PROBE_OK"
    }
  ];
  const textStart = Date.now();
  try {
    const output = await complete(apiSettings, textMessages);
    if (typeof output !== "string" || !output.trim()) {
      report.text = checked("failed", textStart, "接口返回成功，但没有可用文本输出。");
      return report;
    }
    report.text = checked("accepted", textStart, "文本请求返回了可用内容。");
  } catch (error) {
    report.text = checked("failed", textStart, errorDetail(error, settings.apiKey));
    return report;
  }

  // A transparent 1x1 PNG: deliberately tiny to minimize payload and cost.
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==";
  const visionMessages: ChatMessage[] = [
    {
      role: "system",
      content: "This is an image-input compatibility smoke test. Do not infer any information not visible in the supplied image."
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect this tiny test image and respond with a brief acknowledgement that an image input was received." },
        { type: "image_url", image_url: { url: tinyPng, detail: "low" } }
      ]
    }
  ];
  const visionStart = Date.now();
  try {
    const output = await complete(apiSettings, visionMessages);
    if (typeof output !== "string" || !output.trim()) {
      report.imageInput = checked("failed", visionStart, "图片输入请求返回成功，但没有可用文本输出。");
    } else {
      report.imageInput = checked(
        "accepted",
        visionStart,
        "含图片的请求返回了文本；这不能证明模型确实读取了图片内容。"
      );
    }
  } catch (error) {
    report.imageInput = checked("failed", visionStart, errorDetail(error, settings.apiKey));
  }
  return report;
}
