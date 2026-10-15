# Issue 105 — AI 服务商删除确认

- 对应问题：[GitHub Issue #105](https://github.com/OneLastHuman/obsidian-better-canvas/issues/105)
- 被测 Obsidian：1.14.4 桌面版（Linux，隔离 Xvfb 会话）
- 测试方式：使用 Playwright 经 CDP 操作真实 Obsidian 插件 UI；不是 mock UI。
- 测试构建：由修复分支工作区构建；基础 commit 为 `1c31be8be81a00195b428ad8520c41b09eb83852`。
- 构建产物 `main.js` SHA-256：`2d086fd8f17d4f0790838cc60b7b85404ad27d05be06f7a84a93a5e3b50f25da`
- 测试结果：16 项端到端检查全部通过。测试详情见对应会话生成的 `results.json`（包括删除取消、确认删除、切换服务商、设置落盘和末个服务商保护）。
- 安全边界：仅使用独立的临时 Vault 和 `127.0.0.1:9` 测试地址；没有发出供应商 API 请求，没有使用真实密钥。

## 截图

1. `01-confirm-delete-desktop.png`：删除当前服务商时的原生确认框，包含被删除名称和切换目标。
2. `02-provider-before-delete.png`：确认操作前，临时服务商在列表中并标记为当前使用。
3. `03-provider-after-delete.png`：确认删除后，列表只保留默认服务商。
