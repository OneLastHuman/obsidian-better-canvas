import { describe, expect, it } from "vitest";
import process from "node:process";
import {
  callLocalMcpTool,
  getLocalMcpPrompt,
  listLocalMcpPrompts,
  listLocalMcpResources,
  listLocalMcpTools,
  parseLocalMcpConfig,
  readLocalMcpResource
} from "./mcp-stdio";

const serverSource = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { process.exit(2); }
  if (!message || !message.id) return;
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: "2025-03-26", capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "fixture", version: "1" } };
  } else if (message.method === "tools/list") {
    result = { tools: [{ name: "echo", description: "Returns its arguments", inputSchema: { type: "object" } }] };
  } else if (message.method === "tools/call") {
    result = { content: [{ type: "text", text: JSON.stringify(message.params.arguments) }] };
  } else if (message.method === "resources/list") {
    result = message.params.cursor
      ? { resources: [{ uri: "note://second", name: "Second" }] }
      : { resources: [{ uri: "note://first", name: "First", mimeType: "text/plain" }], nextCursor: "page-2" };
  } else if (message.method === "resources/read") {
    result = { contents: [{ uri: message.params.uri, mimeType: "text/plain", text: "resource contents" }] };
  } else if (message.method === "prompts/list") {
    result = { prompts: [{ name: "review", description: "Review a topic", arguments: [{ name: "topic", required: true }] }] };
  } else if (message.method === "prompts/get") {
    result = { description: "Generated prompt", messages: [{ role: "user", content: { type: "text", text: "Topic: " + message.params.arguments.topic } }] };
  } else {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }));
    return;
  }
  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});
`;

function fixtureConfig(): string {
  return JSON.stringify({ command: process.execPath, args: ["-e", serverSource] });
}


describe("local MCP stdio config validation", () => {
  it("accepts a command with args, cwd, and environment", () => {
    expect(parseLocalMcpConfig(JSON.stringify({
      command: "node",
      args: ["server.js", "--safe"],
      cwd: "/tmp/mcp",
      env: { API_KEY: "example" }
    }))).toEqual({
      command: "node",
      args: ["server.js", "--safe"],
      cwd: "/tmp/mcp",
      env: { API_KEY: "example" }
    });
  });

  it("rejects invalid JSON, empty commands, and shell-like argument strings that are not arrays", () => {
    expect(() => parseLocalMcpConfig("{")).toThrow(/JSON/);
    expect(() => parseLocalMcpConfig(JSON.stringify({ command: " " }))).toThrow(/command/);
    expect(() => parseLocalMcpConfig(JSON.stringify({ command: "node", args: "server.js && rm" }))).toThrow(/args/);
  });

  it("rejects non-string environment values and unsafe variable names", () => {
    expect(() => parseLocalMcpConfig(JSON.stringify({
      command: "node",
      env: { "BAD-KEY": "x" }
    }))).toThrow(/env/);
    expect(() => parseLocalMcpConfig(JSON.stringify({
      command: "node",
      env: { API_KEY: 7 }
    }))).toThrow(/env/);
  });

  it("limits oversized configurations", () => {
    expect(() => parseLocalMcpConfig(JSON.stringify({ command: "node", args: ["x".repeat(30001)] })))
      .toThrow(/过长|args/);
  });
});

describe("local MCP stdio JSON-RPC round trip", () => {
  it("lists tools from a child process without a shell wrapper", async () => {
    const tools = await listLocalMcpTools(fixtureConfig());
    expect(tools).toEqual([{
      name: "echo",
      description: "Returns its arguments",
      inputSchema: { type: "object" }
    }]);
  }, 15000);

  it("executes a tool and normalizes the returned text content", async () => {
    const result = await callLocalMcpTool(fixtureConfig(), "echo", { value: "safe" });
    expect(result.text).toBe(JSON.stringify({ value: "safe" }));
    expect(result.images).toEqual([]);
  }, 15000);

  it("lists resources across pagination pages and reads a resource", async () => {
    const resources = await listLocalMcpResources(fixtureConfig());
    expect(resources.map(resource => resource.uri)).toEqual(["note://first", "note://second"]);
    const result = await readLocalMcpResource(fixtureConfig(), "note://first");
    expect(result.text).toContain("resource contents");
    expect(result.text).toContain("note://first");
  }, 20000);

  it("lists MCP prompts and resolves a named prompt with arguments", async () => {
    const prompts = await listLocalMcpPrompts(fixtureConfig());
    expect(prompts).toEqual([{
      name: "review",
      description: "Review a topic",
      arguments: [{ name: "topic", required: true }]
    }]);
    const result = await getLocalMcpPrompt(fixtureConfig(), "review", { topic: "science" });
    expect(result.text).toContain("[user] Topic: science");
  }, 20000);
});
