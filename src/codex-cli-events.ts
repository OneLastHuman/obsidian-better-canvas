export interface CodexJsonEvent {
  textDelta?: string;
  finalText?: string;
  error?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Parse one JSONL event emitted by `codex exec --json`.
 * Informational item-level errors are ignored; top-level error/turn.failed
 * events are fatal.
 */
export function parseCodexJsonEvent(line: string): CodexJsonEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const event = record(parsed);
  if (!event) return null;

  if (event.type === "error") {
    return { error: typeof event.message === "string" ? event.message : "Codex returned an error." };
  }
  if (event.type === "turn.failed") {
    const message = record(event.error)?.message;
    return { error: typeof message === "string" ? message : "Codex turn failed." };
  }

  const item = record(event.item);
  const itemType = item?.type ?? item?.item_type;
  // item.completed:error can be a harmless warning from Codex configuration.
  if (itemType !== "agent_message") return null;

  if (event.type === "item.completed" && typeof item?.text === "string") {
    return { finalText: item.text };
  }
  if (typeof event.delta === "string" && event.delta) {
    return { textDelta: event.delta };
  }
  if (event.type === "item.delta" && typeof item?.delta === "string") {
    return { textDelta: item.delta };
  }
  return null;
}
