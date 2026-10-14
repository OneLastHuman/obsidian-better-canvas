import { requestUrl } from "obsidian";
import { normalizeMcpToolResult, RemoteMcpResult } from "./mcp-result";
export { normalizeMcpToolResult } from "./mcp-result";
export type { RemoteMcpImage, RemoteMcpResult } from "./mcp-result";

export interface RemoteMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function parseResponse(response: any): any {
  if (response?.json && typeof response.json === "object") return response.json;
  const body = String(response?.text ?? "");
  try {
    return JSON.parse(body);
  } catch {
    const dataLine = body.split("\n").find(line => line.startsWith("data:"));
    if (dataLine) {
      try { return JSON.parse(dataLine.slice(5).trim()); } catch { /* continue */ }
    }
  }
  return body;
}

async function rpc(
  endpoint: string,
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<{ body: any; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (apiKey.trim()) headers.Authorization = "Bearer " + apiKey.trim();
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await requestUrl({
    url: endpoint.trim(),
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "better-canvas-" + Math.random().toString(16).slice(2),
      method,
      params
    }),
    throw: false
  });
  const body = parseResponse(response);
  if (response.status < 200 || response.status >= 300) {
    const detail = body?.error?.message ?? body?.message ?? response.text;
    throw new Error("MCP 请求失败（HTTP " + response.status + "）" + (detail ? ": " + detail : ""));
  }
  if (body?.error) throw new Error("MCP 错误: " + (body.error.message ?? JSON.stringify(body.error)));
  return { body: body?.result ?? body, sessionId: response.headers?.["mcp-session-id"] ?? sessionId };
}

async function initialize(endpoint: string, apiKey: string): Promise<{ sessionId?: string }> {
  const init = await rpc(endpoint, apiKey, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "obsidian-better-canvas", version: "0.1.0" }
  });
  await rpc(endpoint, apiKey, "notifications/initialized", {}, init.sessionId);
  return { sessionId: init.sessionId };
}

export async function listRemoteTools(endpoint: string, apiKey: string): Promise<RemoteMcpTool[]> {
  if (!endpoint.trim()) throw new Error("请先在设置中填写 MCP Streamable HTTP endpoint。");
  const init = await initialize(endpoint, apiKey);
  const result = await rpc(endpoint, apiKey, "tools/list", {}, init.sessionId);
  const tools = result.body?.tools;
  if (!Array.isArray(tools)) throw new Error("MCP 服务没有返回 tools 数组。");
  return tools.filter((tool: any) => typeof tool?.name === "string").map((tool: any) => ({
    name: tool.name,
    description: typeof tool.description === "string" ? tool.description : "",
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {}
  }));
}

export async function callRemoteTool(
  endpoint: string,
  apiKey: string,
  name: string,
  args: Record<string, unknown>
): Promise<RemoteMcpResult> {
  if (!endpoint.trim()) throw new Error("请先在设置中填写 MCP Streamable HTTP endpoint。");
  if (!name.trim()) throw new Error("MCP tool 名称不能为空。");
  const init = await initialize(endpoint, apiKey);
  const result = await rpc(endpoint, apiKey, "tools/call", {
    name: name.trim(),
    arguments: args
  }, init.sessionId);
  const value = result.body;
  if (value?.isError) throw new Error("MCP 工具执行失败: " + JSON.stringify(value.content ?? value));
  return normalizeMcpToolResult(value);
}
