# 界面预览截图 / README Screenshot Provenance

本目录中的 PNG 是 [README 界面预览](../../README.md#界面预览)使用的真实截图，不是示意图。

## 采集环境

| 项目 | 值 |
| --- | --- |
| 应用 | Obsidian 桌面版 **1.14.4**（官方 AppImage，Electron，Linux） |
| 插件构建 | 仓库 `main` 分支 `d2fef6b`（`test: cover MCP stdio session reset and process cleanup (#57)`） |
| `main.js` SHA-256 | `d10d11e64ea9ab315f204466954aff9fb76bdd079d0fd5b3c24588655e87f0d2`（与该 commit 提交的 `main.js` 一致） |
| 窗口 | 1600 × 1000，默认主题，未安装其他第三方插件 |
| 数据 | 全部来自合成的临时 Vault（`demo/` 下的示例 `.canvas` 与 Markdown），无真实笔记、凭据或 API Key |
| AI 回答 | 由本机 `127.0.0.1` 上的 mock OpenAI-compatible 服务返回，未访问外网、未使用真实模型 |

## 每张截图实际执行的操作

| 文件 | 操作路径 |
| --- | --- |
| `canvas-enhancements.png` | 打开示例 `.canvas` → 用插件命令“设置节点颜色 / 设置节点形状 / 设置节点边框 / 设置所选节点文字对齐”逐个设置 → 悬停在节点上显示 AI / Img / 卡片 / 模型 按钮 |
| `mind-map.png` | 在空白示例画布上用“创建子节点 / 创建同级节点”命令生成 9 个节点的树 → 选中根节点执行“自动整理思维导图”（提示“已整理 9 个节点。”） |
| `ai-workflow.png` | 选中“文档与截图”节点 → 执行“向 AI 提问所选节点” → 在弹窗中提交问题 → 流式生成的回答节点出现在画布上并与来源节点相连 |
| `export.png` | 在样式画布上执行“导出 Canvas 全内容 PNG（按所有节点边界）” → 在 Obsidian 中打开导出的 PNG |

所有命令都通过 Obsidian 的真实命令面板接口调用，弹窗通过真实 DOM 点击确认，画布内容用真实鼠标点击选择；断言对象是磁盘上真实的 `.canvas` 文件与导出的 PNG。

## 已知限制

- 截图只证明上述路径在 Obsidian 1.14.4 桌面版上可见且可用，不代表其他版本、主题或移动端的外观与行为一致。功能覆盖状态见 [功能整合矩阵](../INTEGRATION_MATRIX.md)。
- 思维导图截图使用命令面板入口生成节点树；键盘 `Tab` / `Enter` 快捷键走的是同一段代码（`src/main.ts` 的 `createChildNode` / `createSiblingNode`），但本次采集没有用快捷键逐键录制。
- AI 截图的回答来自 mock 服务，只用于展示插件的界面与数据流，不代表任何真实模型的质量。

## 如何重新采集

1. `npm run build` 生成 `main.js`（本目录截图对应 `main` 分支的生产构建）。
2. 用一个临时 Vault 启动 Obsidian 桌面版，把 `main.js`、`manifest.json`、`styles.css` 放进 `<Vault>/.obsidian/plugins/obsidian-better-canvas/` 并启用插件。
3. 按上表执行同样的命令，截图覆盖本目录同名文件。