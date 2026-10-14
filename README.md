# Obsidian Better Canvas

把画布增强、思维导图工作流和 AI 辅助思考集中到一个 Obsidian 插件中。

> 当前版本是可继续扩展的第一版，不代表三个上游项目所有功能都已逐项达到完全兼容。代码以独立实现为主，优先稳定接入统一的 Canvas 数据层。

## 当前实现

### Canvas 增强
- 通过命令面板和节点右键菜单触发常用操作。
- 搜索当前画布中的文本、文件路径和链接。
- 保存/插入节点模板。
- 简易演示模式，可按节点顺序逐张查看。

### 思维导图
- 创建子节点、同级节点和游离节点。
- `Tab` 创建子节点，`Enter` 创建同级节点；方向键导航使用 `Alt + ↑/↓/←/→`。
- 将所选 Markdown 文件的 H1 标题拆分为关联节点。
- 对所选节点及其后代执行 LR、RL、TB、BT 自动布局。

### AI 工作流
- 基于所选节点及直接连接的节点提问，并把回答保存为新的关联节点。
- 生成复习闪卡内容。
- 通过兼容 OpenAI Chat Completions / Images API 的端点进行文本和图像生成。
- 图片保存到 Vault 中配置的附件目录，再作为文件节点连接到原节点。
- API 地址、模型、密钥和系统提示词均在插件设置中配置。密钥只保存在本地 Obsidian 插件设置中，不写入仓库。

## 安装（开发版）

1. 克隆仓库：`git clone https://github.com/OneLastHuman/obsidian-better-canvas.git`
2. 在项目目录执行 `npm install`。
3. 执行 `npm run build`。
4. 将生成的 `main.js`、`manifest.json` 和 `styles.css` 放到 Vault 的 `.obsidian/plugins/obsidian-better-canvas/` 目录。
5. 在 Obsidian 的社区插件设置中启用 **Better Canvas**。

## AI 配置

在 **设置 → Better Canvas** 中配置兼容 OpenAI 的 API 地址和模型，例如：

- Base URL：`https://api.openai.com/v1`
- Chat model：`gpt-4o-mini`
- Image model：填入所使用服务支持的图像模型

不同服务对图像生成接口、请求格式及模型名称的支持可能不同。若只用画布和思维导图功能，可以不配置 API Key。

## 快捷键

- `Tab`：选中节点后创建子节点
- `Enter`：选中节点后创建同级节点
- `Alt + ↑/↓/←/→`：沿空间位置选择相邻节点

编辑节点文字时这些快捷键不会被插件拦截。快捷键行为使用 Obsidian Canvas 内部接口，因此 Obsidian 大版本升级后需回归测试。

## 上游项目与致谢

本项目的功能方向参考了以下项目；此仓库当前采用独立实现，没有直接复制它们的实现代码：

- [Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas) — Canvas 增强、节点样式、工作流工具。上游声明 GPL-3.0。
- [Canvas MindMap](https://github.com/Quorafind/Obsidian-Canvas-MindMap) — 子节点/同级节点、方向导航和树布局。其 `package.json` 声明 MIT；检查时仓库根目录未发现 LICENSE 文件。
- [Obsidian AI Canvas](https://github.com/testy-cool/obsidian-ai-canvas) — 在 Canvas 上进行 AI 问答及图像生成。上游 LICENSE 声明 MIT。

该项目当前以 GPL-3.0-or-later 发布。若未来直接引入上游代码或资源，会在引入前逐项核对许可证、保留版权声明并补充第三方许可文件。

## 当前边界 / 下一步

第一版优先提供单插件框架与上述核心工作流。Advanced Canvas 的元数据缓存/反向链接、PDF 标注、Portal、复杂边样式和导出选项，以及 AI Canvas 的多供应商注册、MCP 工具、YouTube/网页上下文摄取、流式生成和多模态流程，仍需逐项迁移和测试。请通过 GitHub Issues 记录需要优先完成的功能。

## 开发

- `npm run dev`：开发构建
- `npm run build`：生产构建

提交前请在目标 Obsidian 版本中测试 Canvas 数据保存、键盘操作、节点布局和 AI API 兼容性。

## 更多整合功能

整合版目前包括：节点颜色/形状/边框、可互操作的 JSON Canvas `styleAttributes`、连线颜色/线型/箭头样式、连线方向翻转、前后层级、焦点模式、文本节点自动尺寸、分组折叠、选区封装成独立画布、节点 Wikilink/Markdown 嵌入、JSON Canvas/PNG/SVG 导出、frontmatter 自动连线、网页正文与可访问 YouTube 字幕导入、PDF 固定分页渲染与自由手绘批注、节点级 AI 模型覆盖、多供应商 AI、流式生成与停止、图像上下文、闪卡/思维导图生成，以及远程 MCP Streamable HTTP 工具调用。

Canvas 元数据索引现在可以为画布文本节点、文件节点与 frontmatter 建立基础链接缓存；还加入了受设置开关控制的 Backlinks 扫描桥接。它通过 Obsidian 内部 API 工作，属于兼容性较敏感的功能。

请注意：CI 已通过类型检查、单元测试和生产构建，但没有启动 Obsidian GUI。真实交互仍需在目标桌面版/移动版确认。完整交互式 Canvas Portal、覆盖全部 Advanced Canvas 的复杂边路由算法/全部样式属性、完整的 PDF 文本选择/高亮工具，以及 Gemini 原生视频上下文、所有 AI 供应商特有能力仍未完整迁移。


## 功能覆盖状态

请查看 [整合功能矩阵](docs/INTEGRATION_MATRIX.md)，了解三个上游项目的已实现、部分实现和待迁移项。该矩阵区分代码已存在与已在 Obsidian 实际运行验证，避免将构建通过误认为所有运行时功能均已验证。


## 原生 AI 协议配置

在 Integration Features 的 Provider Profiles JSON 中，profile 可设置 protocol：

- "openai"：OpenAI-compatible Chat Completions / Images API；也适用于 Ollama 和其他兼容网关。
- "anthropic"：Anthropic Messages API，支持文本与连接图片上下文；原生 Anthropic API 本身不提供图像生成接口。
- "gemini"：Google Gemini generateContent / streamGenerateContent，并尝试通过支持图像生成的 Gemini 模型返回图片。

Gemini 示例 profile：

    {
      "id": "gemini",
      "name": "Google Gemini",
      "protocol": "gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "apiKey": "YOUR_KEY",
      "model": "gemini-2.5-flash",
      "imageModel": "gemini-2.5-flash-image"
    }

可用模型取决于你所使用的账号、区域、模型发布状态及接口权限。请填入自己能调用的模型名称，不要把真实 API Key 提交进仓库。
