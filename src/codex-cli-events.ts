export interface CodexJsonEvent {
  textDelta?: string;
  finalText?: string;
  error?: string;
}

/**
 * Parse one JSONL event emitted by `codex exec --json`.
 * Informational item-level errors are ignored; top-level error/turn.failed
 * events are fatal.
 */
export function parseCodexJsonEvent(line: string): CodexJsonEvent | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;

  if (event.type === "error") {
    return { error: String(event.message ?? "Codex returned an error.") };
  }
  if (event.type === "turn.failed") {
    return { error: String(event.error?.message ?? "Codex turn failed.") };
  }

  const itemType = event.item?.type ?? event.item?.item_type;
  // item.completed:error can be a harmless warning from Codex configuration.
  if (itemType !== "agent_message") return null;

  if (event.type === "item.completed" && typeof event.item?.text === "string") {
    return { finalText: event.item.text };
  }
  if (typeof event.delta === "string" && event.delta) {
    return { textDelta: event.delta };
  }
  if (event.type === "item.delta" && typeof event.item?.delta === "string") {
    return { textDelta: event.item.delta };
  }
  return null;
}
