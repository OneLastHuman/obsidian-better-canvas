"use strict";

/**
 * 端到端 smoke：真实 Obsidian + 真实插件 + 真实鼠标事件 + 真实命令注册表；
 * 断言对象是磁盘上的 .canvas JSON，而不是只看内存状态。
 *
 * 用法：node smoke.js --port <cdp 端口> --vault <测试 Vault> --out <输出目录>
 * 退出码：全部通过为 0，否则为 1。结果写入 <out>/results.json。
 */

const fs = require("fs");
const path = require("path");
const { connect } = require("./bc");

function parseArgs(argv) {
  const args = { out: "e2e-out", timeout: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") args.port = argv[++i];
    else if (a === "--vault") args.vault = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  if (!args.port || !args.vault) {
    console.error("用法: node smoke.js --port <cdp> --vault <vault> [--out <dir>]");
    process.exit(2);
  }
  return args;
}

function readBuildInfo(vault) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vault, ".bc-build-info.json"), "utf8"));
  } catch {
    return null;
  }
}

function readBundleManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../SANDBOX-MANIFEST.json"), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  const results = {
    startedAt: new Date().toISOString(),
    bundle: readBundleManifest(),
    plugin: readBuildInfo(args.vault),
    checks: [],
    screenshots: [],
    consoleErrors: [],
    pageErrors: [],
    status: "FAIL",
  };

  let allOk = true;
  const check = (name, ok, detail) => {
    results.checks.push({ name, ok: !!ok, detail: detail ?? null });
    console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? " -- " + detail : ""}`);
    if (!ok) allOk = false;
  };

  const bc = await connect(args.port, args.vault, args.out);

  try {
    // 1. 插件与命令（先核验连到的是本次测试的 Vault，防止和其他实例串台）
    const status = await bc.status();
    const expectedVault = path.resolve(args.vault);
    const actualVault = status.vaultPath ? path.resolve(status.vaultPath) : "";
    check("connected to the expected vault", actualVault === expectedVault, `actual=${status.vaultPath ?? "unavailable"}`);
    if (actualVault !== expectedVault) {
      throw new Error(`wrong vault: refusing to continue (expected ${expectedVault}, got ${status.vaultPath})`);
    }
    check("plugin loaded", status.pluginLoaded, `obsidian=${status.obsidianVersion}`);
    check(
      "better-canvas commands registered",
      status.commands.includes("obsidian-better-canvas:create-child-node")
        && status.commands.includes("obsidian-better-canvas:create-sibling-node"),
      `${status.commands.length} commands`
    );

    // 2. 打开一个真实 Canvas
    const fixture = {
      nodes: [
        { id: "a", type: "text", x: -160, y: 0, width: 240, height: 120, text: "Smoke A" },
        { id: "b", type: "text", x: 420, y: 0, width: 240, height: 120, text: "Smoke B" },
      ],
      edges: [
        { id: "e1", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" },
      ],
    };
    await bc.openCanvas("smoke.canvas", fixture);
    await bc.settle();
    const s1 = await bc.canvasState();
    check(
      "canvas opens (2 nodes / 1 edge)",
      s1.ok && s1.nodes.length === 2 && s1.edges.length === 1,
      JSON.stringify({ ok: s1.ok, nodes: s1.nodes?.length, edges: s1.edges?.length })
    );
    results.screenshots.push(await bc.shot("00-canvas-open"));

    // 3. 真实点击选中 + 执行真实命令
    const sel = await bc.selectNode("a");
    check("node selected via real click", sel.ok && sel.selected.includes("a"), JSON.stringify(sel.selected));

    const res = await bc.cmd("create-child-node");
    check("command create-child-node ran", res.ok, res.err ?? null);
    await bc.settle();

    const s2 = await bc.canvasState();
    const newNode = (s2.nodes || []).find((n) => n.id !== "a" && n.id !== "b");
    check(
      "child node added (3 nodes)",
      s2.ok && s2.nodes.length === 3 && !!newNode,
      newNode ? `new=${newNode.id}` : "no new node"
    );
    const childEdge = (s2.edges || []).find((e) => e.fromNode === "a" && e.toNode === newNode?.id);
    check("child edge created (a -> child)", !!childEdge);

    // 4. 磁盘持久化（Obsidian 保存有防抖，必须轮询磁盘）
    const saved = await bc.waitSaved("smoke.canvas", (d) => {
      const nodes = d.nodes || [];
      const edges = d.edges || [];
      return nodes.length === 3 && edges.some((e) => e.fromNode === "a" && e.toNode === newNode?.id);
    });
    check("canvas JSON persisted to disk", saved.ok, `waitedMs=${saved.waitedMs}`);
    if (saved.ok) {
      const texts = saved.data.nodes.filter((n) => n.type === "text").map((n) => n.text);
      check(
        "original nodes preserved",
        texts.includes("Smoke A") && texts.includes("Smoke B"),
        JSON.stringify(texts)
      );
    }

    results.screenshots.push(await bc.shot("01-after-create-child"));

    // 5. 运行时错误
    check("no uncaught page errors", bc.pageErrors.length === 0, bc.pageErrors.join(" | ") || null);
    results.consoleErrors = bc.errors.slice();
    if (bc.errors.length) {
      console.log(`[info] console errors recorded: ${bc.errors.length}`);
    }
  } finally {
    results.pageErrors = bc.pageErrors.slice();
    results.finishedAt = new Date().toISOString();
    results.status = allOk ? "PASS" : "FAIL";
    fs.writeFileSync(path.join(args.out, "results.json"), JSON.stringify(results, null, 2) + "\n");
    await bc.close();
  }

  console.log(allOk ? "SMOKE PASS" : "SMOKE FAIL");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE CRASH:", (err && err.stack) || err);
  process.exit(1);
});
