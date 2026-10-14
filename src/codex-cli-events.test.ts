import { describe, expect, it } from "vitest";
import { parseCodexJsonEvent } from "./codex-cli-events";

describe("Codex CLI JSON event parsing", () => {
  it("extracts a final assistant message", () => {
    expect(parseCodexJsonEvent(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Analysis complete." }
    }))).toEqual({ finalText: "Analysis complete." });
  });

  it("extracts supported forward-compatible text deltas", () => {
    expect(parseCodexJsonEvent(JSON.stringify({
      type: "item.delta",
      item: { type: "agent_message" },
      delta: "partial"
    }))).toEqual({ textDelta: "partial" });
  });

  it("ignores informational item-level error notices", () => {
    expect(parseCodexJsonEvent(JSON.stringify({
      type: "item.completed",
      item: { type: "error", message: "Non-fatal configuration notice" }
    }))).toBeNull();
  });

  it("reports fatal stream errors", () => {
    expect(parseCodexJsonEvent(JSON.stringify({ type: "error", message: "Not authenticated" })))
      .toEqual({ error: "Not authenticated" });
    expect(parseCodexJsonEvent(JSON.stringify({ type: "turn.failed", error: { message: "Failed" } })))
      .toEqual({ error: "Failed" });
  });

  it("ignores malformed and unrelated JSONL lines", () => {
    expect(parseCodexJsonEvent("not JSON")).toBeNull();
    expect(parseCodexJsonEvent(JSON.stringify({ type: "turn.started" }))).toBeNull();
  });
});
