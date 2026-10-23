import { describe, expect, it } from "vitest";
import { allowsEmptyAPIKey, isLocalAPIHost, resolveAIStatus } from "./onboarding-ai";

describe("AI onboarding status", () => {
  it("reports an empty key for a remote API", () => {
    const status = resolveAIStatus({
      backend: "api", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "test-model"
    });
    expect(status.state).toBe("missing");
    expect(status.issues.map(issue => issue.field)).toEqual(["apiKey"]);
    expect(status.allowsEmptyApiKey).toBe(false);
  });

  it("accepts a local API with an empty key without claiming it is connected", () => {
    const status = resolveAIStatus({
      backend: "api", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "local-model"
    });
    expect(status.state).toBe("ready");
    expect(status.allowsEmptyApiKey).toBe(true);
    expect(status.detail).toContain("未探测");
  });

  it("recognizes private and loopback hosts but not a public host", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.1.20", "172.20.0.2"]) {
      expect(isLocalAPIHost(host)).toBe(true);
    }
    expect(isLocalAPIHost("localhost.example.com")).toBe(false);
    expect(allowsEmptyAPIKey("https://example.com/v1")).toBe(false);
    expect(allowsEmptyAPIKey("http://[::1]:11434/v1")).toBe(true);
  });

  it("reports missing URL and model separately", () => {
    const status = resolveAIStatus({ backend: "api", baseUrl: "", apiKey: "test-key", model: "" });
    expect(status.state).toBe("missing");
    expect(status.issues.map(issue => issue.field)).toEqual(["baseUrl", "model"]);
  });

  it.each(["file:///tmp/api", "not-a-url", "ftp://localhost/model"])("rejects an invalid API address: %s", baseUrl => {
    const status = resolveAIStatus({ baseUrl, apiKey: "test-key", model: "test-model" });
    expect(status.state).toBe("missing");
    expect(status.issues.map(issue => issue.field)).toContain("baseUrl");
  });

  it.each(["codex-cli", "opencode-acp"] as const)("does not block %s on API fields or claim installation was checked", backend => {
    const status = resolveAIStatus({ backend });
    expect(status.state).toBe("unknown");
    expect(status.issues).toEqual([]);
    expect(status.detail).toContain("程序路径留空时使用系统命令");
    expect(status.detail).toContain("未检查安装");
  });
});
