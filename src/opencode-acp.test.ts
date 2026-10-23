import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildACPUserPrompt,
  hasUnsupportedACPContent,
  listOpenCodeModels,
  runOpenCodeACP,
  textFromACPUpdate
} from "./opencode-acp";
import { loadNodeRuntimeModules } from "./node-runtime";

vi.mock("./node-runtime", () => ({
  loadNodeRuntimeModules: vi.fn()
}));

interface WireMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

class FakeACPChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin: Writable;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed: string[] = [];
  messages: WireMessage[] = [];
  ignoreKill = false;
  onRequest: (message: WireMessage) => void = () => {};
  private waiters = new Map<string, Array<(message: WireMessage) => void>>();

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        const message = JSON.parse(chunk.toString()) as WireMessage;
        this.messages.push(message);
        queueMicrotask(() => this.onRequest(message));
        for (const resolve of this.waiters.get(message.method ?? "") ?? []) resolve(message);
        this.waiters.delete(message.method ?? "");
        callback();
      }
    });
  }

  nextRequest(method: string): Promise<WireMessage> {
    const existing = this.messages.find(message => message.method === method);
    if (existing) return Promise.resolve(existing);
    return new Promise(resolve => {
      this.waiters.set(method, [...this.waiters.get(method) ?? [], resolve]);
    });
  }

  reply(request: WireMessage, result: unknown): void {
    this.send({ jsonrpc: "2.0", id: request.id, result });
  }

  send(message: WireMessage): void {
    this.stdout.write(JSON.stringify(message) + "\n");
  }

  close(code = 0, signal: string | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }

  kill(signal: string): boolean {
    this.killed.push(signal);
    if (!this.ignoreKill) queueMicrotask(() => this.close(0, signal));
    return true;
  }
}

const spawn = vi.fn();
const runtime = {
  childProcess: { spawn },
  os: { tmpdir: () => "/tmp/acp-test" },
  process: { platform: "linux" }
};
const deletableSessionInitialization = {
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: { delete: {} } }
};
const legacySession = {
  sessionId: "session-1",
  models: {
    currentModelId: "provider/default",
    availableModels: [
      { modelId: "provider/default", name: "Default" },
      { modelId: "provider/selected", name: "Selected" }
    ]
  }
};
const configuredSession = {
  sessionId: "session-1",
  configOptions: [{
    id: "model-selector",
    category: "model",
    type: "select",
    currentValue: "provider/default",
    options: [
      { value: "provider/default", name: "Default" },
      { value: "provider/selected", name: "Selected" }
    ]
  }]
};

function prepareAgent(
  session: Record<string, any> = legacySession,
  overrides: Record<string, (request: WireMessage, child: FakeACPChild) => void> = {}
): FakeACPChild {
  const child = new FakeACPChild();
  spawn.mockReturnValue(child);
  child.onRequest = request => {
    if (!request.method || request.id === undefined) return;
    if (overrides[request.method]) {
      overrides[request.method](request, child);
      return;
    }
    switch (request.method) {
      case "initialize":
        child.reply(request, { protocolVersion: 1 });
        break;
      case "session/new":
        child.reply(request, session);
        break;
      case "session/set_model":
      case "session/delete":
        child.reply(request, {});
        break;
      case "session/set_config_option":
        child.reply(request, {
          configOptions: session.configOptions.map((option: any) => ({
            ...option,
            currentValue: option.id === request.params.configId ? request.params.value : option.currentValue
          }))
        });
        break;
      case "session/prompt":
        child.send({
          method: "session/update",
          params: {
            sessionId: session.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Answer" } }
          }
        });
        child.reply(request, { stopReason: "end_turn" });
        break;
    }
  };
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadNodeRuntimeModules).mockResolvedValue(runtime);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildACPUserPrompt", () => {
  it("preserves system, user, and assistant boundaries", () => {
    expect(buildACPUserPrompt([
      { role: "system", content: "Be concise." },
      { role: "user", content: "What is in these notes?" },
      { role: "assistant", content: "Previous answer." }
    ])).toBe(
      "[System instructions]\nBe concise.\n\n[User]\nWhat is in these notes?\n\n[Previous assistant response]\nPrevious answer."
    );
  });

  it("ignores empty content blocks", () => {
    expect(buildACPUserPrompt([
      { role: "system", content: "" },
      { role: "user", content: "   " },
      { role: "user", content: "Hello" }
    ])).toBe("[User]\nHello");
  });
});

describe("textFromACPUpdate", () => {
  it("extracts visible text chunks for the active session", () => {
    expect(textFromACPUpdate({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "session-1", update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" }
      } }
    }, "session-1")).toBe("Hello");
  });

  it("ignores unrelated sessions and tool progress", () => {
    expect(textFromACPUpdate({
      method: "session/update",
      params: { sessionId: "session-2", update: {
        sessionUpdate: "agent_message_chunk", content: { type: "text", text: "secret" }
      } }
    }, "session-1")).toBe("");
    expect(textFromACPUpdate({
      method: "session/update",
      params: { sessionId: "session-1", update: {
        sessionUpdate: "tool_call_update", content: { type: "text", text: "not answer text" }
      } }
    }, "session-1")).toBe("");
  });
});


describe("hasUnsupportedACPContent", () => {
  it("allows text-only messages", () => {
    expect(hasUnsupportedACPContent([
      { role: "system", content: "Be concise" },
      { role: "user", content: [{ type: "text", text: "Summarize this" }] }
    ])).toBe(false);
  });

  it("requires API backend when messages contain images or files", () => {
    expect(hasUnsupportedACPContent([
      { role: "user", content: [
        { type: "text", text: "Read this page" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }
      ] }
    ])).toBe(true);
    expect(hasUnsupportedACPContent([
      { role: "user", content: [{ type: "file_data", file_data: { file_uri: "vault.pdf" } }] }
    ])).toBe(true);
  });
});

describe("OpenCode ACP model discovery", () => {
  it("reads legacy advertised models without submitting a prompt and closes the child", async () => {
    const child = prepareAgent();
    await expect(listOpenCodeModels({ binaryPath: "/usr/bin/opencode" })).resolves.toEqual([
      { id: "provider/default", name: "Default" },
      { id: "provider/selected", name: "Selected" }
    ]);
    expect(spawn).toHaveBeenCalledWith("/usr/bin/opencode", ["acp"], {
      cwd: "/tmp/acp-test",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    expect(child.messages.map(message => message.method)).toEqual(["initialize", "session/new"]);
    expect(child.messages[1].params).toEqual({ cwd: "/tmp/acp-test", mcpServers: [] });
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("deletes its empty discovery session before closing when the agent advertises support", async () => {
    const child = prepareAgent(configuredSession, {
      initialize: (request, agent) => agent.reply(request, deletableSessionInitialization),
      "session/delete": () => {}
    });
    const promise = listOpenCodeModels();
    const deletion = await child.nextRequest("session/delete");
    expect(deletion.params).toEqual({ sessionId: "session-1" });
    expect(child.stdin.writableEnded).toBe(false);
    expect(child.killed).toEqual([]);
    child.reply(deletion, {});
    await expect(promise).resolves.toHaveLength(2);
    expect(child.messages.map(message => message.method)).toEqual(["initialize", "session/new", "session/delete"]);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it.each([undefined, null, false, []])("does not delete sessions when deletion is not supported: %s", async capability => {
    const child = prepareAgent(legacySession, {
      initialize: (request, agent) => agent.reply(request, {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { delete: capability } }
      })
    });
    await expect(listOpenCodeModels()).resolves.toHaveLength(2);
    expect(child.messages.some(message => message.method === "session/delete")).toBe(false);
  });

  it("also deletes a newly created discovery session when catalog parsing fails", async () => {
    const child = prepareAgent({ sessionId: "session-1" }, {
      initialize: (request, agent) => agent.reply(request, deletableSessionInitialization)
    });
    await expect(listOpenCodeModels()).rejects.toThrow("没有提供可选择的模型");
    expect(child.messages.map(message => message.method)).toEqual(["initialize", "session/new", "session/delete"]);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("reports failure to delete the temporary session instead of claiming successful discovery", async () => {
    const child = prepareAgent(configuredSession, {
      initialize: (request, agent) => agent.reply(request, deletableSessionInitialization),
      "session/delete": (request, agent) => agent.send({
        id: request.id, error: { code: -32000, message: "Storage unavailable" }
      })
    });
    await expect(listOpenCodeModels()).rejects.toThrow(/无法删除.*空会话.*Storage unavailable/);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("preserves the catalog error when temporary-session deletion also fails", async () => {
    prepareAgent({ sessionId: "session-1" }, {
      initialize: (request, agent) => agent.reply(request, deletableSessionInitialization),
      "session/delete": (request, agent) => agent.send({
        id: request.id, error: { code: -32000, message: "Storage unavailable" }
      })
    });
    await expect(listOpenCodeModels()).rejects.toThrow(/没有提供可选择的模型.*无法删除.*Storage unavailable/);
  });

  it("prefers model config options over the legacy catalog and supports provider groups", async () => {
    prepareAgent({
      ...legacySession,
      configOptions: [
        { id: "mode", category: "mode", type: "select", options: [{ value: "code", name: "Code" }] },
        {
          id: "selector",
          category: "model",
          type: "select",
          options: [
            { group: "a", name: "Provider A", options: [
              { value: "a/one", name: "One" },
              { value: "a/one", name: "Duplicate" },
              { value: "", name: "Empty" }
            ] },
            { group: "b", name: "Provider B", options: [{ value: "b/two" }, null] }
          ]
        }
      ]
    });
    await expect(listOpenCodeModels()).resolves.toEqual([
      { id: "a/one", name: "One" },
      { id: "b/two", name: "b/two" }
    ]);
  });

  it("recognizes an uncategorized model config option by its standard id", async () => {
    prepareAgent({
      sessionId: "session-1",
      configOptions: [{ id: "model", type: "select", options: [{ value: "a/one", name: "One" }] }]
    });
    await expect(listOpenCodeModels()).resolves.toEqual([{ id: "a/one", name: "One" }]);
  });

  it("reports missing catalogs instead of treating them as successful discovery", async () => {
    const child = prepareAgent({ sessionId: "session-1" });
    await expect(listOpenCodeModels()).rejects.toThrow("没有提供可选择的模型");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("rejects malformed advertised config options without falling back to legacy choices", async () => {
    prepareAgent({
      ...legacySession,
      configOptions: [{ id: "model", category: "model", type: "select", options: null }]
    });
    await expect(listOpenCodeModels()).rejects.toThrow("无效的模型配置");
  });

  it("denies permission and filesystem requests during discovery", async () => {
    const child = prepareAgent(legacySession, {
      "session/new": (request, agent) => {
        agent.send({
          id: "permission",
          method: "session/request_permission",
          params: { options: [
            { kind: "allow_once", optionId: "allow" },
            { kind: "reject_once", optionId: "reject" }
          ] }
        });
        agent.send({ id: "read-file", method: "fs/read_text_file", params: { path: "/private" } });
        agent.reply(request, legacySession);
      }
    });
    await listOpenCodeModels();
    expect(child.messages.find(message => message.id === "permission")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "reject" }
    });
    expect(child.messages.find(message => message.id === "read-file")?.error?.code).toBe(-32601);
    expect(child.messages.some(message => message.method === "session/prompt")).toBe(false);
  });

  it("surfaces discovery authentication errors and closes the child", async () => {
    const child = prepareAgent(legacySession, {
      "session/new": (request, agent) => agent.send({
        id: request.id, error: { code: -32000, message: "auth_required" }
      })
    });
    await expect(listOpenCodeModels()).rejects.toThrow("opencode auth login");
    expect(child.killed).toEqual(["SIGTERM"]);
  });
});

describe("OpenCode ACP model selection", () => {
  it("retains generation history even when session deletion is supported", async () => {
    const child = prepareAgent(configuredSession, {
      initialize: (request, agent) => agent.reply(request, deletableSessionInitialization)
    });
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }])).resolves.toBe("Answer");
    expect(child.messages.some(message => message.method === "session/delete")).toBe(false);
  });

  it("sets a legacy model before sending the prompt", async () => {
    const child = prepareAgent();
    const onDelta = vi.fn();
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }], {
      model: " provider/selected ",
      onDelta
    })).resolves.toBe("Answer");
    expect(child.messages.map(message => message.method)).toEqual([
      "initialize", "session/new", "session/set_model", "session/prompt"
    ]);
    expect(child.messages[2].params).toEqual({ sessionId: "session-1", modelId: "provider/selected" });
    expect(child.messages[3].params.prompt).toEqual([{ type: "text", text: "[User]\nQuestion" }]);
    expect(onDelta).toHaveBeenCalledWith("Answer");
  });

  it("uses the advertised model config id and confirms the selected value before prompting", async () => {
    const child = prepareAgent(configuredSession);
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }], {
      model: "provider/selected"
    })).resolves.toBe("Answer");
    expect(child.messages.map(message => message.method)).toEqual([
      "initialize", "session/new", "session/set_config_option", "session/prompt"
    ]);
    expect(child.messages[2].params).toEqual({
      sessionId: "session-1", configId: "model-selector", value: "provider/selected"
    });
  });

  it("leaves the default model untouched when no model is selected, including older agents without catalogs", async () => {
    const child = prepareAgent({ sessionId: "session-1" });
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }], { model: " " })).resolves.toBe("Answer");
    expect(child.messages.map(message => message.method)).toEqual(["initialize", "session/new", "session/prompt"]);
  });

  it("rejects a stale or unavailable selection without generating on a default model", async () => {
    const child = prepareAgent();
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }], {
      model: "provider/removed"
    })).rejects.toThrow("当前未提供所选模型");
    expect(child.messages.map(message => message.method)).toEqual(["initialize", "session/new"]);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it.each(["session/set_model", "session/set_config_option"])(
    "propagates %s failure without prompting or falling back",
    async method => {
      const session = method === "session/set_model" ? legacySession : configuredSession;
      const child = prepareAgent(session, {
        [method]: (request, agent) => agent.send({
          id: request.id, error: { code: -32602, message: "Model is no longer available" }
        })
      });
      await expect(runOpenCodeACP([{ role: "user", content: "Question" }], {
        model: "provider/selected"
      })).rejects.toThrow("Model is no longer available");
      expect(child.messages.some(message => message.method === "session/prompt")).toBe(false);
      expect(child.killed).toEqual(["SIGTERM"]);
    }
  );

  it("rejects a config response that silently retains another model", async () => {
    const child = prepareAgent(configuredSession, {
      "session/set_config_option": (request, agent) => agent.reply(request, configuredSession)
    });
    await expect(runOpenCodeACP([{ role: "user", content: "Question" }], {
      model: "provider/selected"
    })).rejects.toThrow("未确认应用所选模型");
    expect(child.messages.some(message => message.method === "session/prompt")).toBe(false);
  });
});

describe("OpenCode ACP process safety", () => {
  it("keeps Windows executable launch behavior for existing npm installations", async () => {
    prepareAgent();
    vi.mocked(loadNodeRuntimeModules).mockResolvedValue({
      ...runtime, process: { platform: "win32" }
    });
    await listOpenCodeModels({ binaryPath: "opencode.cmd" });
    expect(spawn).toHaveBeenCalledWith("opencode.cmd", ["acp"], expect.objectContaining({ shell: true }));
  });

  it("never starts a process when discovery is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listOpenCodeModels({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("cancels discovery during initialization and terminates the process", async () => {
    const child = prepareAgent(legacySession, { initialize: () => {} });
    const controller = new AbortController();
    const promise = listOpenCodeModels({ signal: controller.signal });
    await child.nextRequest("initialize");
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("cancels the active session if selection is aborted before a prompt", async () => {
    const child = prepareAgent(configuredSession, { "session/set_config_option": () => {} });
    const controller = new AbortController();
    const promise = runOpenCodeACP([{ role: "user", content: "Question" }], {
      model: "provider/selected", signal: controller.signal
    });
    await child.nextRequest("session/set_config_option");
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(child.messages.some(message => message.method === "session/prompt")).toBe(false);
    expect(child.messages.find(message => message.method === "session/cancel")?.params).toEqual({
      sessionId: "session-1"
    });
  });

  it("bounds discovery time and escalates termination for an unresponsive child", async () => {
    vi.useFakeTimers();
    const child = prepareAgent(legacySession, { initialize: () => {} });
    child.ignoreKill = true;
    const promise = listOpenCodeModels();
    const rejected = expect(promise).rejects.toThrow("超时（30 秒）");
    await child.nextRequest("initialize");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(child.killed).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(child.killed).toEqual(["SIGTERM", "SIGKILL"]);
    child.close();
  });

  it("reports unexpected process exit with its bounded stderr detail", async () => {
    const child = prepareAgent(legacySession, { initialize: () => {} });
    const promise = listOpenCodeModels();
    await child.nextRequest("initialize");
    child.stderr.write("configuration unavailable");
    child.close(1);
    await expect(promise).rejects.toThrow(/进程已退出.*configuration unavailable/);
  });

  it("reports startup failure and cleans up outstanding requests", async () => {
    const child = prepareAgent(legacySession, { initialize: () => {} });
    const promise = listOpenCodeModels();
    await child.nextRequest("initialize");
    child.emit("error", new Error("spawn opencode ENOENT"));
    await expect(promise).rejects.toThrow("找不到 OpenCode CLI");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("handles closed stdin as a request failure", async () => {
    const child = prepareAgent(legacySession, { initialize: () => {} });
    const promise = listOpenCodeModels();
    await child.nextRequest("initialize");
    child.stdin.emit("error", new Error("EPIPE"));
    await expect(promise).rejects.toThrow("无法向 OpenCode ACP 发送请求：EPIPE");
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("rejects oversized protocol output without sending a generation prompt", async () => {
    const child = prepareAgent(legacySession, {
      initialize: (_request, agent) => agent.stdout.write("x".repeat(2_000_001))
    });
    await expect(listOpenCodeModels()).rejects.toThrow("协议输出过大");
    expect(child.messages.some(message => message.method === "session/prompt")).toBe(false);
    expect(child.killed).toEqual(["SIGTERM"]);
  });

  it("ignores non-message JSON values in stdout", async () => {
    prepareAgent(legacySession, {
      initialize: (request, agent) => {
        agent.stdout.write("null\n[]\n42\n");
        agent.reply(request, { protocolVersion: 1 });
      }
    });
    await expect(listOpenCodeModels()).resolves.toHaveLength(2);
  });
});
