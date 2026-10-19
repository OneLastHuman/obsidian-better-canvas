export interface AutoResizeTestSettings {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  charWidthFactor: number;
  widthPadding: number;
  wrapWidthPadding: number;
  lineHeight: number;
  heightPadding: number;
}

export const DEFAULT_AUTO_RESIZE_TEST_SETTINGS: Readonly<AutoResizeTestSettings> = Object.freeze({
  minWidth: 20,
  minHeight: 20,
  maxWidth: 720,
  maxHeight: 1000,
  charWidthFactor: 7.2,
  widthPadding: 52,
  wrapWidthPadding: 40,
  lineHeight: 24,
  heightPadding: 44
});

type UnknownRecord = Record<string, unknown>;

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false
): number {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return integer ? Math.round(clamped) : Math.round(clamped * 10) / 10;
}

/** Normalize experimental settings before using or persisting them. */
export function normalizeAutoResizeTestSettings(value: unknown): AutoResizeTestSettings {
  const source: UnknownRecord = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};

  const minWidth = clampNumber(source.minWidth, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.minWidth, 20, 1200, true);
  const maxWidth = clampNumber(source.maxWidth, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.maxWidth, minWidth, 1200, true);
  const minHeight = clampNumber(source.minHeight, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.minHeight, 20, 2000, true);
  const maxHeight = clampNumber(source.maxHeight, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.maxHeight, minHeight, 2000, true);

  return {
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    charWidthFactor: clampNumber(source.charWidthFactor, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.charWidthFactor, 0.1, 50),
    widthPadding: clampNumber(source.widthPadding, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.widthPadding, 0, 1000, true),
    wrapWidthPadding: clampNumber(source.wrapWidthPadding, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.wrapWidthPadding, 0, 1000, true),
    lineHeight: clampNumber(source.lineHeight, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.lineHeight, 1, 500),
    heightPadding: clampNumber(source.heightPadding, DEFAULT_AUTO_RESIZE_TEST_SETTINGS.heightPadding, 0, 1000, true)
  };
}

/** Estimate text-node dimensions with the same parameters exposed in Settings > test. */
export function calculateTextNodeDimensions(
  text: string,
  rawSettings: unknown = DEFAULT_AUTO_RESIZE_TEST_SETTINGS
): { width: number; height: number } {
  const settings = normalizeAutoResizeTestSettings(rawSettings);
  const lines = text.split("\n");
  let longest = 1;
  for (const line of lines) longest = Math.max(longest, line.length);

  const width = Math.max(
    settings.minWidth,
    Math.min(settings.maxWidth, Math.round(longest * settings.charWidthFactor + settings.widthPadding))
  );

  const charactersPerWrappedLine = Math.max(
    1,
    (width - settings.wrapWidthPadding) / settings.charWidthFactor
  );
  const wrappedLines = lines.reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerWrappedLine)),
    0
  );
  const height = Math.max(
    settings.minHeight,
    Math.min(settings.maxHeight, Math.round(wrappedLines * settings.lineHeight + settings.heightPadding))
  );

  return { width, height };
}
