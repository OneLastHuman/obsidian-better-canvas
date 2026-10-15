"use strict";

/**
 * 极简 CDP harness：从 Node 驱动真实 Obsidian。
 *
 * Obsidian 桌面版本质是 Electron/Chromium，`--remote-debugging-port` 暴露的
 * DevTools 协议与 Playwright 相通，因此 `connectOverCDP` 无需下载任何浏览器
 * 就能连上应用。仅依赖 `playwright-core`（本仓库的 devDependency）。
 *
 * 出处：本文件是 docs/e2e-acceptance 证据运行所用 harness 的精简版，
 * 两者的连接/滚动/选区逻辑保持一致；修改时请同步。
 */

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

class BC {
  constructor(port, vault, outDir) {
    this.port = String(port);
    this.vault = vault;
    this.out = outDir || path.join(process.cwd(), "e2e-out");
    this.errors = [];
    this.pageErrors = [];
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    const ctx = this.browser.contexts()[0];
    this.ctx = ctx;

    let page = ctx.pages().find((p) => p.url() === "app://obsidian.md/index.html");
    if (!page) page = ctx.pages().find((p) => p.url().startsWith("app://obsidian.md"));
    if (!page) {
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) {
        page = ctx.pages().find((p) => p.url() === "app://obsidian.md/index.html")
          || ctx.pages().find((p) => p.url().startsWith("app://obsidian.md"));
        if (page) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!page) {
      throw new Error("main Obsidian window not found; pages=" + ctx.pages().map((p) => p.url()).join(","));
    }
    this.page = page;
    page.on("console", (m) => {
      if (m.type() === "error") this.errors.push(m.text());
    });
    page.on("pageerror", (e) => {
      this.pageErrors.push(e.message);
    });

    await this.dismissTrust();
    await this.collapseExtraWindows();
    return this;
  }

  // 全新 Vault 会弹出「信任仓库作者」；信任后 Obsidian 会额外开一个设置窗口，
  // 而 Obsidian 把模态框路由到焦点窗口，所以关掉多余窗口，让模态框落在主窗口。
  async collapseExtraWindows() {
    for (let i = 0; i < 10; i++) {
      const extras = this.ctx.pages().filter((p) => p !== this.page);
      if (!extras.length) break;
      for (const p of extras) {
        await p.evaluate(() => { try { window.close(); } catch {} }).catch(() => {});
      }
      await this.page.waitForTimeout(400);
    }
    const still = this.ctx.pages().filter((p) => p !== this.page);
    if (still.length) this.extraWindows = still.map((p) => p.url());
    await this.page.bringToFront().catch(() => {});
    await this.page.waitForTimeout(600);
    return this.extraWindows || [];
  }

  async dismissTrust() {
    const p = this.page;
    for (let i = 0; i < 20; i++) {
      const clicked = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const t = btns.find((b) => /信任仓库作者|Trust author|Trust and enable/i.test(b.innerText || ""));
        if (t) { t.click(); return true; }
        return false;
      });
      if (clicked) { await p.waitForTimeout(2500); break; }
      await p.waitForTimeout(1000);
    }
    await p.waitForFunction(
      () => {
        const a = window.app;
        return !!(a && a.vault && a.workspace && a.plugins && a.plugins.plugins && a.workspace.layoutReady !== false);
      },
      undefined,
      { timeout: 120000, polling: 500 }
    );
    await p.waitForTimeout(1500);
  }

  ev(fn, arg) { return this.page.evaluate(fn, arg); }

  // ---------- 插件 / 应用状态 ----------
  async status() {
    return this.ev(() => {
      const app = window.app;
      const p = app?.plugins?.plugins?.["obsidian-better-canvas"];
      return {
        obsidianVersion: (() => {
          try {
            if (typeof process !== "undefined" && process.versions && process.versions.obsidian) {
              return process.versions.obsidian;
            }
          } catch { /* fall through */ }
          return app?.getVersion?.() ?? app?.appVersion ?? null;
        })(),
        vaultPath: app?.vault?.adapter?.basePath ?? null,
        pluginLoaded: !!p,
        vaultName: app?.vault?.getName?.(),
        commands: Object.keys(app?.commands?.commands || {})
          .filter((c) => c.startsWith("obsidian-better-canvas:"))
          .sort(),
        activeFile: app?.workspace?.getActiveFile?.()?.path ?? null,
        canvasLeaves: app?.workspace?.getLeavesOfType("canvas")?.length ?? 0,
      };
    });
  }

  // ---------- Vault 文件 ----------
  readDisk(rel) { return fs.readFileSync(path.join(this.vault, rel), "utf8"); }
  readDiskJson(rel) { return JSON.parse(this.readDisk(rel)); }
  writeDisk(rel, content) {
    const full = path.join(this.vault, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  exists(rel) { return fs.existsSync(path.join(this.vault, rel)); }

  // ---------- Canvas ----------
  async openCanvas(rel, data) {
    if (data !== undefined) this.writeDisk(rel, JSON.stringify(data, null, 2));
    return this.ev(async (rel) => {
      const app = window.app;
      const af = app.vault.getAbstractFileByPath(rel);
      if (!af) throw new Error("canvas file not found: " + rel);
      await app.workspace.getLeaf(false).openFile(af, { active: true });
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }, rel).catch(async () => {
      await this.ev(async (rel) => {
        const app = window.app;
        const af = app.vault.getAbstractFileByPath(rel);
        await app.workspace.getLeaf(false).openFile(af, { active: true });
      }, rel);
      await this.page.waitForTimeout(1500);
      return true;
    });
  }

  async canvasState() {
    return this.ev(() => {
      const app = window.app;
      const view = app.workspace.activeLeaf?.view;
      const c = view?.canvas;
      if (!c) return { ok: false, viewType: view?.getViewType?.() };
      let data = {};
      try { data = JSON.parse(JSON.stringify(c.getData())); } catch (e) { return { ok: false, err: e.message }; }
      const sel = c.selection ? Array.from(c.selection.values()).map((s) => s.id ?? s.node?.id) : [];
      return {
        ok: true,
        data,
        selected: sel,
        nodes: (data.nodes || []).map((n) => ({
          id: n.id, type: n.type, x: n.x, y: n.y, w: n.width, h: n.height,
          file: n.file, url: n.url, color: n.color, label: n.label,
        })),
        edges: data.edges || [],
      };
    });
  }

  async selectedIds() {
    return this.ev(() => {
      const c = window.app.workspace.activeLeaf?.view?.canvas;
      if (!c?.selection) return [];
      return Array.from(c.selection.values()).map((s) => s.id ?? s.node?.id);
    });
  }

  async fitView() {
    const r = await this.ev(() => {
      const c = window.app.workspace.activeLeaf?.view?.canvas;
      if (!c) return { ok: false };
      try {
        const fn = c.zoomToFit || c.fitToScreen || c.zoomToSelection;
        if (typeof fn === "function") { fn.call(c); return { ok: true, via: "api" }; }
      } catch { /* fall through */ }
      try {
        const nodes = c.data?.nodes || [];
        if (!nodes.length) return { ok: false, err: "no nodes" };
        const minX = Math.min(...nodes.map((n) => n.x));
        const minY = Math.min(...nodes.map((n) => n.y));
        const maxX = Math.max(...nodes.map((n) => n.x + (n.width || 0)));
        const maxY = Math.max(...nodes.map((n) => n.y + (n.height || 0)));
        const wrap = c.wrapperEl.getBoundingClientRect();
        const pad = 60;
        const zoom = Math.min(1.5, Math.max(0.05,
          Math.min((wrap.width - pad * 2) / Math.max(1, maxX - minX),
                   (wrap.height - pad * 2) / Math.max(1, maxY - minY))));
        if (typeof c.tZoom === "function") {
          c.tZoom(zoom, { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2 });
        } else {
          c.zoom = zoom;
          c.x = -minX * zoom + wrap.width / 2;
          c.y = -minY * zoom + wrap.height / 2;
          c.requestFrame?.();
        }
        return { ok: true, via: "manual" };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    await this.page.waitForTimeout(900);
    return r;
  }

  async settle(maxMs = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const busy = await this.ev(() => {
        const c = window.app.workspace.activeLeaf?.view?.canvas;
        const w = c?.wrapperEl;
        if (!w) return false;
        // 注意：'node-insert-event' 在 Obsidian 1.14.4 里是常驻 class，不是动画标记。
        return w.classList.contains("mod-ani") || w.classList.contains("mod-animating") || !!c.isDragging;
      }).catch(() => false);
      if (!busy) break;
      await this.page.waitForTimeout(150);
    }
    await this.page.waitForTimeout(250);
    return true;
  }

  // 真实鼠标点击节点（setup 用），失败时先 fitView 再重试。
  async selectNode(id, additive = false) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await this.ev((id) => {
        const c = window.app.workspace.activeLeaf?.view?.canvas;
        const entry = c?.nodes?.get?.(id);
        const el = entry?.nodeEl || entry?.el;
        if (!el) return null;
        el.scrollIntoView?.({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, id);
      if (!box) {
        await this.fitView().catch(() => {});
        await this.settle(1500);
        continue;
      }
      if (additive) await this.page.keyboard.down("Shift");
      await this.page.mouse.click(box.x, box.y);
      if (additive) await this.page.keyboard.up("Shift");
      await this.page.waitForTimeout(250);
      const sel = await this.selectedIds();
      if (sel.includes(id)) return { ok: true, selected: sel };
    }
    return { ok: false, selected: await this.selectedIds(), err: "click did not select " + id };
  }

  // ---------- 命令 / 截图 / 等待 ----------
  async cmd(id) {
    const full = id.includes(":") ? id : "obsidian-better-canvas:" + id;
    return this.ev(async ({ full }) => {
      const app = window.app;
      const c = app.commands.commands[full];
      if (!c) return { ok: false, err: "command not registered: " + full };
      try {
        const r = c.callback ? await c.callback() : undefined;
        return { ok: true, ret: r === undefined ? null : String(r) };
      } catch (e) {
        return { ok: false, err: e.message, stack: (e.stack || "").split("\n").slice(0, 3).join(" | ") };
      }
    }, { full });
  }

  async shot(name) {
    fs.mkdirSync(this.out, { recursive: true });
    const p = path.join(this.out, `${name}.png`);
    await this.page.screenshot({ path: p });
    return p;
  }

  // 持久化断言必须用它：Obsidian 保存 Canvas 有 1-2 秒防抖，不能只看内存状态。
  async waitSaved(rel, predicate, timeout = 15000) {
    const t0 = Date.now();
    let data = null;
    while (Date.now() - t0 < timeout) {
      try { data = this.readDiskJson(rel); } catch { data = null; }
      if (data && predicate(data)) return { ok: true, data, waitedMs: Date.now() - t0 };
      await this.page.waitForTimeout(300);
    }
    return { ok: false, data, waitedMs: Date.now() - t0 };
  }

  async notices() {
    return this.ev(() => Array.from(document.querySelectorAll(".notice")).map((n) => n.innerText.trim()));
  }

  async close() { try { await this.browser.close(); } catch {} }
}

async function connect(port, vault, outDir) {
  const bc = new BC(port, vault, outDir);
  await bc.connect();
  return bc;
}

module.exports = { BC, connect };
