import { describe, expect, it } from "vitest";
import { parseLocalMcpConfig } from "./mcp-stdio";

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
