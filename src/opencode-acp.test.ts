import { describe, expect, it } from "vitest";
import { buildACPUserPrompt, hasUnsupportedACPContent, textFromACPUpdate } from "./opencode-acp";

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
