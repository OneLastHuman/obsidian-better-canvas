import type { CanvasEdgeData } from "./canvas";

export interface AutoEdgeFileNode {
  id: string;
  file: string;
}

export type FrontmatterValueReader = (filePath: string) => unknown;
export type LinkDestinationResolver = (linkPath: string) => string | undefined;

/**
 * Extract link targets from a frontmatter value.
 * Accepts a scalar string or a list of strings, supports multiple wikilinks in
 * one string and removes repeated targets while preserving their first order.
 */
export function extractAutoEdgeTargets(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const targets = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const matches = value.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
    const candidates = matches?.length
      ? matches.map((link: string) => link.slice(2, -2).split("|")[0])
      : [value.trim()];

    for (const candidate of candidates) {
      const target = candidate.trim();
      if (target) targets.add(target);
    }
  }

  return [...targets];
}

/**
 * Derive deterministic Canvas edges from file-node frontmatter.
 *
 * The resolver intentionally remains supplied by the host plugin so Obsidian's
 * metadata cache keeps control of aliases, relative links, and path resolution.
 * Repeated links cannot produce duplicate edge IDs.
 */
export function buildAutoFileNodeEdges(
  fileNodes: AutoEdgeFileNode[],
  readFrontmatterValue: FrontmatterValueReader,
  resolveDestination: LinkDestinationResolver
): CanvasEdgeData[] {
  const generated = new Map<string, CanvasEdgeData>();

  for (const source of fileNodes) {
    const raw = readFrontmatterValue(source.file);
    for (const targetPath of extractAutoEdgeTargets(raw)) {
      const destinationPath = resolveDestination(targetPath);
      if (!destinationPath) continue;

      for (const target of fileNodes) {
        if (target.id === source.id || target.file === source.file || target.file !== destinationPath) continue;
        const id = "bc-auto-" + source.id + "-" + target.id;
        if (generated.has(id)) continue;
        generated.set(id, {
          id,
          fromNode: source.id,
          fromSide: "right",
          fromFloating: true,
          toNode: target.id,
          toSide: "left",
          toFloating: true
        });
      }
    }
  }

  return [...generated.values()];
}
