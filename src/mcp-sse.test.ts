import { describe, expect, it } from "vitest";
import { resolveSsePostUrl, splitSseFrames } from "./mcp-sse";

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
});
