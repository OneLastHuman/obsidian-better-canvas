import { TFile } from "obsidian";

/**
 * Makes .canvas files visible to Obsidian's metadata cache.
 *
 * Obsidian's MetadataCache is an internal API in places, so this adapter is
 * deliberately defensive. It only overrides getCache for .canvas paths and
 * falls back to the original implementation for every other file.
 */
export class CanvasMetadataIndexer {
  private cache: any;
  private originalGetCache: ((...args: any[]) => any) | null = null;
  private getCacheWrapper: ((...args: any[]) => any) | null = null;
  private app: any;
  private plugin: any;
  private enabled: () => boolean;
  private indexing = new Set<string>();
  private stopped = false;

  constructor(app: any, plugin: any, enabled: () => boolean) {
    this.app = app;
    this.plugin = plugin;
    this.enabled = enabled;
  }

  start(): void {
    this.cache = this.app.metadataCache as any;
    if (!this.cache || typeof this.cache.getCache !== "function") return;

    this.originalGetCache = this.cache.getCache;
    const original = this.originalGetCache!;
    const self = this;
    this.getCacheWrapper = function (path: string, ...args: any[]) {
      if (self.isCanvasPath(path)) {
        if (!self.enabled()) return null;
        const record = this.fileCache?.[path];
        const hash = record?.hash;
        return hash ? this.metadataCache?.[hash] ?? null : null;
      }
      return original.call(this, path, ...args);
    };
    this.cache.getCache = this.getCacheWrapper;

    this.plugin.register(() => this.stop());
    this.plugin.registerEvent(this.app.vault.on("create", (file: any) => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("modify", (file: any) => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("rename", (file: any, oldPath: string) => {
      if (this.isCanvasPath(oldPath)) {
        delete this.cache.resolvedLinks?.[oldPath];
        delete this.cache.unresolvedLinks?.[oldPath];
        if (this.cache.fileCache) delete this.cache.fileCache[oldPath];
      }
      this.queueIfCanvas(file);
    }));
    this.plugin.registerEvent(this.app.vault.on("delete", (file: any) => {
      if (!this.isCanvasPath(file?.path)) return;
      delete this.cache.resolvedLinks?.[file.path];
      delete this.cache.unresolvedLinks?.[file.path];
      if (this.cache.fileCache) delete this.cache.fileCache[file.path];
    }));
    this.app.workspace.onLayoutReady(() => this.refreshAll());
  }

  stop(): void {
    this.stopped = true;
    if (this.cache && this.originalGetCache && this.cache.getCache === this.getCacheWrapper) {
      this.cache.getCache = this.originalGetCache;
    }
    this.getCacheWrapper = null;
    this.originalGetCache = null;
  }

  refreshAll(): void {
    if (this.stopped || !this.enabled()) return;
    const files = this.app.vault.getFiles().filter((file: TFile) => this.isCanvasPath(file.path));
    for (const file of files) void this.index(file);
  }

  private isCanvasPath(path: unknown): boolean {
    return typeof path === "string" && path.toLowerCase().endsWith(".canvas");
  }

  private queueIfCanvas(file: any): void {
    if (this.stopped || !this.enabled() || !this.isCanvasPath(file?.path)) return;
    if (!(file instanceof TFile)) return;
    void this.index(file);
  }

  private async hash(bytes: Uint8Array): Promise<string> {
    try {
      const stableBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(stableBuffer).set(bytes);
      const digest = await crypto.subtle.digest("SHA-256", stableBuffer);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      let value = 2166136261;
      for (const byte of bytes) {
        value ^= byte;
        value = Math.imul(value, 16777619);
      }
      return (value >>> 0).toString(16) + "-" + bytes.byteLength;
    }
  }

  private async index(file: TFile): Promise<void> {
    const path = file.path;
    if (this.stopped || !this.enabled() || this.indexing.has(path)) return;
    this.indexing.add(path);
    try {
      const rawBinary = await this.app.vault.readBinary(file);
      const bytes = new Uint8Array(rawBinary);
      const text = new TextDecoder().decode(bytes);
      let canvas: any;
      try {
        canvas = JSON.parse(text || "{}");
      } catch (error) {
        console.warn("Better Canvas could not index malformed Canvas JSON:", path, error);
        return;
      }
      const data = canvas && typeof canvas === "object" ? canvas : {};
      const hash = await this.hash(bytes);
      let metadata = this.cache.metadataCache?.[hash];

      try {
        this.cache.saveFileCache?.(path, {
          mtime: file.stat.mtime,
          size: file.stat.size,
          hash
        });
      } catch {
        this.cache.fileCache ??= {};
        this.cache.fileCache[path] = { mtime: file.stat.mtime, size: file.stat.size, hash };
      }

      if (!metadata) {
        metadata = await this.buildMetadata(data);
        try {
          this.cache.saveMetaCache?.(hash, metadata);
        } catch {
          this.cache.metadataCache ??= {};
          this.cache.metadataCache[hash] = metadata;
        }
      }

      // Some Obsidian builds expose these maps as plain objects, others may
      // initialize them lazily. Preserve unrelated entries in either case.
      this.cache.resolvedLinks ??= {};
      this.cache.unresolvedLinks ??= {};
      const resolved: Record<string, number> = {};
      const unresolved: Record<string, number> = {};
      const references = [
        ...(Array.isArray(metadata?.links) ? metadata.links : []),
        ...(Array.isArray(metadata?.embeds) ? metadata.embeds : []),
        ...(Array.isArray(metadata?.frontmatterLinks) ? metadata.frontmatterLinks : [])
      ];
      for (const reference of references) {
        const link = typeof reference?.link === "string" ? reference.link : "";
        if (!link) continue;
        const destination = this.cache.getFirstLinkpathDest?.(link, path);
        if (destination?.path) {
          resolved[destination.path] = (resolved[destination.path] ?? 0) + 1;
        } else {
          const unresolvedKey = link.endsWith(".md") ? link.slice(0, -3) : link;
          unresolved[unresolvedKey] = (unresolved[unresolvedKey] ?? 0) + 1;
        }
      }
      this.cache.resolvedLinks[path] = resolved;
      this.cache.unresolvedLinks[path] = unresolved;

      this.cache.trigger?.("changed", file, text, metadata);
      this.cache.trigger?.("resolve", file);
      this.cache.trigger?.("resolved");
    } catch (error) {
      console.warn("Better Canvas metadata indexing failed:", path, error);
    } finally {
      this.indexing.delete(path);
    }
  }

  private async buildMetadata(canvas: any): Promise<any> {
    const frontmatter = canvas?.metadata?.frontmatter ?? {};
    const metadata: any = {
      v: 1,
      frontmatter,
      frontmatterPosition: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 0, offset: 0 }
      },
      frontmatterLinks: [],
      links: [],
      embeds: [],
      tags: [],
      headings: [],
      sections: [],
      blocks: {},
      nodes: {}
    };

    for (const [key, rawValue] of Object.entries(frontmatter)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const match = value.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
        if (match) {
          metadata.frontmatterLinks.push({
            key,
            link: match[1],
            displayText: match[2] ?? match[1],
            original: value
          });
        }
      }
    }

    const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node?.type === "text" && typeof node.text === "string") {
        let nodeMetadata: any = null;
        if (typeof this.cache.computeMetadataAsync === "function") {
          try {
            nodeMetadata = await this.cache.computeMetadataAsync(new TextEncoder().encode(node.text).buffer);
          } catch {
            nodeMetadata = null;
          }
        }
        nodeMetadata ??= this.fallbackMarkdownMetadata(node.text);
        metadata.nodes[node.id] = nodeMetadata;
        for (const link of nodeMetadata?.links ?? []) {
          metadata.links.push({
            ...link,
            position: {
              nodeId: node.id,
              start: { line: 0, col: 1, offset: 0 },
              end: { line: 0, col: 1, offset: index }
            }
          });
        }
        for (const embed of nodeMetadata?.embeds ?? []) {
          metadata.embeds.push({
            ...embed,
            position: {
              nodeId: node.id,
              start: { line: 0, col: 1, offset: 0 },
              end: { line: 0, col: 1, offset: index }
            }
          });
        }
      } else if (node?.type === "file" && typeof node.file === "string") {
        metadata.embeds.push({
          link: node.file,
          original: node.file,
          displayText: node.file,
          position: {
            nodeId: node.id,
            start: { line: 0, col: 1, offset: 0 },
            end: { line: 0, col: 1, offset: index }
          }
        });
      } else if (node?.type === "link" && typeof node.url === "string") {
        metadata.links.push({
          link: node.url,
          original: node.url,
          displayText: node.url,
          position: {
            nodeId: node.id,
            start: { line: 0, col: 1, offset: 0 },
            end: { line: 0, col: 1, offset: index }
          }
        });
      }
    }
    return metadata;
  }

  private fallbackMarkdownMetadata(text: string): any {
    const links: any[] = [];
    const embeds: any[] = [];
    const expression = /!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    for (const match of text.matchAll(expression)) {
      const link = match[1].trim();
      const value = {
        link,
        original: match[0],
        displayText: (match[2] ?? link).trim(),
        position: {
          start: { line: 0, col: match.index ?? 0, offset: match.index ?? 0 },
          end: { line: 0, col: (match.index ?? 0) + match[0].length, offset: (match.index ?? 0) + match[0].length }
        }
      };
      if (match[0].startsWith("!")) embeds.push(value);
      else links.push(value);
    }
    return { links, embeds, tags: [], headings: [], sections: [], blocks: {} };
  }
}
