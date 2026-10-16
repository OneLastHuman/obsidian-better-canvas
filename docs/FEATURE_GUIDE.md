# 功能指南

本文按工作场景介绍 Better Canvas 的主要功能。具体实现状态和仍待验证的兼容性差异，请参阅 [功能整合矩阵](INTEGRATION_MATRIX.md)。

## 设置中心与搜索

- 设置中心的「查找设置」支持普通设置项、AI 服务商卡片、分类标题与描述，以及独立操作按钮。搜索「AI 服务」或「添加 AI 服务商」可以定位 AI 服务分类和添加入口。

## 1. Canvas 编辑与组织

### 节点与连线

- **节点外观：** 设置颜色、形状、边框、文本对齐和 CSS 类。
- **连线样式：** 设置颜色、线型、箭头，翻转关联边的方向，并选择 direct、square 或 A-star 路径。
- **布局与交互：** 网格对齐、自动调整文本节点尺寸、层级排序、焦点模式和交互锁定；支持 floating edge 自动重定位。
- **CSS 样式预设：** 通过已加载的 CSS snippet 为节点或连线定义可重复应用的属性。格式和示例见 [自定义样式预设指南](CUSTOM_STYLE_PRESETS.md)。

### 搜索、导航与批量操作

- 搜索 Canvas 中的文本、文件路径和链接。
- 浏览当前 Canvas 的外链与反向链接，并将唯一目标批量添加为文件、网页或文本节点。
- 按左、右、上、下方向克隆所选节点并自动连接；可保留原节点内容、样式和扩展属性。
- 对多节点选区做水平或垂直翻转，也可以交换两个节点的中心位置。
- 一次选中 Canvas 中的全部连线；缩放以适应整个画布，并恢复操作前的选区。
- 保存可复用的节点模板，并按节点顺序进入演示模式。

### 分组、Portal、元数据与导出

- 创建独立分组并折叠或展开分组；将选区封装为单独的 Canvas。
- 创建 Canvas Portal，查看并编辑另一个 Canvas 的镜像内容。Portal 的适用范围与限制见[已知限制](KNOWN_LIMITATIONS.md)。
- 编辑 Canvas frontmatter：逐属性新增、修改或删除，也可以编辑完整 JSON 对象。
- 导出 JSON Canvas；导出当前视口、全部内容或仅选中节点的 PNG/SVG。选区导出只包含所选节点及其内部连线。

静态 SVG 渲染可处理常见节点形状、文字、连线、箭头及 direct、square、A-star 路由。导出会在体积预算内嵌入 PNG/JPEG/WebP/GIF 图片与 PDF 页面栅格预览。固定 PDF 页面使用对应页码，普通 PDF 节点默认预览第一页。常见 Markdown 粗体、斜体、链接、标题、任务清单和列表会转换为静态图像可读文本；交互式 HTML 不会执行，代码会以文本形式显示。复杂画布的导出效果仍取决于节点数量、资源大小和 Obsidian 渲染行为。

## 2. 思维导图

- 为选中节点创建子节点、同级节点或游离节点。
- 将 Markdown 文件中的 H1 标题拆分为相关联的节点。
- 选择节点树，并按 LR、RL、TB 或 BT 方向进行基础自动布局。
- 使用快捷键创建节点或选择相邻节点；Tab、Enter、Alt + 方向键和 Ctrl/Cmd + 方向键可以分别关闭，避免与个人热键冲突。
- 按指定方向克隆并连接节点，同时保留原内容、样式和扩展属性。
- 生成思维导图结构和复习闪卡。闪卡默认保存为关联 Canvas 节点；也可导出为 Obsidian Spaced Repetition 兼容的 Markdown 卡组。卡组支持主题标签、目录设置和防覆盖的重名文件处理。

快捷键列表见 [README](../README.md#常用快捷键)。可在 **设置 → Better Canvas → 画布** 中分别关闭 Tab、Enter、Alt + 方向键和 Ctrl/Cmd + 方向键快捷键，以免与其他插件或个人热键冲突。

## 3. AI 工作流

### 节点问答与生成

- 根据选中节点及其相邻关联内容提问，并把回答保存为连接到原节点的新节点。
- 卡片悬停工具栏提供 AI 问答、图片生成、闪卡和模型选择快捷入口；AI 生成的节点可以重新生成。命令面板和右键菜单同样可用。
- 支持流式生成、停止生成、重新生成，以及按节点覆盖服务或模型配置。
- 保存多套命名系统提示词，选择并应用，也可通过同名配置更新或删除已有提示词。
- 通过配置的服务生成图片，并将图片保存到 Vault 附件目录后插入 Canvas。
- 导入可访问的网页正文和 YouTube 字幕作为后续整理与分析素材。
- 对选定 Vault 文件夹内的 Markdown 文件批量执行同一条 Prompt；每次最多 20 篇，并创建源文件与结果的关联节点。发送文件内容前需要选择文件夹并确认。

### 模型与服务

- 原生 API profile 支持 OpenAI-compatible、Anthropic Messages 和 Google Gemini。
- 支持从 OpenAI-compatible、Anthropic 和 Gemini 模型端点发现可用模型；端点不支持列表查询时，可手动输入模型名。
- 每个 profile 可单独设置 Temperature、最大输出 token 数和高级请求参数 JSON。高级参数仅用于 API 后端的文本请求，并按相应协议合并；核心请求字段和认证字段受保护。Temperature 范围随协议变化（OpenAI 兼容 / Gemini 为 0 到 2，Anthropic 为 0 到 1），切换协议时界面会同步更新并调整超出新上限的已保存值。
- 可主动探测服务的文本请求与图片输入能力。探测需用户确认，最多发送两次小型 API 请求，并保存当前 provider/model 的结果。图片输入请求成功不代表模型确实理解了图片，也不能证明图片生成、PDF、视频、URL context 或搜索 grounding 等能力。

详细配置见 [AI 与 MCP 配置指南](AI_SETUP.md)。

### MCP 工具、资源与提示模板

支持远程 MCP Streamable HTTP、旧式 SSE 和本地 MCP stdio。除工具调用外，还可列出分页资源（resources/list）、读取资源（resources/read）、发现提示模板（prompts/list）并带参数解析模板（prompts/get）。文本结果会保存为关联 Canvas 节点，支持的 PNG/JPEG/WebP/GIF 图片会保存为 Vault 附件并创建关联文件节点。

本地 stdio 根据 command、args、env、cwd 配置启动进程；会话按配置复用，最多缓存 4 个本地服务会话，空闲 5 分钟后关闭，插件卸载时清理。工具执行前须检查名称和参数，并仅连接可信服务。

工具参数、提示模板参数以及 styleAttributes / frontmatter 等 JSON 输入框要求 JSON object。输入不是有效 JSON 时弹窗保持打开并保留已输入文本，显示插件措辞的错误提示（不显示解析器原文），修正后可直接重新提交。

### 本地 CLI 与多模态内容

- **Codex CLI：** 桌面端可调用本机已安装并登录的 Codex CLI，在只读沙盒和临时工作目录中分析选中节点及相邻上下文，结果保存为关联节点。
- **OpenCode ACP：** 桌面端可通过 `opencode acp` 与 OpenCode 的模型及登录配置进行文本问答和闪卡生成，无需另填文本 API Key。
- **PDF：** 固定 PDF 页面可提取文本，并将页面栅格图像发送给支持视觉输入的模型。支持按页码或页码范围进行批量 OCR，每批最多 20 页，并为每页保存独立结果节点。
- **Gemini 视频上下文：** Gemini profile 可尝试分析公开视频；视频、模型和账号必须支持对应能力。
- **HTML 预览：** AI 或手写节点中的 HTML 代码块可在隔离的 sandbox iframe 中预览交互页面。

本机 CLI 使用各自的模型服务配置，不保证离线处理。OpenCode ACP 当前只接受文本输入；若所选上下文包含图片或文件，需切回 API 后端。所有 AI 能力都受服务商 API、模型权限和内容可访问性影响。

## 4. 相关文档

- [安装与构建指南](INSTALLATION.md)
- [AI 与 MCP 配置指南](AI_SETUP.md)
- [已知限制与安全注意事项](KNOWN_LIMITATIONS.md)
- [功能实现与验证矩阵](INTEGRATION_MATRIX.md)
