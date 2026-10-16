/**
 * Pure logic behind the prompt modal (`FeaturePromptModal`): the decision of
 * whether a submit should close the modal, and the JSON validation used by the
 * prompt entries that take JSON. Kept free of Obsidian APIs so it is directly
 * testable; every message here is user-facing and never exposes parser output.
 */

export type PromptSubmission =
  | { kind: "cancelled" }
  | { kind: "invalid"; message: string }
  | { kind: "submit"; value: string };

export interface PromptSubmissionOptions {
  /** Explicitly clearable fields opt in; otherwise empty input is a cancel. */
  allowEmpty?: boolean;
  /** Non-empty text means the value must not be submitted and the modal stays open. */
  validate?: (value: string) => string | null;
}

export function resolvePromptSubmission(value: string, options: PromptSubmissionOptions = {}): PromptSubmission {
  if (!options.allowEmpty && value.trim().length === 0) return { kind: "cancelled" };
  const message = options.validate?.(value);
  if (message) return { kind: "invalid", message };
  return { kind: "submit", value };
}

/**
 * Adapts a domain parser that reports failure by throwing into the modal's
 * pre-submit validation, so the caller keeps one source of wording.
 */
export function promptValidator(
  check: (value: string) => unknown,
  fallbackMessage = "输入的 JSON 无效。请检查后重试。"
): (value: string) => string | null {
  return value => {
    try {
      check(value);
      return null;
    } catch (error) {
      return error instanceof Error && error.message ? error.message : fallbackMessage;
    }
  };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse a JSON object typed by the user; failures carry plugin wording. */
export function parseJsonObjectPrompt(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(label + " JSON 无效。请检查后重试。");
  }
  if (!isJsonObject(parsed)) {
    throw new Error("输入必须是 JSON 对象，例如 {}。");
  }
  return parsed;
}
