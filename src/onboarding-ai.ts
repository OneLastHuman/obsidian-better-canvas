import type { AISettings } from "./ai";
import { isChinese, t } from "./i18n";

export type OnboardingAIBackend = "api" | "opencode-acp" | "codex-cli";

export type OnboardingAISettings = Partial<Pick<AISettings,
  "backend" | "baseUrl" | "apiKey" | "model" | "codexBinaryPath" | "opencodeBinaryPath"
>>;

export type AIStatusState = "ready" | "missing" | "unknown";

export interface AIStatusIssue {
  field: "baseUrl" | "model" | "apiKey" | "binaryPath" | "backend";
  label: string;
}

export interface AIStatus {
  state: AIStatusState;
  backend: OnboardingAIBackend;
  backendLabel: string;
  summary: string;
  detail: string;
  issues: AIStatusIssue[];
  allowsEmptyApiKey: boolean;
  settingsSection: "ai";
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLocaleLowerCase();
  } catch {
    return "";
  }
}

export function isLocalAPIHost(hostname: string): boolean {
  const host = hostname.trim().toLocaleLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "host.docker.internal" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    /^10(?:\.\d{1,3}){3}$/.test(host) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host) ||
    host.endsWith(".local");
}

export function allowsEmptyAPIKey(baseUrl: string): boolean {
  return isLocalAPIHost(hostOf(baseUrl));
}

export function backendLabel(backend: OnboardingAIBackend): string {
  if (backend === "codex-cli") return "Codex CLI";
  if (backend === "opencode-acp") return "OpenCode ACP";
  return t("Model service API", "模型服务 API");
}

export function resolveAIStatus(settings: OnboardingAISettings): AIStatus {
  const backend: OnboardingAIBackend = settings.backend === "codex-cli" || settings.backend === "opencode-acp"
    ? settings.backend
    : "api";
  const label = backendLabel(backend);

  if (backend === "codex-cli" || backend === "opencode-acp") {
    return {
      state: "unknown",
      backend,
      backendLabel: label,
      summary: t("Using local configuration, not verified", "使用本机配置，尚未验证"),
      detail: backend === "codex-cli"
        ? t("Codex CLI will be called. With an empty binary path the system command is used; if it is not found, common install locations such as Homebrew, npm, and Bun are searched. The plugin did not check installation, login, or model availability.",
          "将调用 Codex CLI；程序路径留空时使用系统命令，找不到时自动搜索 Homebrew、npm、Bun 等常见安装目录。插件未检查安装、登录或模型可用性。")
        : t("OpenCode ACP will be called. With an empty binary path the system command is used; if it is not found, common install locations such as Homebrew, npm, and Bun are searched. The plugin did not check installation, login, or model availability.",
          "将调用 OpenCode ACP；程序路径留空时使用系统命令，找不到时自动搜索 Homebrew、npm、Bun 等常见安装目录。插件未检查安装、登录或模型可用性。"),
      issues: [],
      allowsEmptyApiKey: true,
      settingsSection: "ai"
    };
  }

  const baseUrl = String(settings.baseUrl || "").trim();
  const model = String(settings.model || "").trim();
  const apiKey = String(settings.apiKey || "").trim();
  const local = allowsEmptyAPIKey(baseUrl);
  const issues: AIStatusIssue[] = [];

  if (!baseUrl) issues.push({ field: "baseUrl", label: t("Server URL", "服务地址") });
  else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") issues.push({ field: "baseUrl", label: t("Valid server URL", "有效的服务地址") });
    } catch {
      issues.push({ field: "baseUrl", label: t("Valid server URL", "有效的服务地址") });
    }
  }
  if (!model) issues.push({ field: "model", label: t("Model", "模型") });
  if (!apiKey && !local) issues.push({ field: "apiKey", label: t("API key", "API 密钥") });

  if (issues.length) {
    const missing = issues.map(issue => issue.label).join(isChinese() ? "、" : ", ");
    return {
      state: "missing",
      backend,
      backendLabel: label,
      summary: t("The current backend is missing required settings", "当前后端缺少必需配置"),
      detail: t(`Missing: ${missing}. Fill them in to send.`, `缺少${missing}。补齐后可以发送。`),
      issues,
      allowsEmptyApiKey: local,
      settingsSection: "ai"
    };
  }

  return {
    state: "ready",
    backend,
    backendLabel: label,
    summary: t("Local configuration complete", "本地配置齐全"),
    detail: local
      ? t("Using a local service, so the API key may be empty. The plugin did not probe the connection or model availability.",
        "使用本地服务，API 密钥可以为空。插件未探测连接或模型可用性。")
      : t("The plugin only checks local configuration; it does not probe the connection or model availability.",
        "插件只检查本地配置，未自动探测连接或模型可用性。"),
    issues: [],
    allowsEmptyApiKey: local,
    settingsSection: "ai"
  };
}
