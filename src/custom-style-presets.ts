export type CustomStyleKind = "node" | "edge";

export interface CustomStyleOption {
  label: string;
  value: string | null;
  icon?: string;
}

export interface CustomStyleDefinition {
  kind: CustomStyleKind;
  key: string;
  label: string;
  icon?: string;
  options: CustomStyleOption[];
}

export interface CustomStyleChoice {
  definition: CustomStyleDefinition;
  option: CustomStyleOption;
}

type RawOption = {
  label?: string | null;
  value?: string | null;
  icon?: string | null;
};

type StyleRecord = {
  id: string;
  styleAttributes?: Record<string, unknown>;
};

type StyleCanvasData<TNode extends StyleRecord = StyleRecord, TEdge extends StyleRecord = StyleRecord> = {
  nodes: TNode[];
  edges: TEdge[];
};

function stripYamlInlineComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (quote === '"' && character === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).replace(/\s+$/, "");
    }
  }
  return line.replace(/\s+$/, "");
}

function parseScalar(rawValue: string): string | null | undefined {
  const cleaned = stripYamlInlineComment(rawValue).trim();
  if (!cleaned) return undefined;
  if (cleaned === "null" || cleaned === "~") return null;
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(cleaned);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    return cleaned.slice(1, -1).replace(/''/g, "'");
  }
  return cleaned;
}

function parseYamlPair(text: string): [string, string | null | undefined] | null {
  const match = text.trim().match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
  if (!match) return null;
  return [match[1], parseScalar(match[2])];
}

function parseDefinition(body: string, kind: CustomStyleKind): CustomStyleDefinition | null {
  let key: string | undefined;
  let label: string | undefined;
  let icon: string | undefined;
  let optionsSection = false;
  let currentOption: RawOption | null = null;
  const rawOptions: RawOption[] = [];

  for (const line of body.split(/\r?\n/)) {
    const withoutComment = stripYamlInlineComment(line);
    if (!withoutComment.trim()) continue;
    const indentation = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = withoutComment.trim();

    if (indentation === 0) {
      const pair = parseYamlPair(trimmed);
      if (!pair) {
        optionsSection = false;
        currentOption = null;
        continue;
      }
      const [field, value] = pair;
      if (field === "options" && value === undefined) {
        optionsSection = true;
        currentOption = null;
        continue;
      }
      optionsSection = false;
      currentOption = null;
      if (field === "key" && typeof value === "string") key = value;
      else if (field === "label" && typeof value === "string") label = value;
      else if (field === "icon" && typeof value === "string") icon = value;
      continue;
    }

    if (!optionsSection) continue;
    const listItem = trimmed.match(/^-\s*(.*)$/);
    if (listItem) {
      currentOption = {};
      rawOptions.push(currentOption);
      const initialPair = listItem[1].trim() ? parseYamlPair(listItem[1]) : null;
      if (initialPair) currentOption[initialPair[0] as keyof RawOption] = initialPair[1] as never;
      else if (listItem[1].trim()) currentOption = null;
      continue;
    }
    if (!currentOption) continue;
    const pair = parseYamlPair(trimmed);
    if (pair) currentOption[pair[0] as keyof RawOption] = pair[1] as never;
  }

  if (!key || !/^[a-z][a-z0-9-]*$/.test(key) || !label?.trim() || rawOptions.length === 0) {
    return null;
  }
  const options: CustomStyleOption[] = [];
  const seenValues = new Set<string>();
  let nullCount = 0;
  for (const option of rawOptions) {
    if (typeof option.label !== "string" || !option.label.trim() ||
        (typeof option.value !== "string" && option.value !== null)) {
      return null;
    }
    const valueKey = option.value === null ? "null" : "string:" + option.value;
    if (seenValues.has(valueKey)) return null;
    seenValues.add(valueKey);
    if (option.value === null) nullCount += 1;
    options.push({
      label: option.label.trim(),
      value: option.value,
      ...(typeof option.icon === "string" && option.icon.trim() ? { icon: option.icon.trim() } : {})
    });
  }
  if (nullCount !== 1) return null;

  return {
    kind,
    key: key.trim(),
    label: label.trim(),
    ...(icon?.trim() ? { icon: icon.trim() } : {}),
    options
  };
}

/**
 * Parses Advanced Canvas-compatible YAML declarations embedded in CSS comments.
 * It intentionally supports the small scalar/list subset used by style definitions,
 * rather than accepting arbitrary YAML tags, aliases, or executable values.
 */
export function parseCssStyleDefinitions(cssText: string): CustomStyleDefinition[] {
  if (typeof cssText !== "string" || !cssText) return [];
  const definitions: CustomStyleDefinition[] = [];
  const pattern = /\/\*\s*@advanced-canvas-(node|edge)-style\s*\r?\n([\s\S]*?)\*\//g;
  for (const match of cssText.matchAll(pattern)) {
    const kind: CustomStyleKind = match[1] === "node" ? "node" : "edge";
    const parsed = parseDefinition(match[2], kind);
    if (!parsed) continue;
    const existingIndex = definitions.findIndex(
      definition => definition.kind === parsed.kind && definition.key === parsed.key
    );
    if (existingIndex >= 0) definitions[existingIndex] = parsed;
    else definitions.push(parsed);
  }
  return definitions;
}

/**
 * Adds the selected custom attribute to nodes or edges without mutating the source
 * Canvas object. A null choice is retained in JSON as the explicit reset value;
 * the renderer removes its matching data-* attribute for null values.
 */
export function applyCustomStyleChoice<
  TNode extends StyleRecord,
  TEdge extends StyleRecord,
  TData extends StyleCanvasData<TNode, TEdge>
>(
  data: TData,
  selectedIds: readonly string[],
  definition: CustomStyleDefinition,
  value: string | null
): { data: TData; updated: number } {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.key) ||
      !definition.options.some(option => option.value === value)) {
    return { data, updated: 0 };
  }

  const selection = new Set(selectedIds);
  let updated = 0;
  if (definition.kind === "node") {
    const nodes = data.nodes.map(node => {
      if (!selection.has(node.id)) return node;
      const styleAttributes = node.styleAttributes && typeof node.styleAttributes === "object" &&
        !Array.isArray(node.styleAttributes) ? node.styleAttributes : {};
      if (Object.prototype.hasOwnProperty.call(styleAttributes, definition.key) &&
          styleAttributes[definition.key] === value) return node;
      updated += 1;
      return {
        ...node,
        styleAttributes: { ...styleAttributes, [definition.key]: value }
      };
    });
    return { data: { ...data, nodes } as TData, updated };
  }

  const edges = data.edges.map(edge => {
    if (!selection.has(edge.id)) return edge;
    const styleAttributes = edge.styleAttributes && typeof edge.styleAttributes === "object" &&
      !Array.isArray(edge.styleAttributes) ? edge.styleAttributes : {};
    if (Object.prototype.hasOwnProperty.call(styleAttributes, definition.key) &&
        styleAttributes[definition.key] === value) return edge;
    updated += 1;
    return {
      ...edge,
      styleAttributes: { ...styleAttributes, [definition.key]: value }
    };
  });
  return { data: { ...data, edges } as TData, updated };
}


/**
 * Resolve an enabled local CSS snippet stylesheet to its Vault adapter path.
 * Obsidian preserves stylesheet comments in the source file, not in cssRules,
 * so read the original snippet text rather than trying to reconstruct CSSOM rules.
 */
export function cssSnippetVaultPathFromHref(href: string, configDir: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!["app:", "file:", "capacitor:"].includes(url.protocol)) return null;

  let pathname: string;
  try {
    // URL.pathname is already slash-delimited; decode once for Vault paths with spaces.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  const normalizedConfig = String(configDir || "").replace(/^\\/+|\\/+$/g, "");
  if (!normalizedConfig || !/^[A-Za-z0-9._-]+$/.test(normalizedConfig)) return null;
  const marker = "/" + normalizedConfig + "/snippets/";
  const markerIndex = pathname.lastIndexOf(marker);
  let relativeSnippet: string;
  if (markerIndex >= 0) {
    relativeSnippet = pathname.slice(markerIndex + marker.length);
  } else {
    const fallbackMarker = "/snippets/";
    const fallbackIndex = pathname.lastIndexOf(fallbackMarker);
    if (fallbackIndex < 0) return null;
    relativeSnippet = pathname.slice(fallbackIndex + fallbackMarker.length);
  }

  const segments = relativeSnippet.split("/");
  if (!relativeSnippet || segments.some(segment => !segment || segment === "." || segment === "..")) return null;
  if (!relativeSnippet.toLowerCase().endsWith(".css")) return null;
  return normalizedConfig + "/snippets/" + relativeSnippet;
}
