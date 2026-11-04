import { TFile, type App, type MetadataCache, type Plugin, type Vault, type WorkspaceLeaf } from "obsidian";
import { appendCanvasNodeMetadata, isVaultLinkDestination, parseCanvasMarkdownMetadata, type CanvasMetadataAggregate } from "./canvas-metadata-parser";

interface FileCacheRecord {
  mtime: number;
  size: number;
  hash: string;
}

/** Version-dependent metadata internals, with opaque cache payloads. */
interface MetadataCacheHost {
  getCache: (this: MetadataCacheHost, path: string, ...args: unknown[]) => unknown;
  fileCache?: Record<string, FileCacheRecord>;
  metadataCache?: Record<string, unknown>;
  uniqueFileLookup?: {
    add(name: string, file: TFile): void;
    remove?(name: string, file: TFile): void;
  };
  saveFileCache?(path: string, record: FileCacheRecord): void;
  saveMetaCache?(hash: string, metadata: IndexedCanvasMetadata): void;
  computeMetadataAsync?(buffer: ArrayBuffer): Promise<unknown>;
  resolvedLinks?: Record<string, Record<string, number>>;
  unresolvedLinks?: Record<string, Record<string, number>>;
  getFirstLinkpathDest: MetadataCache["getFirstLinkpathDest"];
  trigger: MetadataCache["trigger"];
}

interface IndexedCanvasMetadata extends Required<CanvasMetadataAggregate> {
  v: number;
  frontmatter: Record<string, unknown>;
  frontmatterPosition: { start: { line: number; col: number; offset: number }; end: { line: number; col: number; offset: number } };
  frontmatterLinks: unknown[];
}

interface CanvasMetadataDocument {
  metadata?: unknown;
  nodes?: unknown;
}

type MarkdownFilesGetter = (this: Vault, ...args: unknown[]) => TFile[];

interface MarkdownFilesHost {
  getMarkdownFiles: MarkdownFilesGetter;
}

type BacklinkRecompute = (this: BacklinkTarget, ...args: unknown[]) => unknown;
interface BacklinkTarget { recomputeBacklink: BacklinkRecompute; }

function isBacklinkTarget(value: unknown): value is BacklinkTarget {
  return value !== null && typeof value === "object" &&
    "recomputeBacklink" in value && typeof value.recomputeBacklink === "function";
}

function hasPromiseFinalizer(value: unknown): value is { then: (...args: unknown[]) => unknown; finally(callback: () => void): unknown } {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    "then" in value && typeof value.then === "function" &&
    "finally" in value && typeof value.finally === "function";
}

/**
 * Makes .canvas files visible to Obsidian's metadata cache.
 *
 * Obsidian's MetadataCache is an internal API in places, so this adapter is
 * deliberately defensive. It only overrides getCache for .canvas paths and
 * falls back to the original implementation for every other file.
 */
export class CanvasMetadataIndexer {
  private cache: MetadataCacheHost;
  private originalGetCache: MetadataCacheHost["getCache"] | null = null;
  private getCacheWrapper: MetadataCacheHost["getCache"] | null = null;
  private app: App;
  private plugin: Pick<Plugin, "register" | "registerEvent">;
  private enabled: () => boolean;
  private indexing = new Set<string>();
  private stopped = false;
  private backlinkScanDepth = 0;
  private originalGetMarkdownFiles: MarkdownFilesGetter | null = null;
  private getMarkdownFilesWrapper: MarkdownFilesGetter | null = null;
  private backlinkWrappers = new Map<BacklinkTarget, { original: BacklinkRecompute; wrapped: BacklinkRecompute }>();

  constructor(app: App, plugin: Pick<Plugin, "register" | "registerEvent">, enabled: () => boolean) {
    this.cache = app.metadataCache;
    this.app = app;
    this.plugin = plugin;
    this.enabled = enabled;
  }

  start(): void {
    this.cache = this.app.metadataCache;
    if (typeof this.cache.getCache !== "function") return;

    const original = this.cache.getCache;
    this.originalGetCache = original;
    const useCanvasCache = (path: string) => this.isCanvasPath(path);
    const enabled = () => this.enabled();
    this.getCacheWrapper = function (this: MetadataCacheHost, path: string, ...args: unknown[]) {
      if (useCanvasCache(path)) {
        if (!enabled()) return null;
        const hash = this.fileCache?.[path]?.hash;
        return hash ? this.metadataCache?.[hash] ?? null : null;
      }
      return original.call(this, path, ...args);
    };
    this.cache.getCache = this.getCacheWrapper;
    this.installBacklinkBridge();

    this.plugin.register(() => this.stop());
    this.plugin.registerEvent(this.app.vault.on("create", file => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("modify", file => this.queueIfCanvas(file)));
    this.plugin.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.isCanvasPath(oldPath)) {
        delete this.cache.resolvedLinks?.[oldPath];
        delete this.cache.unresolvedLinks?.[oldPath];
        if (this.cache.fileCache) delete this.cache.fileCache[oldPath];
        const oldName = oldPath.split("/").pop()?.toLowerCase();
        try {
          if (oldName && file instanceof TFile) this.cache.uniqueFileLookup?.remove?.(oldName, file);
        } catch {
          // Keep the cache patch working even if this Obsidian version uses a different lookup API.
        }
      }
      this.queueIfCanvas(file);
    }));
    this.plugin.registerEvent(this.app.vault.on("delete", file => {
      if (!this.isCanvasPath(file?.path)) return;
      delete this.cache.resolvedLinks?.[file.path];
      delete this.cache.unresolvedLinks?.[file.path];
      if (this.cache.fileCache) delete this.cache.fileCache[file.path];
      try {
        if (file instanceof TFile) this.cache.uniqueFileLookup?.remove?.(file.name.toLowerCase(), file);
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
    const vault = this.app.vault;
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
    const vault = this.app.vault;
    if (typeof vault.getMarkdownFiles !== "function") return;
    const host: MarkdownFilesHost = vault;
    const original = host.getMarkdownFiles;
    this.originalGetMarkdownFiles = original;
    const includeCanvasFiles = (files: TFile[]) => {
      if (this.backlinkScanDepth <= 0) return files;
      const canvases = this.app.vault.getFiles().filter(file => this.isCanvasPath(file.path));
      const unique = new Map<string, TFile>();
      for (const file of [...files, ...canvases]) unique.set(file.path, file);
      return [...unique.values()];
    };
    this.getMarkdownFilesWrapper = function (this: Vault, ...args: unknown[]) {
      return includeCanvasFiles(original.apply(this, args));
    };
    vault.getMarkdownFiles = this.getMarkdownFilesWrapper;
  }

  private patchBacklinkViews(): void {
    if (this.stopped || !this.enabled()) return;
    let leaves: WorkspaceLeaf[] = [];
    try {
      leaves = this.app.workspace.getLeavesOfType("backlink") ?? [];
    } catch {
      return;
    }
    for (const leaf of leaves) {
      const view = leaf.view;
      const targets: unknown[] = ["backlink" in view ? view.backlink : undefined, view];
      for (const target of targets) {
        if (!isBacklinkTarget(target) || this.backlinkWrappers.has(target)) continue;
        const original = target.recomputeBacklink;
        const beginScan = () => { this.backlinkScanDepth += 1; };
        const finishScan = () => { this.backlinkScanDepth = Math.max(0, this.backlinkScanDepth - 1); };
        const wrapped: BacklinkRecompute = function (this: BacklinkTarget, ...args: unknown[]) {
          beginScan();
          let result: unknown;
          try {
            result = original.apply(this, args);
          } catch (error) {
            finishScan();
            throw error;
          }
          if (hasPromiseFinalizer(result)) return result.finally(finishScan);
          finishScan();
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

  private queueIfCanvas(file: unknown): void {
    if (!(file instanceof TFile)) return;
    if (this.stopped || !this.enabled() || !this.isCanvasPath(file.path)) return;
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
      let canvas: unknown;
      try {
        canvas = JSON.parse(text || "{}");
      } catch (error) {
        console.warn("Better Canvas could not index malformed Canvas JSON:", path, error);
        return;
      }
      const data: CanvasMetadataDocument = canvas !== null && typeof canvas === "object" ? canvas : {};
      const hash = await this.hash(bytes);
      // Obsidian's link resolver consults uniqueFileLookup to resolve Vault
      // files by basename. Registering the Canvas itself allows notes to link
      // to it and makes inbound backlinks possible.
      try {
        this.cache.uniqueFileLookup?.add(file.name.toLowerCase(), file);
      } catch {
        // Internal lookup implementation differs across Obsidian versions.
      }
      let metadata: unknown = this.cache.metadataCache?.[hash];

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
        const builtMetadata = await this.buildMetadata(data);
        metadata = builtMetadata;
        try {
          this.cache.saveMetaCache?.(hash, builtMetadata);
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
      const cached = metadata !== null && typeof metadata === "object" ? metadata as CanvasMetadataAggregate & { frontmatterLinks?: unknown[] } : {};
      const references: unknown[] = [
        ...(Array.isArray(cached.links) ? cached.links : []),
        ...(Array.isArray(cached.embeds) ? cached.embeds : []),
        ...(Array.isArray(cached.frontmatterLinks) ? cached.frontmatterLinks : [])
      ];
      for (const reference of references) {
        const link = reference !== null && typeof reference === "object" && "link" in reference && typeof reference.link === "string" ? reference.link : "";
        if (!link) continue;
        // URI destinations belong to external-link consumers, not Obsidian's
        // unresolved Vault-link map. Keep them in metadata.links for inspection.
        if (!isVaultLinkDestination(link)) continue;
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

  private async buildMetadata(canvas: CanvasMetadataDocument): Promise<IndexedCanvasMetadata> {
    const rawFrontmatter: unknown = canvas.metadata !== null && typeof canvas.metadata === "object" && "frontmatter" in canvas.metadata
      ? canvas.metadata.frontmatter : undefined;
    const frontmatter: Record<string, unknown> = rawFrontmatter !== null && typeof rawFrontmatter === "object" && !Array.isArray(rawFrontmatter)
      ? rawFrontmatter as Record<string, unknown> : {};
    const metadata: IndexedCanvasMetadata = {
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

    const rawTags = frontmatter.tags ?? frontmatter.tag;
    const frontmatterTags = (Array.isArray(rawTags) ? rawTags : typeof rawTags === "string" ? [rawTags] : [])
      .flatMap((raw: unknown) => typeof raw === "string" ? raw.split(/[\s,]+/) : [])
      .map((tag: string) => tag.trim().replace(/^#+/, ""))
      .filter((tag: string) => /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(tag));
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

    const nodes: unknown[] = Array.isArray(canvas.nodes) ? canvas.nodes : [];
    for (const node of nodes) {
      if (node === null || typeof node !== "object") continue;
      const data = node as { id?: unknown; type?: unknown; text?: unknown; file?: unknown; url?: unknown };
      if (data.type === "text" && typeof data.text === "string") {
        let nodeMetadata: unknown = null;
        if (typeof this.cache.computeMetadataAsync === "function") {
          try {
            nodeMetadata = await this.cache.computeMetadataAsync(new TextEncoder().encode(data.text).buffer);
          } catch {
            nodeMetadata = null;
          }
        }
        nodeMetadata ??= parseCanvasMarkdownMetadata(data.text);
        appendCanvasNodeMetadata(metadata, String(data.id), nodeMetadata);
      } else if (data.type === "file" && typeof data.file === "string") {
        metadata.embeds.push({
          link: data.file,
          original: data.file,
          displayText: data.file,
          position: {
            nodeId: String(data.id),
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 0, offset: 0 }
          }
        });
      } else if (data.type === "link" && typeof data.url === "string") {
        metadata.links.push({
          link: data.url,
          original: data.url,
          displayText: data.url,
          position: {
            nodeId: String(data.id),
            start: { line: 0, col: 0, offset: 0 },
            end: { line: 0, col: 0, offset: 0 }
          }
        });
      }
    }
    return metadata;
  }


}
