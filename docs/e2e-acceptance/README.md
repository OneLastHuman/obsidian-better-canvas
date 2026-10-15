# 端到端验收证据 / End-to-End Acceptance Evidence

本目录保存 Better Canvas 端到端验收测试产出的界面截图，用于支撑对应的 GitHub Issue。

## 测试方式

- **真实 Obsidian 1.14.4 桌面版**（官方 AppImage，Electron，Linux，Xvfb / Xvwayland 虚拟显示器）
- **真实插件进程**，通过 Chrome DevTools Protocol 连接
- 全部使用**真实鼠标事件与真实键盘事件**驱动界面，没有 mock Obsidian
- 断言对象是**磁盘上的真实文件**（`.canvas` JSON、导出的 PNG/SVG），而不只是内部状态

## 溯源

`manifest.json` 记录了本批截图对应的被测 commit 与插件构建哈希：

- `testedCommit` — 被测仓库 commit
- `mainJsSha256` — 该 commit 下 `main.js` 的 SHA-256
- `obsidian` — 被测 Obsidian 版本

测试脚本从一个**冻结的插件快照**安装插件（而不是直接取工作区），因此测试期间上游推送不会改变被测对象；每次会话在测试 Vault 的 `.bc-build-info.json` 中也记录同样的溯源信息。

## 目录

子目录名即对应的 GitHub Issue 编号，图片按 `01-`、`02-` 顺序编号，与 Issue 正文中的顺序一致。

| Issue | 内容 |
|---|---|
| `25` | AI 生成失败后残留空占位节点 |
| `26` | 缩放断点把对数缩放值当作线性比例 |
| `27` | 只读模式未拦截连线操作 |
| `30` | 导出 Canvas JSON 丢失连线字段 |
| `32` | Portal 区域内无法创建节点 |
| `33` | 自定义样式类无法清除 |
| `34` | 视口 PNG 未实现透明背景 |
| `46` | 视口 SVG 保留可执行 iframe |
| `47` | 视口 SVG 烘焙了界面控件 |
| `48` | styleAttributes 的 shape/border 不生效 |
| `52` | 拖动未选中的 Portal 框损坏源文件 |
| `53` | 关闭 Portal 后镜像仍留在界面 |
| `79` | 网页导入的内网防护可被 IPv4-mapped IPv6 绕过 |
| `84` | 命令面板双层前缀 + 重复条目 |
| `86` | PDF 分页卡片完全空白（重复渲染） |
| `88` | 非图片负载被当作 .png 写入 Vault |
| `89` | Vault 根目录封装选区生成 `//name.canvas` |
| `90` | 本机 stdio MCP 传输无法启动子进程 |
| `91` | 文件节点没有 HTML 预览 |
| `105` | 删除 AI 服务商前需要确认，并提示当前服务的切换目标 |

## 隐私

所有截图均来自**合成的测试 Vault**（本仓库 `fixtures/` 中的种子内容与测试过程生成的节点），
不包含任何真实 Vault 数据、凭据或 API Key。