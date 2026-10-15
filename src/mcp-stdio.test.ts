import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import {
  callLocalMcpTool,
  closeAllLocalMcpSessions,
  getLocalMcpPrompt,
  listLocalMcpPrompts,
  listLocalMcpResources,
  listLocalMcpTools,
  parseLocalMcpConfig,
  readLocalMcpResource
} from "./mcp-stdio";

const serverSource = String.raw`
if(process.env.MCP_START_LOG)require("node:fs").appendFileSync(process.env.MCP_START_LOG,String(process.pid)+"\\n");
const rl=require("node:readline").createInterface({input:process.stdin});
rl.on("line",line=>{
 let m;try{m=JSON.parse(line)}catch{process.exit(2)}
 if(!m||!m.id)return;
 const q=m.params||{};let result;
 switch(m.method){
 case "initialize":result={protocolVersion:"2025-03-26"};break;
 case "tools/list":result={tools:[{name:"echo",description:"Returns its arguments",inputSchema:{type:"object"}}]};break;
 case "tools/call":result={content:[{type:"text",text:JSON.stringify(q.arguments)}]};break;
 case "resources/list":
 if(process.env.MCP_TOO_MANY_RESOURCES==="1")result={resources:Array.from({length:1001},(_,i)=>({uri:"note://bulk-"+i,name:"Bulk "+i}))};
 else if(process.env.MCP_TOO_MANY_SECOND_PAGE==="1"&&q.cursor)result={resources:Array.from({length:1000},(_,i)=>({uri:"note://second-"+i,name:"Second "+i}))};
 else result=q.cursor?{resources:[{uri:"note://second",name:"Second"},{uri:"note://shared",name:"Duplicate"},{uri:"note://third",name:"Third"}]}:{resources:[{uri:"note://first",name:"First",mimeType:"text/plain"},{uri:"note://shared",name:"Shared"}],nextCursor:"page-2"};
 break;
 case "resources/read":result={contents:[{uri:q.uri,mimeType:"text/plain",text:"resource contents pid:"+process.pid}]};break;
 case "prompts/list":result={prompts:[{name:"review",description:"Review a topic",arguments:[{name:"topic",required:true}]}]};break;
 case "prompts/get":result={description:"Generated prompt",messages:[{role:"user",content:{type:"text",text:"Topic: "+q.arguments.topic+" pid:"+process.pid}}]};break;
 default:result={};
 }
 console.log(JSON.stringify({jsonrpc:"2.0",id:m.id,result}));
});
`;

function fixtureConfig(env: Record<string, string> = {}): string {
  return JSON.stringify({ command: process.execPath, args: ["-e", serverSource], env });
}

afterAll(() => {
  closeAllLocalMcpSessions();
});


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
    expect(resources.map(resource => resource.uri)).toEqual([
      "note://first", "note://shared", "note://second", "note://third"
    ]);
    const result = await readLocalMcpResource(fixtureConfig(), "note://first");
    expect(result.text).toContain("resource contents");
    expect(result.text).toContain("note://first");
  }, 20000);

  it("rejects local stdio catalogs above the 1000-entry limit on the first page", async () => {
    await expect(listLocalMcpResources(fixtureConfig({ MCP_TOO_MANY_RESOURCES: "1" })))
      .rejects.toThrow(/1000-entry safety limit/);
  }, 20000);

  it("rejects local stdio catalogs above the 1000-entry limit across pages", async () => {
    await expect(listLocalMcpResources(fixtureConfig({ MCP_TOO_MANY_SECOND_PAGE: "1" })))
      .rejects.toThrow(/1000-entry safety limit/);
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

  it("launches a fresh child after the cached sessions are explicitly closed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "better-canvas-mcp-session-"));
    const startLog = join(directory, "starts.log");
    const config = fixtureConfig({ MCP_START_LOG: startLog });
    try {
      const first = await readLocalMcpResource(config, "note://first");
      expect(first.text).toContain("resource contents");

      closeAllLocalMcpSessions();

      const second = await getLocalMcpPrompt(config, "review", { topic: "fresh-session" });
      expect(second.text).toContain("Topic: fresh-session");
      const processIds = (await readFile(startLog, "utf8")).trim().split(/\r?\n/);
      expect(processIds).toHaveLength(2);
      expect(processIds[0]).not.toBe(processIds[1]);
    } finally {
      closeAllLocalMcpSessions();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);

  it("reuses the same child process for subsequent operations", async () => {
    const config = fixtureConfig();
    const resource = await readLocalMcpResource(config, "note://first");
    const prompt = await getLocalMcpPrompt(config, "review", { topic: "reuse" });
    const resourcePid = resource.text.match(/pid:(\d+)/)?.[1];
    const promptPid = prompt.text.match(/pid:(\d+)/)?.[1];
    expect(resourcePid).toBeTruthy();
    expect(promptPid).toBe(resourcePid);
  }, 20000);
});
