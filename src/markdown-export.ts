function fileLabel(target: string): string {
  const clean = target.trim().split("#", 1)[0].split("?", 1)[0];
  const base = clean.split("/").pop() || clean;
  return base.replace(/\.(?:md|canvas)$/i, "");
}

function flattenInlineMarkdown(line: string): string {
  return line
    .replace(/!\[\[([^\]]+)\]\]/g, (_all, body: string) => {
      const [target, alias] = body.split("|", 2);
      return alias?.trim() || fileLabel(target);
    })
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias: string | undefined) =>
      alias?.trim() || fileLabel(target))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_all, alt: string) => alt.trim() || "[image]")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?:\/\/)[^>]+)>/gi, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/\x60([^\x60]+)\x60/g, "$1");
}

/**
 * Flatten common Markdown presentation markers into readable static-export text.
 * This deliberately avoids HTML rendering or URL fetching; rich Markdown parity
 * is outside the static SVG renderer's scope.
 */
export function flattenMarkdownForSvg(value: string): string {
  if (!value) return "";
  const normalized = value.replace(/\r\n?/g, "\n");
  let inCodeFence = false;
  const lines: string[] = [];

  for (const line of normalized.split("\n")) {
    if (/^\s*\x60{3}/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      lines.push(line.replace(/[ \t]+$/g, ""));
      continue;
    }

    let output = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^\s*>\s?/, "");
    output = output
      .replace(/^(\s*)[-*+]\s+\[[xX]\]\s+/, "$1☑ ")
      .replace(/^(\s*)[-*+]\s+\[\s?\]\s+/, "$1☐ ")
      .replace(/^(\s*)[-*+]\s+/, "$1• ")
      .replace(/^(\s*)(\d+)[.)]\s+/, "$1$2. ");
    lines.push(flattenInlineMarkdown(output).replace(/[ \t]+$/g, ""));
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
