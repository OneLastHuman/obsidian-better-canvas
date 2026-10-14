# Better Canvas

<p align="center">
  <strong>让 Obsidian Canvas 成为更完整的知识工作空间。</strong>
  <br />
  画布增强、思维导图与 AI 工作流，一站式整合。
</p>

<p align="center">
  <img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.5.0%2B-7C3AED" />
  <img alt="License" src="https://img.shields.io/badge/License-GPL--3.0--or--later-blue" />
</p>

Better Canvas 是一款面向 Obsidian Canvas 的增强插件，整合节点与连线编辑、思维导图、知识关联，以及可配置的 AI 辅助工作流。你可以在画布中组织想法、构建关系、整理资料，并将 AI 生成的内容继续沉淀为可编辑的节点。

> **项目状态：** 当前项目仍在持续整合和验证中。部分功能依赖 Obsidian 的内部 API 或特定渲染行为，代码已实现不代表已在所有 Obsidian 版本、桌面端和移动端完成验证。请参考[功能整合矩阵](docs/INTEGRATION_MATRIX.md)了解具体覆盖状态。

## 界面预览

以下预览使用本地渲染环境制作，依据插件当前的功能范围展示 Canvas 节点样式、思维导图布局与 AI 节点工作流。**它们是界面示意图，并非从 Obsidian 实际运行中截取的截图**；实际外观会受到 Obsidian 版本、主题和服务配置影响。

<p align="center">
  <img src="docs/screenshots/canvas-enhancements.svg" alt="Canvas 节点颜色、连线和样式控制界面预览" width="100%" />
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>思维导图与自动布局</strong><br />
      <img src="docs/screenshots/mind-map.svg" alt="思维导图分支、节点关系和布局方向界面预览" width="100%" />
    </td>
    <td width="50%" valign="top">
      <strong>AI 辅助工作流</strong><br />
      <img src="docs/screenshots/ai-workflow.svg" alt="AI 上下文、生成回答与关联节点界面预览" width="100%" />
    </td>
  </tr>
</table>

## 功能概览

### Canvas 增强

- **节点样式：** 自定义颜色、形状、边框、文本对齐和 CSS 类。
- **连线控制：** 设置颜色、线型和箭头样式，翻转关联边的方向，并选择入边、出边或全部关联边。
- **布局与专注：** 网格对齐、文本节点自动调整尺寸、层级排序、焦点模式、交互锁定及基础路径路由。
- **日常工作流：** 搜索画布中的文本、文件路径和链接；保存节点模板；按节点顺序进入演示模式。
- **组织与导出：** 折叠分组、将选区封装为独立 Canvas，并导出 JSON Canvas、PNG 或 SVG。

部分样式、分组行为和导出结果可能因画布复杂度或 Obsidian 渲染版本而异，详见[功能整合矩阵](docs/INTEGRATION_MATRIX.md)。

### 思维导图

- 创建子节点、同级节点和游离节点。
- 将 Markdown 文件中的 H1 标题拆分为关联节点。
- 选择节点树，并按 LR、RL、TB 或 BT 方向执行基础自动布局。
- 使用键盘快捷键快速创建节点、浏览相邻节点。
- 生成思维导图结构和复习闪卡节点；生成结果应在使用前检查。

### AI 辅助工作流

- 根据选中节点及其相邻关联内容提问，并将回答保存为连接到原节点的新节点。
- 支持流式生成、停止生成、重新生成，以及按节点覆盖模型或服务配置。
- 通过配置的服务生成图片，并将图片保存到 Vault 的附件目录后插入画布。
- 导入网页正文和可访问的 YouTube 字幕，作为后续整理与分析的素材。
- 支持远程 **MCP Streamable HTTP** 工具调用。

AI 能力取决于所配置服务的 API、模型、账号权限和内容可访问性。网页反爬、登录限制、不可访问的字幕及不受支持的供应商接口都可能导致操作失败。

## 安装

目前可按开发版方式构建和安装。

### 1. 构建插件

需要安装 Node.js 和 npm。在终端运行：

```bash
git clone https://github.com/OneLastHuman/obsidian-better-canvas.git
cd obsidian-better-canvas
npm install
npm run build
```

### 2. 复制插件文件

将生成或项目中的以下文件复制到 Vault 的插件目录：

- `main.js`
- `manifest.json`
- `styles.css`

目标目录：

```text
<Vault>/.obsidian/plugins/obsidian-better-canvas/
```

如果目录不存在，请先创建。

### 3. 在 Obsidian 中启用

打开 **设置 → 社区插件**，刷新或重新加载插件列表，然后启用 **Better Canvas**。如果插件未出现，请确认目录名称为 `obsidian-better-canvas`，且上述三个文件都位于该目录的根部。

## AI 服务配置

在 Better Canvas 的设置中配置 AI 服务。非 AI 的 Canvas 和思维导图功能无需 API Key。

插件支持以下协议类型：

| `protocol` | 说明 |
| --- | --- |
| `openai` | OpenAI-compatible Chat Completions / Images API，也可用于兼容网关或其他兼容服务。 |
| `anthropic` | Anthropic Messages API；原生 Anthropic API 不提供图像生成接口。 |
| `gemini` | Google Gemini `generateContent` / `streamGenerateContent`；图像生成取决于所用模型和服务支持。 |

在 **Integration Features → Provider Profiles JSON** 中添加服务配置。以下为 OpenAI-compatible 服务的示例，请按实际服务替换模型、地址和密钥：

```json
[
  {
    "id": "openai",
    "name": "OpenAI-compatible",
    "protocol": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "YOUR_API_KEY",
    "model": "YOUR_CHAT_MODEL",
    "imageModel": "YOUR_IMAGE_MODEL"
  }
]
```

不同供应商可能使用不同的模型名称、图像生成接口和权限策略。请填写当前账号实际有权调用的模型；不使用图像生成功能时，可按服务要求省略或留空 `imageModel`。

**密钥与隐私提示**

- 不要将真实 API Key 提交到 Git 仓库、Issue 或截图中。
- API 密钥保存在本地 Obsidian 插件设置中；使用 AI 功能时，相关提示词、所选节点内容及所需上下文会发送给你配置的服务。
- 请根据服务商的数据处理政策，决定是否向其发送敏感或私人笔记内容。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Tab` | 为选中节点创建子节点 |
| `Enter` | 为选中节点创建同级节点 |
| `Alt + ↑ / ↓ / ← / →` | 根据空间位置选择相邻节点 |
| `Ctrl/Cmd + Shift + 方向键` | 按指定方向创建子节点 |

快捷键在节点处于选中状态时生效；编辑节点文本时，插件不会拦截这些按键。快捷键和部分画布交互使用 Obsidian 内部接口，升级 Obsidian 后可能需要重新验证。

## 开发与验证

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

- `npm run dev`：开发构建。
- `npm run typecheck`：运行 TypeScript 类型检查。
- `npm test`：运行单元测试。
- `npm run build`：生成生产构建。

CI 可检查类型、测试和构建产物，但不会启动 Obsidian 图形界面。发布前仍应在目标版本中手动验证 Canvas 保存、键盘操作、菜单交互、节点布局、导入导出、PDF 标注，以及真实 AI 服务请求。

## 已知限制

- **Portal 已有单层可编辑实现。** 选择“创建 Canvas Portal”并选择另一个 `.canvas` 后，会显示被引用画布的镜像节点/连线；节点更改和删除会同步回源文件，跨 Portal 连线会映射到 Portal 框。当前暂不支持在 Portal 内新建节点或展开嵌套 Portal；请在测试 Vault 中先验证，不要直接用于唯一副本。
- **PDF 功能仍在完善。** 固定分页支持可选择文本提取、页面图像上下文、红/蓝笔、荧光笔、橡皮擦和撤销；它仍不是完整 PDF 编辑器，不支持完整的文本选择、高亮注释对象、多页批注工具栏或 OCR 工作流。
- **部分功能依赖内部 API 或 DOM。** Portal 文件同步、元数据缓存、反向链接桥接、PDF 单页渲染、特定连线路由及节点样式可能随 Obsidian 版本变化。CI 不运行 Obsidian GUI，仍需桌面端实测。
- **AI 支持存在服务差异。** OpenAI-compatible、Anthropic 与 Gemini profile 已接入；Gemini profile 还可把公开视频 URL 作为原生视频上下文发送。图像生成、流式取消、网页和 YouTube 内容获取，以及 MCP 工具调用都受远端 API、权限和内容可访问性影响。

详细的已实现、部分实现和待完善项目请查看[功能整合矩阵](docs/INTEGRATION_MATRIX.md)。我们会尽量区分“代码已实现”和“已在 Obsidian 实际验证”，避免把构建通过等同于完整的运行时兼容性。

## 上游项目与致谢

本项目的功能方向参考了以下开源项目；当前以独立实现为主，功能方向参考不代表已完整兼容上游能力。

- [Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas)：Canvas 增强与工作流工具。上游声明 GPL-3.0。
- [Canvas MindMap](https://github.com/Quorafind/Obsidian-Canvas-MindMap)：思维导图节点创建、导航和布局。其 `package.json` 声明 MIT；在检查时未发现仓库根目录的 LICENSE 文件。
- [Obsidian AI Canvas](https://github.com/testy-cool/obsidian-ai-canvas)：Canvas 上的 AI 问答与图像生成。上游 LICENSE 声明 MIT。

如果未来直接引入上游代码或资源，会在引入前核对适用许可证，并保留必要的版权和许可声明。

## 许可证

本项目的许可证见 [LICENSE](LICENSE)。
