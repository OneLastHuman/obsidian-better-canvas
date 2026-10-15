# 离线沙盒运行指南（无网络、无 Obsidian 环境）

本文说明如何把一个「离线包」带进没有任何网络访问、也没有安装 Obsidian 的沙盒环境（例如云端 Agent 容器），在那里跑完整的单元测试层和一次真实 Obsidian 的端到端最小回归。

核心思路：**沙盒不需要下载任何东西**。仓库、`node_modules` 和 Obsidian AppImage 都由联网侧打包，用户手动上传进去。

- 打包脚本：`scripts/sandbox/build-bundle.sh`
- 沙盒内运行脚本：`scripts/sandbox/run-bundle.sh`
- e2e smoke：`scripts/sandbox/e2e/smoke.js`（真实鼠标点击 + 真实命令 + 磁盘断言）

## 前置条件

联网侧（打包机）：

- 有网络（或已有完整 `node_modules`），Linux x64。
- Obsidian AppImage 可选。没有它时，沙盒里的 e2e 层会如实报告 BLOCKED，单元层不受影响。

沙盒侧（目标环境）：

- Node ≥ 20、npm；能执行本地二进制；装有 Xvfb（跑 e2e 需要，探测命令：`command -v Xvfb`）。
- 允许上传文件（大小取决于包是否附带 AppImage，见下）。

## 步骤 1：联网侧打包

```bash
npm install          # 首次需要；之后可复用本地 node_modules
scripts/sandbox/build-bundle.sh --appimage /path/to/Obsidian.AppImage
```

产物：

- `dist/sandbox-bundle-<short-sha>.tar.gz`
  - 不含 AppImage：约 20 MB；含 AppImage：约 150 MB。
  - 内容：HEAD 完整 checkout + `node_modules` + `SANDBOX-MANIFEST.json`（commit、`mainJsSha256`、AppImage 校验和）+ `START-HERE.md`。
- 只想跑单元层时不加 `--appimage`。

Obsidian AppImage 从 <https://obsidian.md/download> 获取；本仓库 `docs/e2e-acceptance` 证据运行使用的是 **1.14.4**。

## 步骤 2：上传到沙盒

把下面文件加入沙盒会话（ChatGPT 类容器直接附件添加即可）：

1. `dist/sandbox-bundle-<short-sha>.tar.gz`
2. `Obsidian.AppImage`（如果打包时没附带）

## 步骤 3：沙盒内运行

```bash
tar xzf sandbox-bundle-<short-sha>.tar.gz
cd better-canvas-sandbox
bash scripts/sandbox/run-bundle.sh --appimage ./Obsidian.AppImage
```

不带 AppImage 时：`bash scripts/sandbox/run-bundle.sh --appimage /nonexistent` 会得到单元层 PASS + e2e BLOCKED；也可以直接用 `--skip-e2e` 跳过 e2e。

退出码：`0` 全部通过；`1` 有阶段 FAIL；`3` 单元层通过但 e2e BLOCKED。

运行时间参考：单元层约 1 分钟；e2e 首次解包 AppImage 约 30 秒，启动 Obsidian 约 15–30 秒，smoke 约 30 秒。

## 步骤 4：取回证据

结果都在 `sandbox-out/`：

| 路径 | 内容 |
| --- | --- |
| `summary.json` | commit、两层各自的状态（PASS / FAIL / BLOCKED / SKIPPED） |
| `logs/` | `typecheck.log`、`vitest.log`、`build.log`、`obsidian.log`、`xvfb.log`、`appimage-extract.log` |
| `e2e/results.json` | 每条检查的 PASS/FAIL、被测 commit 与 `mainJsSha256`、控制台错误列表 |
| `e2e/*.png` | 画布打开时、创建子节点后的截图 |

打包带回：`tar czf sandbox-out.tgz sandbox-out`。

## 给沙盒 Agent 的指令模板

```
我在本会话上传了 better-canvas-sandbox 离线包（和一个 Obsidian.AppImage）。请执行：

1. tar xzf <包名>.tar.gz && cd better-canvas-sandbox
2. bash scripts/sandbox/run-bundle.sh --appimage <AppImage 路径>
3. 把 sandbox-out/summary.json 和 sandbox-out/e2e/results.json 的完整内容贴出来；
   若失败或受阻，再贴上 sandbox-out/logs/ 里相关日志的末尾。
4. 不要修改脚本、配置或断言来让结果变绿；不要重试已标记 BLOCKED 的步骤。
   退出码 0=全部通过，1=有阶段 FAIL，3=e2e BLOCKED。每一层如实标注 PASS / FAIL / BLOCKED。
5. 最后执行 tar czf sandbox-out.tgz sandbox-out，把产物提供给我下载。
```

## smoke 实际做了什么

1. 连接真实 Obsidian 的 CDP，等待应用与插件就绪；
2. 确认插件加载、Better Canvas 命令已注册；
3. 写入并打开一个 2 节点 1 连线的 `smoke.canvas`；
4. **真实鼠标点击**选中节点，执行真实命令 `create-child-node`；
5. 断言内存中新增子节点与连线；
6. 轮询磁盘上的 `.canvas` JSON，断言变更被持久化、原节点未被破坏；
7. 截图留档；未捕获异常为零才算通过。

## 这层证明什么、不证明什么

- 它运行的是**真实 Obsidian + 真实插件构建**，属于 [测试规范](TESTING.md) 的 Tier 4 最小回归，证据按 §6 的要求记录（commit、`mainJsSha256`、磁盘结果、截图、错误）。
- 它**不覆盖**插件的全部功能面。完整的桌面验收仍需按 §5 回归清单逐项执行；本 smoke 只证明「插件能在真实宿主中加载、响应命令、正确落盘」这条基线。
- 若 e2e 层 BLOCKED，**不要**把单元层结果表述为宿主兼容性通过。

## 限制与排查

- **上传限制**：含 AppImage 的包约 150 MB；超限时分开上传两个文件。
- **没有 Xvfb**：e2e 会被标记 BLOCKED；纯单元层不受影响。
- **Electron 启动失败**：查看 `sandbox-out/logs/obsidian.log`。脚本已固定 `--no-sandbox --disable-gpu --disable-dev-shm-usage`（容器内运行 Electron 的最低要求）。
- **会话时长/进程策略**：某些沙盒会限制长驻后台进程；smoke 全程约 2 分钟，正常环境足够。
- **平台**：bundle 里的 `node_modules` 按打包机平台生成（Linux x64）。跨平台时请在目标平台重新打包。
- **溯源**：bundle 里的 `SANDBOX-MANIFEST.json` 与测试 Vault 里的 `.bc-build-info.json` 记录同一 commit 和 `mainJsSha256`，报告结果时必须引用它们。
