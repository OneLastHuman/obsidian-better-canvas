# AI 与 MCP 配置指南

Better Canvas 的 Canvas 编辑与思维导图功能不需要 API Key。只有 AI、图片生成或 MCP 工作流需要额外配置。

## 1. 配置 AI 服务

在 **设置 → Better Canvas → Integration Features → Provider Profiles JSON** 中添加服务配置。以下是 OpenAI-compatible API 的示例：

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

支持的协议：

| `protocol` | API 类型 | 说明 |
| --- | --- | --- |
| `openai` | OpenAI-compatible | Chat Completions、模型列表和兼容的 Images API；可用于兼容网关或本地服务。 |
| `anthropic` | Anthropic Messages | 文本与模型列表；原生 Anthropic API 不提供图像生成接口。 |
| `gemini` | Google Gemini | `generateContent`、`streamGenerateContent`；图像生成和视频理解取决于模型与服务支持。 |

请将模型名、Base URL 和密钥替换为服务商实际提供的值。某些兼容网关不支持模型列表或图片接口，可手动填写模型，并按服务能力留空 `imageModel`。

### 本地 Ollama 示例

如果 Ollama 已在本机运行，并且目标模型已通过 `ollama pull` 下载，可添加一个 profile：

```json
{
  "id": "ollama",
  "name": "Ollama Local",
  "protocol": "openai",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "",
  "model": "qwen2.5:7b",
  "imageModel": ""
}
```

将 `model` 改成 `ollama list` 显示的模型名。此示例用于文本请求；图片生成要求本地服务额外实现兼容的 Images API。

### 高级请求参数与能力探测

每个 Provider Profile 可单独配置 Temperature、最大输出 token 数和高级请求参数 JSON。额外参数会按当前协议合并，并用于 API 后端的文本请求；核心请求字段与认证字段受到保护。最大输出 token 数不等于模型上下文窗口长度，当前也没有自动上下文限制发现、统一重试策略或成本限制。

Temperature 的可填范围取决于协议：OpenAI 兼容与 Gemini 是 0 到 2，Anthropic 是 0 到 1。切换协议时范围说明和输入上限会立即更新；如果已保存的值超出新协议的上限，插件会把它调整到该上限并弹出提示，超出范围的输入则保持未保存并显示范围错误。

模型列表发现支持 OpenAI-compatible 的 `/models`、Anthropic 的 `/models` 和 Gemini 的 `/models`。当服务不支持相应端点时，请手动填写模型名称。

设置中还可以手动探测当前 provider/model 的文本请求和图片输入：确认后最多发送两次小型 API 请求，并保存探测结果。图片输入请求成功只表示接口返回了内容，不保证模型实际理解了图片；图片生成、PDF、视频、URL context 与搜索 grounding 能力仍需单独确认。

### 常用能力

- 从选中节点及其关联内容提问，将结果保存为相连的新节点；可重新生成，或按节点指定模型。
- 保存命名系统提示词，生成闪卡，或将卡片导出为 Obsidian Spaced Repetition 兼容的 Markdown。
- 按配置的服务生成图片、导入可访问的网页正文和 YouTube 字幕。
- 将 Vault 文件夹中的 Markdown 文件批量交给同一条 Prompt 处理；单次最多 20 篇，发送前需要选择文件夹并确认；每篇输入文件都会生成源文件节点，并与对应结果节点关联。
- 对固定 PDF 页面提取文本并提供图像上下文；AI OCR 每批最多处理 20 页。
- 通过 MCP 调用外部工具、读取资源或解析提示模板。使用 AI 建议的工具调用前仍需人工检查并确认。

服务能力、可访问内容及模型权限各不相同。网页登录限制、反爬、不可访问字幕、不支持的图片接口或模型能力都可能导致任务失败。

## 2. 配置 MCP

在 **Integration Features → MCP transport** 中选择一种传输方式：

| 方式 | 适用场景 | 配置 |
| --- | --- | --- |
| Remote Streamable HTTP | 新版远程 MCP 服务 | 填写服务提供的 Streamable HTTP endpoint。 |
| Remote SSE (legacy) | 仍使用 SSE 的旧服务 | 填写服务提供的 SSE URL；可按服务要求配置 Bearer Token。 |
| Local stdio (desktop) | 本机 MCP 服务 | 填写 JSON 命令配置，在桌面端启动本地进程。 |

远程 SSE 若使用独立的消息 endpoint，插件会拒绝与配置 SSE URL 不同 origin 的消息地址，避免向其他源发送凭据。

本地 stdio 配置示例：

```json
{
  "command": "/absolute/path/to/node",
  "args": ["/absolute/path/to/mcp-server.js", "--safe-mode"],
  "cwd": "/absolute/path/to/server",
  "env": {
    "MCP_API_TOKEN": "YOUR_LOCAL_TOKEN"
  }
}
```

`command` 是可执行文件路径；`args` 必须是字符串数组；`cwd` 和 `env` 可选。使用绝对路径通常更容易排查 Obsidian 无法找到命令的问题。本地 stdio 会按配置复用会话，最多缓存 4 个会话；会话空闲 5 分钟后关闭，插件卸载时会清理子进程。遇到超时、进程退出或协议错误时，会话会被丢弃，后续操作再重新启动进程。服务应能在进程首次启动时完成初始化。

插件可以列出和调用 MCP 工具，也支持浏览资源（resources/list）、读取资源（resources/read）、发现提示模板（prompts/list）及解析模板（prompts/get）。文本结果会写入关联 Canvas 节点；支持的 PNG、JPEG、WebP 和 GIF 内容会保存为 Vault 附件。

**安全提示：** 本地 stdio 服务继承其进程的操作系统权限，可能访问该用户有权访问的文件和网络。仅连接可信服务。远程服务请优先使用 HTTPS；不要将真实 token 提交到仓库、Issue 或截图。执行工具前应检查工具名称及参数，因为操作可能影响外部系统。

工具参数和提示模板参数以 JSON object 输入。输入不是有效 JSON 时弹窗保持打开并保留已输入文本，同时显示插件措辞的错误提示，修正后可直接重新提交，不需要重跑整条命令。

## 3. 使用本地 OpenCode ACP

桌面版 Obsidian 可在 **文本 AI 后端** 中选择 **本机 OpenCode ACP**。

1. 安装 OpenCode，并在终端完成登录。
2. 默认命令为 `opencode acp`。如果 Obsidian 无法找到它，在设置中填写 **OpenCode CLI executable** 的绝对路径。
3. 该模式使用 OpenCode 自己的模型、登录和额度配置，无需另外填写文本 API Key。

ACP 通过 `opencode acp` 和 stdio 上的 ACP JSON-RPC 调用 OpenCode，在临时目录中创建会话，不会把 Vault 作为 OpenCode 工作区。ACP 请求中的工具或文件权限默认拒绝。当前后端用于文本问答和闪卡，不支持图片或文件输入；遇到多模态上下文时，请切回 API 后端。该模式不保证离线处理，提示词仍会发送给 OpenCode 配置的模型服务。

图片生成不走 ACP；请在 AI API profile 中配置兼容的服务及图片模型。

## 4. 使用本地 Codex CLI

桌面版 Obsidian 可使用命令 **Better Canvas: 使用本地 Codex CLI 分析所选节点**。

1. 安装并登录 Codex CLI。
2. 在设置中将 **Local Codex CLI executable** 留空以使用 PATH 中的 `codex`，或填写可执行文件的绝对路径。
3. 选择 Canvas 节点并运行命令。结果会保存为与原节点关联的新节点；任务可通过“停止当前 AI 生成”中断。

任务使用只读沙盒和临时工作目录。Codex 使用自身配置的模型供应商，因此不要把它视为离线执行保证或对本机其他文件的绝对隔离。

## 5. 隐私与排错

- API Key 保存在本地 Obsidian 插件设置中。使用 AI 时，提示词、选中的节点内容和所需上下文会发送给所配置的服务。
- 不要向外部服务发送不应离开本机的笔记、密钥或个人信息；先检查服务商的数据处理政策。API Key 存在本地插件设置中，不要提交到 Git 仓库、Issue 或截图。
- 模型发现失败时，可手动输入服务商支持的模型名；图片生成要单独确认服务是否支持对应接口。
- 遇到权限、连接或工具调用问题时，先检查 endpoint、模型名、凭据和服务日志；本地命令不可用时，优先配置可执行文件的绝对路径。

各功能的实现程度与尚未完成的兼容性验证见 [功能整合矩阵](INTEGRATION_MATRIX.md)。
