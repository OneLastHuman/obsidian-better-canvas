import { ItemView, Notice, TFile } from "obsidian";
import { CanvasData, CanvasEdgeData, CanvasNodeData, readCanvasData } from "./canvas";

const PORTAL_PREFIX = "bcportal||";
const PORTAL_DELIMITER = "||";
const PORTAL_PADDING = 48;
const MIN_PORTAL_SIZE = 200;

type MirrorInfo = { portalId: string; childId: string };

function mirrorId(portalId: string, childId: string): string {
  return PORTAL_PREFIX + portalId + PORTAL_DELIMITER + childId;
}

function mirrorInfo(id: unknown): MirrorInfo | null {
  if (typeof id !== "string" || !id.startsWith(PORTAL_PREFIX)) return null;
  const remainder = id.slice(PORTAL_PREFIX.length);
  const separator = remainder.indexOf(PORTAL_DELIMITER);
  if (separator <= 0) return null;
  const portalId = remainder.slice(0, separator);
  const childId = remainder.slice(separator + PORTAL_DELIMITER.length);
  if (!portalId || !childId) return null;
  return { portalId, childId };
}

function isMirrorNode(node: any): boolean {
  return Boolean(mirrorInfo(node?.id));
}

function isCanvasFileNode(node: any): node is CanvasNodeData {
  return node?.type === "file" && typeof node.file === "string" && node.file.toLowerCase().endsWith(".canvas");
}

function parseCanvasJson(raw: string): CanvasData {
  const value = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error("文件不是有效的 JSON Canvas：需要 nodes 和 edges 数组。");
  }
  return value as CanvasData;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function center(node: CanvasNodeData): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function edgeSides(fromNode: CanvasNodeData, toNode: CanvasNodeData): [string, string] {
  const from = center(fromNode);
  const to = center(toNode);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function bbox(nodes: CanvasNodeData[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...nodes.map(node => node.x)),
    minY: Math.min(...nodes.map(node => node.y)),
    maxX: Math.max(...nodes.map(node => node.x + node.width)),
    maxY: Math.max(...nodes.map(node => node.y + node.height))
  };
}

function childIdFromEdgeId(portalId: string, id: string): string {
  const info = mirrorInfo(id);
  return info?.portalId === portalId ? info.childId : id;
}

interface ViewPatch {
  original: (...args: any[]) => any;
  wrapper: (...args: any[]) => any;
}

interface PortalSnapshot {
  portalId: string;
  file: TFile;
  data: CanvasData;
  offsetX: number;
  offsetY: number;
  mirroredNodes: CanvasNodeData[];
  mirroredEdges: CanvasEdgeData[];
}

export class CanvasPortalManager {
  private plugin: any;
  private viewPatches = new Map<any, ViewPatch>();
  private boundViews = new WeakSet<HTMLElement>();
  private signatures = new WeakMap<object, string>();
  private writingFiles = new Map<string, any>();
  private lastPortalPositions = new WeakMap<object, Map<string, { x: number; y: number }>>();
  private stopped = false;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  start(): void {
    this.plugin.addCommand({
      id: "bc-toggle-canvas-portal",
      name: "Better Canvas: 打开/关闭所选 Canvas Portal",
      callback: () => this.togglePortalForNode()
    });

    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => {
      void this.refreshAll();
    }));
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => {
      void this.refreshAll();
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on("modify", (file: TFile) => {
      if (file.extension.toLowerCase() !== "canvas") return;
      const origin = this.writingFiles.get(file.path);
      for (const leaf of this.plugin.app.workspace.getLeavesOfType("canvas")) {
        const view = leaf.view as any;
        if (origin && view === origin) continue;
        // A Canvas saving itself already has the latest live state. Other
        // views that embed that file still need to rebuild their portal mirrors.
        if (!origin && view?.file?.path === file.path) continue;
        void this.refreshView(view, true);
      }
    }));
    this.plugin.app.workspace.onLayoutReady(() => void this.refreshAll(true));
    this.plugin.register(() => this.stop());
  }

  stop(): void {
    this.stopped = true;
    for (const [view, patch] of this.viewPatches) {
      if (view?.getViewData === patch.wrapper) view.getViewData = patch.original;
    }
    this.viewPatches.clear();
  }

  async refreshAll(force = false): Promise<void> {
    if (this.stopped) return;
    const leaves = this.plugin.app.workspace.getLeavesOfType("canvas");
    await Promise.all(leaves.map((leaf: any) => this.refreshView(leaf.view, force)));
  }

  async refreshView(view: any, force = false): Promise<void> {
    if (this.stopped || !view?.canvas || !view?.containerEl) return;
    this.patchViewSerializer(view);
    this.bindViewInteractions(view);

    let rawData: CanvasData;
    try {
      rawData = deepClone(readCanvasData(view.canvas));
    } catch {
      return;
    }
    const canonical = this.canonicalizeForSave(rawData);
    const portalNodes = canonical.nodes.filter((node: any) => isCanvasFileNode(node) && node.portal === true);
    const signature = await this.buildSignature(view, canonical.nodes, portalNodes);
    const currentHasMirrors = rawData.nodes.some(isMirrorNode);
    if (!force && this.signatures.get(view) === signature && (portalNodes.length === 0 || currentHasMirrors)) return;

    const snapshots: PortalSnapshot[] = [];
    for (const portalNode of portalNodes) {
      const parentPath = view.file?.path;
      if (typeof parentPath === "string" && portalNode.file === parentPath) continue;
      const file = this.plugin.app.vault.getAbstractFileByPath(portalNode.file);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") continue;
      try {
        const data = parseCanvasJson(await this.plugin.app.vault.cachedRead(file));
        const bounds = bbox(data.nodes);
        const offsetX = portalNode.x + PORTAL_PADDING - bounds.minX;
        const offsetY = portalNode.y + PORTAL_PADDING - bounds.minY;
        const mirroredNodes = data.nodes.map((node: CanvasNodeData) => ({
          ...node,
          id: mirrorId(portalNode.id, node.id),
          x: node.x + offsetX,
          y: node.y + offsetY,
          // Nested portal expansion is intentionally deferred to avoid cyclic
          // self-inclusion and ambiguous serialization of multi-level portals.
          ...(isCanvasFileNode(node) ? { portal: false } : {})
        }));
        const mirroredEdges = data.edges.map((edge: CanvasEdgeData) => ({
          ...edge,
          id: mirrorId(portalNode.id, edge.id),
          fromNode: mirrorId(portalNode.id, edge.fromNode),
          toNode: mirrorId(portalNode.id, edge.toNode)
        }));
        portalNode.width = Math.max(MIN_PORTAL_SIZE, bounds.maxX - bounds.minX + PORTAL_PADDING * 2);
        portalNode.height = Math.max(MIN_PORTAL_SIZE, bounds.maxY - bounds.minY + PORTAL_PADDING * 2);
        snapshots.push({ portalId: portalNode.id, file, data, offsetX, offsetY, mirroredNodes, mirroredEdges });
      } catch (error) {
        console.warn("Better Canvas could not open Canvas portal:", portalNode.file, error);
      }
    }

    const loadedPortalIds = new Set(portalNodes.map((node: CanvasNodeData) => node.id));
    const storedCrossEdges = new Map<string, CanvasEdgeData[]>();
    for (const portalNode of portalNodes) {
      const list = Array.isArray((portalNode as any).bcPortalEdges)
        ? (portalNode as any).bcPortalEdges as CanvasEdgeData[] : [];
      storedCrossEdges.set(portalNode.id, list);
    }
    const storedEdgeIds = new Set<string>();
    for (const list of storedCrossEdges.values()) for (const edge of list) storedEdgeIds.add(edge.id);

    const currentCrossEdges = new Map<string, CanvasEdgeData[]>();
    for (const edge of rawData.edges) {
      const fromInfo = mirrorInfo(edge.fromNode);
      const toInfo = mirrorInfo(edge.toNode);
      if (!fromInfo && !toInfo) continue;
      if (fromInfo && toInfo && fromInfo.portalId === toInfo.portalId) continue;
      const owners = [...new Set([fromInfo?.portalId, toInfo?.portalId].filter((id): id is string => Boolean(id)))];
      for (const owner of owners) {
        const list = currentCrossEdges.get(owner) ?? [];
        if (!list.some(item => item.id === edge.id)) list.push(deepClone(edge));
        currentCrossEdges.set(owner, list);
      }
    }

    // Reconcile live cross-portal connections with the source data embedded
    // on each portal node. Then remove synthetic data before rebuilding it.
    for (const portalNode of canonical.nodes.filter(isCanvasFileNode)) {
      if (portalNode.portal !== true && !loadedPortalIds.has(portalNode.id)) continue;
      const previous = storedCrossEdges.get(portalNode.id) ?? [];
      const observed = currentCrossEdges.get(portalNode.id) ?? [];
      const merged = new Map<string, CanvasEdgeData>();
      for (const edge of previous) merged.set(edge.id, deepClone(edge));
      for (const edge of observed) merged.set(edge.id, deepClone(edge));
      if (portalNode.portal === true) {
        if (merged.size) (portalNode as any).bcPortalEdges = [...merged.values()];
        else delete (portalNode as any).bcPortalEdges;
        storedCrossEdges.set(portalNode.id, [...merged.values()]);
      }
    }

    const openPortalIds = new Set(snapshots.map(snapshot => snapshot.portalId));
    const openCrossIds = new Set<string>();
    for (const portalId of openPortalIds) {
      for (const edge of storedCrossEdges.get(portalId) ?? []) openCrossIds.add(edge.id);
    }

    const baseEdges = canonical.edges.filter((edge: CanvasEdgeData) => {
      const fromInfo = mirrorInfo(edge.fromNode);
      const toInfo = mirrorInfo(edge.toNode);
      if (fromInfo && toInfo && fromInfo.portalId === toInfo.portalId) return false;
      if (fromInfo || toInfo) return false;
      if (openCrossIds.has(edge.id)) return false;
      return true;
    });

    const restoredCrossEdges = new Map<string, CanvasEdgeData>();
    for (const portalId of openPortalIds) {
      for (const edge of storedCrossEdges.get(portalId) ?? []) restoredCrossEdges.set(edge.id, deepClone(edge));
    }
    const mirrorIds = new Set<string>(snapshots.flatMap(snapshot => snapshot.mirroredNodes.map(node => node.id)));
    const childEdges = snapshots.flatMap(snapshot => snapshot.mirroredEdges);
    const restoredEdges = [...restoredCrossEdges.values()].map(edge => {
      const copy = deepClone(edge) as any;
      for (const endpoint of ["fromNode", "toNode"] as const) {
        const info = mirrorInfo(copy[endpoint]);
        if (info && !mirrorIds.has(copy[endpoint])) copy[endpoint] = info.portalId;
      }
      return copy as CanvasEdgeData;
    });

    const nextData: CanvasData = {
      ...canonical,
      nodes: [...canonical.nodes.filter((node: CanvasNodeData) => !isMirrorNode(node)), ...snapshots.flatMap(snapshot => snapshot.mirroredNodes)],
      edges: [...baseEdges, ...childEdges, ...restoredEdges]
    };
    const nextSignature = await this.buildSignature(view, nextData.nodes.filter((node: CanvasNodeData) => !isMirrorNode(node)), portalNodes);
    if (JSON.stringify(readCanvasData(view.canvas)) !== JSON.stringify(nextData)) {
      try {
        view.canvas.importData(nextData);
        view.canvas.requestFrame?.();
        view.canvas.requestSave?.();
      } catch (error) {
        console.warn("Better Canvas portal refresh failed:", error);
        return;
      }
    }
    this.signatures.set(view, nextSignature);
    const positions = new Map<string, { x: number; y: number }>();
    for (const portalNode of portalNodes) positions.set(portalNode.id, { x: portalNode.x, y: portalNode.y });
    this.lastPortalPositions.set(view, positions);
  }

  private canonicalizeForSave(input: CanvasData): CanvasData {
    const data = deepClone(input);
    const nodes = data.nodes.filter((node: CanvasNodeData) => !isMirrorNode(node));
    const portalNodes = nodes.filter(isCanvasFileNode);
    const portalNodeIds = new Set(portalNodes.map((node: CanvasNodeData) => node.id));
    const openIds = new Set(portalNodes.filter((node: any) => node.portal === true).map((node: CanvasNodeData) => node.id));
    const boundary = new Map<string, CanvasEdgeData[]>();

    const edges: CanvasEdgeData[] = [];
    for (const edge of data.edges) {
      const fromInfo = mirrorInfo(edge.fromNode);
      const toInfo = mirrorInfo(edge.toNode);
      if (fromInfo && toInfo && fromInfo.portalId === toInfo.portalId) continue;
      if (!fromInfo && !toInfo) {
        edges.push(edge);
        continue;
      }

      const owners = [...new Set([fromInfo?.portalId, toInfo?.portalId].filter((id): id is string => Boolean(id)))];
      // If a portal frame was deleted, never persist an edge to its missing node ID.
      if (owners.some(owner => !portalNodeIds.has(owner))) continue;
      for (const owner of owners) {
        if (!openIds.has(owner) || !portalNodeIds.has(owner)) continue;
        const list = boundary.get(owner) ?? [];
        if (!list.some(item => item.id === edge.id)) list.push(deepClone(edge));
        boundary.set(owner, list);
      }

      const rewritten = deepClone(edge) as any;
      if (fromInfo) rewritten.fromNode = fromInfo.portalId;
      if (toInfo) rewritten.toNode = toInfo.portalId;
      const fromNode = nodes.find((node: CanvasNodeData) => node.id === rewritten.fromNode);
      const toNode = nodes.find((node: CanvasNodeData) => node.id === rewritten.toNode);
      if (fromNode && toNode) {
        const [fromSide, toSide] = edgeSides(fromNode, toNode);
        rewritten.fromSide = fromSide;
        rewritten.toSide = toSide;
      }
      edges.push(rewritten as CanvasEdgeData);
    }

    for (const portalNode of portalNodes) {
      if (portalNode.portal === true) {
        const crossing = boundary.get(portalNode.id) ?? [];
        if (crossing.length) (portalNode as any).bcPortalEdges = crossing;
        else delete (portalNode as any).bcPortalEdges;
      }
    }
    for (const node of nodes) delete (node as any).isPortalLoaded;
    return { ...data, nodes, edges };
  }

  private patchViewSerializer(view: any): void {
    if (this.viewPatches.has(view) || typeof view?.getViewData !== "function") return;
    const original = view.getViewData.bind(view);
    const manager = this;
    const wrapper = function (...args: any[]) {
      const result = original(...args);
      if (typeof result !== "string") return result;
      try {
        const parsed = parseCanvasJson(result);
        const cleaned = manager.canonicalizeForSave(parsed);
        void manager.syncPortalFiles(view);
        return JSON.stringify(cleaned, null, 2);
      } catch (error) {
        console.warn("Better Canvas could not serialize portal data:", error);
        return result;
      }
    };
    view.getViewData = wrapper;
    this.viewPatches.set(view, { original, wrapper });
  }

  private bindViewInteractions(view: any): void {
    const container = view?.containerEl as HTMLElement | undefined;
    if (!(container instanceof HTMLElement) || this.boundViews.has(container)) return;
    this.boundViews.add(container);
    let pendingPortalMove: { id: string; x: number; y: number } | null = null;

    const onPointerDown = () => {
      pendingPortalMove = null;
      const canvas = view?.canvas;
      const selection = canvas?.selection;
      if (!selection || selection.size !== 1) return;
      const selected = selection.values().next().value;
      const id = selected?.id;
      if (typeof id !== "string" || mirrorInfo(id)) return;
      const node = readCanvasData(canvas).nodes.find((item: CanvasNodeData) => item.id === id) as any;
      if (node && isCanvasFileNode(node) && node.portal === true) {
        pendingPortalMove = { id, x: node.x, y: node.y };
      }
    };

    const onPointerUp = () => {
      window.setTimeout(async () => {
        const canvas = view?.canvas;
        if (!canvas) return;
        const movedPortal = pendingPortalMove && readCanvasData(canvas).nodes.find((node: CanvasNodeData) => node.id === pendingPortalMove?.id);
        if (pendingPortalMove && movedPortal &&
            (Math.abs(movedPortal.x - pendingPortalMove.x) > 0.5 || Math.abs(movedPortal.y - pendingPortalMove.y) > 0.5)) {
          await this.refreshView(view, true);
        } else {
          await this.syncPortalFiles(view);
          await this.refreshView(view);
        }
        pendingPortalMove = null;
      }, 50);
    };

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointerup", onPointerUp, true);
    container.addEventListener("pointercancel", onPointerUp, true);
    this.plugin.register(() => {
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      container.removeEventListener("pointercancel", onPointerUp, true);
      this.boundViews.delete(container);
    });
  }

  private async buildSignature(view: any, nodes: CanvasNodeData[], openPortals: CanvasNodeData[]): Promise<string> {
    const signature: any[] = [String(view?.file?.path ?? "")];
    for (const node of nodes.filter(isCanvasFileNode)) {
      const file = this.plugin.app.vault.getAbstractFileByPath(node.file);
      signature.push([
        node.id, node.file, Boolean((node as any).portal), node.x, node.y, node.width, node.height,
        JSON.stringify((node as any).bcPortalEdges ?? []),
        file instanceof TFile ? file.stat.mtime : -1,
        file instanceof TFile ? file.stat.size : -1
      ]);
    }
    signature.push(openPortals.map(node => node.id).sort());
    return JSON.stringify(signature);
  }

  private async syncPortalFiles(view: any): Promise<void> {
    const canvas = view?.canvas;
    if (!canvas || this.stopped) return;
    const data = readCanvasData(canvas);
    const portalNodes = data.nodes.filter((node: any) => isCanvasFileNode(node) && node.portal === true);
    for (const portalNode of portalNodes) {
      if (typeof view?.file?.path === "string" && portalNode.file === view.file.path) continue;
      const file = this.plugin.app.vault.getAbstractFileByPath(portalNode.file);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "canvas") continue;
      try {
        const raw = await this.plugin.app.vault.cachedRead(file);
        const source = parseCanvasJson(raw);
        const bounds = bbox(source.nodes);
        const offsetX = portalNode.x + PORTAL_PADDING - bounds.minX;
        const offsetY = portalNode.y + PORTAL_PADDING - bounds.minY;
        const liveNodes = new Map<string, CanvasNodeData>();
        for (const node of data.nodes) {
          const info = mirrorInfo(node.id);
          if (info?.portalId === portalNode.id) liveNodes.set(info.childId, node);
        }

        const nextNodes: CanvasNodeData[] = [];
        for (const originalNode of source.nodes) {
          const live = liveNodes.get(originalNode.id);
          if (!live) continue; // A mirrored node removed from the parent portal is removed at source.
          nextNodes.push({
            ...originalNode,
            ...live,
            id: originalNode.id,
            x: live.x - offsetX,
            y: live.y - offsetY,
            portal: (originalNode as any).portal
          } as CanvasNodeData);
        }

        const nextEdges: CanvasEdgeData[] = [];
        for (const edge of data.edges) {
          const from = mirrorInfo(edge.fromNode);
          const to = mirrorInfo(edge.toNode);
          if (!from || !to || from.portalId !== portalNode.id || to.portalId !== portalNode.id) continue;
          const edgeId = childIdFromEdgeId(portalNode.id, edge.id);
          nextEdges.push({
            ...edge,
            id: edgeId,
            fromNode: from.childId,
            toNode: to.childId
          } as CanvasEdgeData);
        }

        if (JSON.stringify(source.nodes) === JSON.stringify(nextNodes) &&
            JSON.stringify(source.edges) === JSON.stringify(nextEdges)) continue;

        this.writingFiles.set(file.path, view);
        await this.plugin.app.vault.modify(file, JSON.stringify({ ...source, nodes: nextNodes, edges: nextEdges }, null, 2));
      } catch (error) {
        console.warn("Better Canvas could not sync Canvas portal:", portalNode.file, error);
      } finally {
        this.writingFiles.delete(file.path);
      }
    }
  }

  togglePortalForNode(nodeId?: string): void {
    const view = this.plugin.app.workspace.getActiveViewOfType(ItemView) as any;
    const canvas = view?.getViewType?.() === "canvas" ? view.canvas : null;
    if (!canvas) {
      new Notice("请先打开 Canvas。");
      return;
    }
    if (canvas.wrapperEl?.classList?.contains("bc-readonly")) {
      new Notice("当前 Canvas 处于只读模式。");
      return;
    }
    const selection = canvas.selection;
    const selectedId = nodeId ?? (selection?.size === 1 ? selection.values().next().value?.id : undefined);
    if (typeof selectedId !== "string") {
      new Notice("请只选择一个指向 .canvas 文件的节点。");
      return;
    }
    const node = readCanvasData(canvas).nodes.find((item: CanvasNodeData) => item.id === selectedId) as any;
    if (!isCanvasFileNode(node)) {
      new Notice("所选节点不是 Canvas 文件节点。");
      return;
    }
    if (view?.file?.path === node.file) {
      new Notice("不能将当前画布作为它自身的 Portal。");
      return;
    }

    const nextOpen = node.portal !== true;
    const data = readCanvasData(canvas);
    const nodes = data.nodes.map((item: CanvasNodeData) => item.id === node.id
      ? { ...item, portal: nextOpen }
      : item);
    canvas.importData({ ...data, nodes, edges: data.edges });
    canvas.requestSave?.();
    canvas.requestFrame?.();
    void this.refreshView(view, true);
    new Notice(nextOpen ? "Portal 已打开。" : "Portal 已关闭。");
  }
}
