import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import {
  getRemotePrompt,
  listRemotePrompts,
  listRemoteResources,
  readRemoteResource
} from "./mcp";

vi.mock("obsidian", () => ({ requestUrl: vi.fn() }));

const mockedRequestUrl = vi.mocked(requestUrl);

function response(result: unknown, status = 200): any {
  const envelope = { jsonrpc: "2.0", id: "fixture", result };
  return {
    status,
    json: status === 202 ? undefined : envelope,
    text: status === 202 ? "" : JSON.stringify(envelope),
    headers: { "mcp-session-id": "fixture-session" }
  };
}

describe("MCP Streamable HTTP resources and prompts", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("lists paginated resources and prompts, reads resources, and resolves prompts", async () => {
    const methods: Array<{ method: string; params: Record<string, unknown>; id?: unknown }> = [];
    (mockedRequestUrl as any).mockImplementation(async (request: any) => {
      const body = JSON.parse(String(request.body));
      methods.push({ method: body.method, params: body.params ?? {}, id: body.id });
      if (body.method === "initialize") {
        return response({ protocolVersion: "2025-03-26", capabilities: { resources: {}, prompts: {} } });
      }
      if (body.method === "notifications/initialized") return response(undefined, 202);
      if (body.method === "resources/list") {
        return response(body.params.cursor
          ? { resources: [{ uri: "note://second", name: "Second" }] }
          : { resources: [{ uri: "note://first", name: "First" }], nextCursor: "page-2" });
      }
      if (body.method === "resources/read") {
        return response({ contents: [{ uri: body.params.uri, mimeType: "text/plain", text: "remote body" }] });
      }
      if (body.method === "prompts/list") {
        return response({ prompts: [{ name: "outline", arguments: [{ name: "topic", required: true }] }] });
      }
      if (body.method === "prompts/get") {
        return response({ description: "outline prompt", messages: [{ role: "user", content: { type: "text", text: "Topic: " + body.params.arguments.topic } }] });
      }
      throw new Error("Unexpected MCP method: " + body.method);
    });

    const resources = await listRemoteResources("https://mcp.example/mcp", "secret");
    expect(resources.map(resource => resource.uri)).toEqual(["note://first", "note://second"]);
    expect(methods.filter(item => item.method === "resources/list").map(item => item.params.cursor))
      .toEqual([undefined, "page-2"]);

    const read = await readRemoteResource("https://mcp.example/mcp", "secret", "note://first");
    expect(read.text).toContain("remote body");

    const prompts = await listRemotePrompts("https://mcp.example/mcp", "secret");
    expect(prompts[0].name).toBe("outline");
    const prompt = await getRemotePrompt("https://mcp.example/mcp", "secret", "outline", { topic: "graphs" });
    expect(prompt.text).toContain("Topic: graphs");

    expect(methods.filter(item => item.method === "notifications/initialized").every(item => item.id === undefined)).toBe(true);
    expect(methods.every(item => item.method === "notifications/initialized" || item.id !== undefined)).toBe(true);
  });

  it("surfaces HTTP failures from resource operations", async () => {
    (mockedRequestUrl as any).mockImplementation(async (request: any) => {
      const body = JSON.parse(String(request.body));
      if (body.method === "initialize") return response({ protocolVersion: "2025-03-26" });
      if (body.method === "notifications/initialized") return response(undefined, 202);
      return {
        status: 503,
        text: "service unavailable",
        json: { error: { message: "maintenance" } },
        headers: {}
      };
    });
    await expect(listRemoteResources("https://mcp.example/mcp", "secret")).rejects.toThrow(/HTTP 503/);
  });
});
