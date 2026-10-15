import { TFile } from "obsidian";
import { parseCanvasMarkdownMetadata } from "./canvas-metadata-parser";

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
  private backlinkScanDepth = 0;
  private originalGetMarkdownFiles: ((...args: any[]) => any) | null = null;
  private getMarkdownFilesWrapper: ((...args: any[]) => any) | null = null;
  private backlinkWrappers = new Map<any, { original: (...args: any[]) => any; wrapped: (...args: any[]) => any }>();

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
    this.installBacklinkBridge();

    this.plugin.register(() => this.stop());
    this.plugin.registerEvent(this.app.vault.on("create", (file: any) => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("modify", (file: any) => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("rename", (file: any, oldPath: string) => {
      if (this.isCanvasPath(oldPath)) {
        delete this.cache.resolvedLinks?.[oldPath];
        delete this.cache.unresolvedLinks?.[oldPath];
        if (this.cache.fileCache) delete this.cache.fileCache[oldPath];
        const oldName = oldPath.split("/").pop()?.toLowerCase();
        try {
          if (oldName) this.cache.uniqueFileLookup?.remove?.(oldName, file);
        } catch {
          // Keep the cache patch working even if this Obsidian version uses a different lookup API.
        }
      }
      this.queueIfCanvas(file);
    }));
    this.plugin.registerEvent(this.app.vault.on("delete", (file: any) => {
      if (!this.isCanvasPath(file?.path)) return;
      delete this.cache.resolvedLinks?.[file.path];
      delete this.cache.unresolvedLinks?.[file.path];
      if (this.cache.fileCache) delete this.cache.fileCache[file.path];
      try {
        if (file?.name) this.cache.uniqueFileLookup?.remove?.(String(file.name).toLowerCase(), file);
      } catch {
        // Internal lookup cleanup is best-effort across Obsidian versions.
      }
    }));
    this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.patchBacklinkViews()));
    this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.patchBacklinkViews()));
    this.app.workspace.onLayoutReady(() => {
      this.patchBacklinkViews();
      this.refreshAll();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.cache && this.originalGetCache && this.cache.getCache === this.getCacheWrapper) {
      this.cache.getCache = this.originalGetCache;
    }
    this.getCacheWrapper = null;
    this.originalGetCache = null;
    const vault = this.app?.vault as any;
    if (vault && this.originalGetMarkdownFiles && vault.getMarkdownFiles === this.getMarkdownFilesWrapper) {
      vault.getMarkdownFiles = this.originalGetMarkdownFiles;
    }
    this.originalGetMarkdownFiles = null;
    this.getMarkdownFilesWrapper = null;
    for (const [target, patch] of this.backlinkWrappers) {
      if (target.recomputeBacklink === patch.wrapped) target.recomputeBacklink = patch.original;
    }
    this.backlinkWrappers.clear();
  }

  refreshAll(): void {
    if (this.stopped || !this.enabled()) return;
    const files = this.app.vault.getFiles().filter((file: TFile) => this.isCanvasPath(file.path));
    for (const file of files) void this.index(file);
  }

  private installBacklinkBridge(): void {
    const vault = this.app?.vault as any;
    if (!vault || typeof vault.getMarkdownFiles !== "function") return;
    this.originalGetMarkdownFiles = vault.getMarkdownFiles;
    const original = this.originalGetMarkdownFiles!;
    const self = this;
    this.getMarkdownFilesWrapper = function (...args: any[]) {
      const files = original.apply(this, args) as TFile[];
      if (self.backlinkScanDepth <= 0) return files;
      const canvases = self.app.vault.getFiles().filter((file: TFile) => self.isCanvasPath(file.path));
      const unique = new Map<string, TFile>();
      for (const file of [...files, ...canvases]) unique.set(file.path, file);
      return [...unique.values()];
    };
    vault.getMarkdownFiles = this.getMarkdownFilesWrapper;
  }

  private patchBacklinkViews(): void {
    if (this.stopped || !this.enabled()) return;
    let leaves: any[] = [];
    try {
      leaves = this.app.workspace.getLeavesOfType("backlink") ?? [];
    } catch {
      return;
    }
    for (const leaf of leaves) {
      const view = leaf?.view;
      const targets = [view?.backlink, view].filter(Boolean);
      for (const target of targets) {
        if (typeof target.recomputeBacklink !== "function" || this.backlinkWrappers.has(target)) continue;
        const original = target.recomputeBacklink;
        const self = this;
        const wrapped = function (...args: any[]) {
          self.backlinkScanDepth += 1;
          let result: any;
          try {
            result = original.apply(this, args);
          } catch (error) {
            self.backlinkScanDepth = Math.max(0, self.backlinkScanDepth - 1);
            throw error;
          }
          if (result && typeof result.then === "function") {
            return result.finally(() => {
              self.backlinkScanDepth = Math.max(0, self.backlinkScanDepth - 1);
            });
          }
          self.backlinkScanDepth = Math.max(0, self.backlinkScanDepth - 1);
          return result;
        };
        target.recomputeBacklink = wrapped;
        this.backlinkWrappers.set(target, { original, wrapped });
      }
    }
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
      // Obsidian's link resolver consults uniqueFileLookup to resolve Vault
      // files by basename. Registering the Canvas itself allows notes to link
      // to it and makes inbound backlinks possible.
      try {
        this.cache.uniqueFileLookup?.add(file.name.toLowerCase(), file);
      } catch {
        // Internal lookup implementation differs across Obsidian versions.
      }
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
        // URI destinations belong to external-link consumers, not Obsidian's
        // unresolved Vault-link map. Keep them in metadata.links for inspection.
        if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) continue;
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
      listItems: [],
      footnotes: [],
      footnoteRefs: [],
      referenceLinks: [],
      blocks: {},
      nodes: {}
    };

    for (const [key, rawValue] of Object.entries(frontmatter)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const match = value.match(/^\\[\\[([^\\]|]+)(?:\\|([^\\]]+))?\\]\\]$/);
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

    const rawTags = frontmatter.tags ?? frontmatter.tag;
    const frontmatterTags = (Array.isArray(rawTags) ? rawTags : typeof rawTags === "string" ? [rawTags] : [])
      .flatMap((raw: unknown) => typeof raw === "string" ? raw.split(/[\\s,]+/) : [])
      .map((tag: string) => tag.trim().replace(/^#+/, ""))
      .filter((tag: string) => /^[\\p{L}\\p{N}_][\\p{L}\\p{N}_/-]*$/u.test(tag));
    for (const tag of frontmatterTags) {
      metadata.tags.push({
        tag: "#" + tag,
        source: "frontmatter",
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 0, offset: 0 }
        }
      });
    }

    const nodePosition = (entry: any, nodeId: string): any => {
      const position = entry?.position;
      const fallback = { line: 0, col: 0, offset: 0 };
      return {
        ...entry,
        position: {
          nodeId,
          start: position?.start ?? fallback,
          end: position?.end ?? position?.start ?? fallback
        }
      };
    };
    const aggregate = (target: string, entries: unknown, nodeId: string): void => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (entry && typeof entry === "object") metadata[target].push(nodePosition(entry, nodeId));
      }
    };

    const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
    for (const node of nodes) {
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

        aggregate("links", nodeMetadata?.links, String(node.id));
        aggregate("embeds", nodeMetadata?.embeds, String(node.id));
        aggregate("tags", nodeMetadata?.tags, String(node.id));
        aggregate("headings", nodeMetadata?.headings, String(node.id));
        aggregate("sections", nodeMetadata?.sections, String(node.id));
        aggregate("listItems", nodeMetadata?.listItems, String(node.id));
        aggregate("footnotes", nodeMetadata?.footnotes, String(node.id));
        aggregate("footnoteRefs", nodeMetadata?.footnoteRefs, String(node.id));
        aggregate("referenceLinks", nodeMetadata?.referenceLinks, String(node.id));
        if (nodeMetadata?.blocks && typeof nodeMetadata.blocks === "object") {
          for (const [blockId, block] of Object.entries(nodeMetadata.blocks)) {
            metadata.blocks[String(blockId)] ??= { ...((block && typeof block === "object") ? block : {}), nodeId: String(node.id) };
          }
        }
      } else if (node?.type === "file" && typeof node.file === "string") {
        metadata.embeds.push({
          link: node.file,
          original: node.file,
          displayText: node.file,
          position: {
            nodeId: String(node.id),
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 0, offset: 0 }
          }
        });
      } else if (node?.type === "link" && typeof node.url === "string") {
        metadata.links.push({
          link: node.url,
          original: node.url,
          displayText: node.url,
          position: {
            nodeId: String(node.id),
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 0, offset: 0 }
          }
        });
      }
    }
    return metadata;
  }

  private fallbackMarkdownMetadata(text: string): any {
    return parseCanvasMarkdownMetadata(text);
  }

}
