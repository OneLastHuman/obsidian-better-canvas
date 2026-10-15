import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callSseMcpTool,
  getSseMcpPrompt,
  listSseMcpPrompts,
  listSseMcpResources,
  listSseMcpTools,
  readSseMcpResource,
  resolveSsePostUrl,
  SseMcpConnection,
  splitSseFrames
} from "./mcp-sse";

describe("legacy MCP SSE parsing", () => {
  it("parses endpoint and message events across a partial buffer", () => {
    const first = splitSseFrames(": comment\nevent: endpoint\ndata: /messages?session=abc\n\n");
    expect(first.frames).toEqual([{ event: "endpoint", data: "/messages?session=abc" }]);
    expect(first.remainder).toBe("");

    const second = splitSseFrames("id: 1\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\ndata: \"id\":\"bc-sse-1\",\"result\":{}}\n\n");
    expect(second.frames).toEqual([{
      event: "message",
      data: "{\"jsonrpc\":\"2.0\",\n\"id\":\"bc-sse-1\",\"result\":{}}"
    }]);
  });

  it("resolves relative message endpoints against the stream URL", () => {
    expect(resolveSsePostUrl("https://mcp.example/sse", "/messages?id=1"))
      .toBe("https://mcp.example/messages?id=1");
  });

  it("prevents message endpoints from redirecting bearer tokens to another origin", () => {
    expect(() => resolveSsePostUrl("https://mcp.example/sse", "https://evil.example/message"))
      .toThrow(/origin/);
    expect(() => resolveSsePostUrl("https://mcp.example/sse", "file:///tmp/message"))
      .toThrow(/HTTP/);
  });

  it("makes the connection terminal and aborts transport after an idle stream closes", async () => {
    const encoder = new TextEncoder();
    let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          eventController = controller;
          controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
        }
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fakeFetch);
    const connection = new SseMcpConnection("https://mcp.example/sse", "secret");
    try {
      await connection.connect();
      eventController?.close();

      await vi.waitFor(() => {
        expect((connection as any).closed).toBe(true);
      }, { timeout: 1000 });

      expect((connection as any).controller.signal.aborted).toBe(true);
      expect((connection as any).pending.size).toBe(0);
      await expect(connection.request("tools/list", {})).rejects.toThrow(/closed/i);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    } finally {
      connection.close();
    }
  });

});

describe("legacy MCP SSE JSON-RPC round trip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists and calls tools using SSE messages with an explicit endpoint event", async () => {
    const encoder = new TextEncoder();
    let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;

    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
            controller.enqueue(encoder.encode("event: endpoint\ndata: /messages?session=fixture\n\n"));
          }
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      expect(url).toBe("https://mcp.example/messages?session=fixture");
      const message = JSON.parse(String(init?.body ?? "{}"));
      if (message.id !== undefined) {
        let result: unknown;
        if (message.method === "initialize") {
          result = { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "sse-fixture", version: "1" } };
        } else if (message.method === "tools/list") {
          result = { tools: [{ name: "echo", description: "Echo arguments", inputSchema: { type: "object" } }] };
        } else if (message.method === "tools/call") {
          result = { content: [{ type: "text", text: JSON.stringify(message.params.arguments) }] };
        } else if (message.method === "resources/list") {
          result = message.params.cursor
            ? { resources: [{ uri: "note://second", name: "Second" }] }
            : { resources: [{ uri: "note://first", name: "First" }], nextCursor: "page-2" };
        } else if (message.method === "resources/read") {
          result = { contents: [{ uri: message.params.uri, text: "SSE resource body" }] };
        } else if (message.method === "prompts/list") {
          result = { prompts: [{ name: "outline", description: "Outline a topic", arguments: [{ name: "topic", required: true }] }] };
        } else if (message.method === "prompts/get") {
          result = { messages: [{ role: "user", content: { type: "text", text: "Outline: " + message.params.arguments.topic } }] };
        }
        eventController?.enqueue(encoder.encode("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n\n"));
      }
      return new Response(null, { status: 202 });
    });

    vi.stubGlobal("fetch", fakeFetch);
    const tools = await listSseMcpTools("https://mcp.example/sse", "secret");
    expect(tools.map(tool => tool.name)).toEqual(["echo"]);

    const result = await callSseMcpTool("https://mcp.example/sse", "secret", "echo", { text: "hello" });
    expect(result.text).toBe(JSON.stringify({ text: "hello" }));
    expect(result.images).toEqual([]);

    const resources = await listSseMcpResources("https://mcp.example/sse", "secret");
    expect(resources.map(resource => resource.uri)).toEqual(["note://first", "note://second"]);
    const resource = await readSseMcpResource("https://mcp.example/sse", "secret", "note://first");
    expect(resource.text).toContain("SSE resource body");

    const prompts = await listSseMcpPrompts("https://mcp.example/sse", "secret");
    expect(prompts[0].name).toBe("outline");
    const prompt = await getSseMcpPrompt("https://mcp.example/sse", "secret", "outline", { topic: "graphs" });
    expect(prompt.text).toContain("Outline: graphs");
  }, 30000);
});
