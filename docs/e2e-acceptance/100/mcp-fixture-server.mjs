#!/usr/bin/env node
// Newline-delimited JSON-RPC MCP fixture used for Better Canvas issue #100 acceptance runs.
// It records every request to a log file so the run leaves on-disk evidence.
import { appendFileSync } from "node:fs";

const LOG = process.env.BC_FIXTURE_LOG ?? "./mcp-fixture-server.log";
const tools = [{
  name: "echo",
  description: "回显参数，用于 Better Canvas 验收",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
}];

function log(entry) {
  try {
    appendFileSync(LOG, JSON.stringify(entry) + "\n");
  } catch {
    // Logging must never break the protocol stream.
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log({ direction: "in", unparsed: line });
    return;
  }
  log({ direction: "in", method: message.method, id: message.id, params: message.params });
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "bc-fixture", version: "1.0.0" }
      });
      return;
    case "notifications/initialized":
      return;
    case "tools/list":
      reply(message.id, { tools });
      return;
    case "tools/call": {
      const args = message.params?.arguments ?? {};
      reply(message.id, { content: [{ type: "text", text: "echo 收到参数：" + JSON.stringify(args) }] });
      return;
    }
    case "resources/list":
      reply(message.id, { resources: [] });
      return;
    case "prompts/list":
      reply(message.id, { prompts: [] });
      return;
    default:
      reply(message.id, {});
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) handle(trimmed);
  }
});
