# AI 与 MCP 配置指南

Better Canvas 的 Canvas 编辑与思维导图功能不需要 API Key。只有 AI、图片生成或 MCP 工作流需要额外配置。

## 1. 配置 AI 服务

打开 Obsidian **设置 → Better Canvas → AI 助手**，在「使用方式」选择「模型服务 API」。点击模型服务右侧的 **+**（添加服务）或铅笔图标（编辑服务），填写名称、接口类型、服务地址、API 密钥和模型；弹窗完成后点击页底「保存更改」生效。默认模型可在主页面直接修改，生成参数、回答偏好和图片生成按需展开。弹窗取消不会修改配置，页底「放弃更改」恢复所有未保存的设置。

支持的协议：

| `protocol` | API 类型 | 说明 |
| --- | --- | --- |
| `openai` | OpenAI-compatible | Chat Completions、模型列表和兼容的 Images API；可用于兼容网关或本地服务。 |
| `anthropic` | Anthropic Messages | 文本与模型列表；原生 Anthropic API 不提供图像生成接口。 |
| `gemini` | Google Gemini | `generateContent`、`streamGenerateContent`；图像生成和视频理解取决于模型与服务支持。 |

请将模型名、Base URL 和密钥替换为服务商实际提供的值。某些兼容网关不支持模型列表，可手动填写模型名称。图片服务商、API Key 与图片模型不再绑定到文本服务商。

### 本地 Ollama 示例

如果 Ollama 已在本机运行，并且目标模型已通过 `ollama pull` 下载，可在「AI 助手 → 使用方式 → 模型服务 API」中新增服务商，将协议设为 OpenAI 兼容、API 地址设为 `http://localhost:11434/v1`、API Key 留空，并填写 `ollama list` 显示的模型名。

此配置用于文本请求；如需图片生成，本地服务还需提供兼容的图像生成接口。

### 高级请求参数与能力探测

在「生成参数」中，每个模型服务可单独配置「随机程度」（Temperature）、「最大输出长度」（token）和「额外请求参数 · JSON」。额外参数会按当前协议合并，并用于 API 后端的文本请求；核心请求字段与认证字段受到保护。最大输出 token 数不等于模型上下文窗口长度，当前也没有自动上下文限制发现、统一重试策略或成本限制。

Temperature 的可填范围取决于协议：OpenAI 兼容与 Gemini 是 0 到 2，Anthropic 是 0 到 1。在服务编辑弹窗完成接口类型修改后，范围说明和输入上限会更新；超出新接口上限的草稿值会调整到该上限并弹出提示，点击「保存更改」后生效。超出范围的数值和无效 JSON 不会覆盖上一次有效草稿值。

模型列表发现支持 OpenAI-compatible 的 `/models`、Anthropic 的 `/models` 和 Gemini 的 `/models`。当服务不支持相应端点时，请手动填写模型名称。

设置中还可以手动探测当前 provider/model 的文本请求和图片输入：确认后最多发送两次小型 API 请求，并保存探测结果。图片输入请求成功只表示接口返回了内容，不保证模型实际理解了图片；图片生成、PDF、视频、URL context 与搜索 grounding 能力仍需单独确认。

### 常用能力

- 从选中节点及其关联内容提问，将结果保存为相连的新节点；可重新生成，或按节点指定模型。
- 保存命名系统提示词，生成闪卡，或将卡片导出为 Obsidian Spaced Repetition 兼容的 Markdown。
- 按独立配置的图片服务生成图片，或导入可访问的网页正文。字幕导入已移除；Gemini 原生公开视频分析仍独立提供。
- 将 Vault 文件夹中的 Markdown 文件批量交给同一条 Prompt 处理；单次最多 20 篇，发送前需要选择文件夹并确认；每篇输入文件都会生成源文件节点，并与对应结果节点关联。
- 对固定 PDF 页面提取文本并提供图像上下文；AI OCR 每批最多处理 20 页。
- 通过 MCP 调用外部工具、读取资源或解析提示模板。使用 AI 建议的工具调用前仍需人工检查并确认。

服务能力、可访问内容及模型权限各不相同。网页登录限制、反爬、不支持的图片接口或模型能力都可能导致任务失败。

## 2. 配置 MCP

在 **AI 助手 → 外部工具 → 连接方式** 中选择一种传输方式：

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

桌面版 Obsidian 可在 **AI 助手 → 使用方式** 中选择 **OpenCode ACP**。

1. 安装 OpenCode，并在终端完成登录。
2. 默认命令为 `opencode acp`。如果 Obsidian 无法找到它，在设置中填写 **程序路径** 的绝对路径。
3. 点击 **读取模型**，在 **模型** 下拉框中选择当前 OpenCode 会话提供的模型，再点击 **保存更改**。选择 **使用工具默认模型** 可恢复 OpenCode 自身配置。
4. 模型使用完整 ID（通常为 `provider/model`）。手动填写的 ID 也必须是当前 OpenCode 会话提供的模型；模型失效时会报错，不会静默换成默认模型。登录与额度仍由 OpenCode 管理，无需另填文本 API Key。

ACP 通过 `opencode acp` 和 stdio 上的 ACP JSON-RPC 调用 OpenCode，在临时目录中创建会话，不会把 Vault 作为 OpenCode 工作区。ACP 请求中的工具或文件权限默认拒绝。当前后端用于文本问答和闪卡，不支持图片或文件输入；遇到多模态上下文时，请切回 API 后端。该模式不保证离线处理，提示词仍会发送给 OpenCode 配置的模型服务。

模型列表只在点击读取按钮后获取，不会发送生成提示词。支持新版会话配置选项和旧版模型选择接口。工具支持删除会话时，读取结束后删除临时会话；旧版本不支持删除，或读取期间取消、超时、进程退出时，OpenCode 历史中可能保留空会话。读取失败会保留原来的模型选择。

图片生成不走 ACP；请在单独展开的「图片生成」设置中配置图片服务商、API Key、图片模型与保存目录。

## 4. 使用本地 Codex CLI

桌面版 Obsidian 可在 **AI 助手 → 使用方式** 中选择 **Codex CLI** 作为文本后端，也可继续使用命令 **Better Canvas: 使用本地 Codex CLI 分析所选节点**。

1. 安装并登录 Codex CLI。
2. 在对应使用方式下，将 **程序路径** 留空以使用 PATH 中的 `codex`，或填写可执行文件的绝对路径。
3. 点击 **读取模型**，从 **模型** 下拉框中选择模型，然后点击 **保存更改**。选择 **使用工具默认模型** 时，不向 CLI 传递模型覆盖参数。
4. 自定义服务的模型未出现在列表中时，展开 **手动填写模型**，填写完整模型 ID。模型目录不代表账号或自定义服务实际拥有的访问权限。
5. 选择 Canvas 节点并运行命令。普通文本生成和专用 Codex 分析命令都会使用此模型。结果会保存为与原节点关联的新节点；任务可通过“停止当前 AI 生成”中断。

作为文本后端时，Codex CLI 只接受纯文本输入；图片或文件上下文需要切换到大模型 API。任务使用只读沙盒和临时工作目录。Codex 使用自身配置的模型供应商，因此不要把它视为离线执行保证或对本机其他文件的绝对隔离。

模型读取通过本机 `codex app-server` 的 `model/list` 接口完成，不创建对话、不发送笔记。生成时通过 `codex exec --model` 传递所选模型。修改程序路径、离开设置或切换后端会取消正在进行的列表读取。

## 5. 其他本地 Agent

桌面版在 **AI 助手 → 使用方式** 中也可选择以下 Agent。先安装并在终端完成工具所需的认证，再填写程序路径和模型。插件不会自动安装 CLI，也不要求复制已有 CLI 的密钥。Aider 等工具仍需按自身要求配置模型服务，并非都能使用订阅登录。

| Agent | 默认程序 | 模型选择 |
| --- | --- | --- |
| Claude Code | `claude` | 下拉预设 `sonnet`、`opus`、`haiku`，或手动模型 ID |
| Cursor Agent | `cursor-agent` | 下拉预设，或手动模型 ID；安装名为 `agent` 时请填写实际程序路径 |
| Gemini CLI | `gemini` | 下拉预设，或手动模型 ID |
| GitHub Copilot CLI | `copilot` | 下拉预设，或手动模型 ID |
| Qwen Coder | `qwen` | 下拉预设，或手动模型 ID |
| Aider | `aider` | 下拉预设，或手动模型 ID |
| IBM Bob | `bob` | 使用 Bob 自身配置；当前 `bob run` 文档未提供模型覆盖参数 |

这些列表提供常用模型 ID，不查询账号权限，可能随 CLI 或服务版本变化。每个 Agent 独立保存程序路径和模型；切换后端不会覆盖其他 Agent 或 API 服务的设置。**保存更改** 后生效，**放弃更改** 会恢复原配置。未选模型时沿用工具默认值。提问窗口显示当前 Agent 和模型。

**验证状态：** 截至 2026-10-23，Claude Code、Cursor Agent、Gemini CLI、GitHub Copilot CLI、Qwen Coder、Aider 和 IBM Bob 的适配器只有 mock 单元测试，没有完成真实登录 CLI、真实模型服务、跨版本参数兼容或实际生成结果的验证。请不要把这里的“已支持”理解为这些 Agent 已在桌面环境实测通过；使用前应先用对应 CLI 在终端确认认证、模型和参数可用。

新增 CLI 后端仅处理文本，在独立临时目录中运行，使用各工具的问答、规划或工具限制参数；不授予自动执行任意命令的权限。支持超时和取消，限制输出大小，只提取助手文本，并在进程成功结束后显示完整回答。工具自身的全局配置、扩展和启动钩子仍可能在启动阶段生效；命令权限限制不等于操作系统沙盒。当前不支持在插件内进行交互式登录、工具审批或接续 CLI 历史对话。工具版本不支持所需参数时会报错；应先在终端更新或检查 CLI。图片生成仍使用独立 API 设置。

Windows 下，新增 CLI 后端支持原生可执行文件，也支持将标准 npm `.cmd` 启动器解析为 `node.exe` 和 JavaScript 入口。任意自定义批处理启动器会被拒绝；可改填原生程序或 JavaScript 入口路径，后者需要 PATH 中有 Node.js。

接入范围参考 [html-anything 的 Agent 表格与适配层](https://github.com/nexu-io/html-anything/tree/975fb3bcb98f1777781fb4c738902d36e32c8c46/next/src/lib/agents)。沿用“每个 Agent 独立配置、默认模型不传覆盖参数”的交互方式，调用参数按各工具文档核对。该项目的 OpenCode 使用普通 CLI，本插件保留 ACP。

## 6. 隐私与排错

- API Key 保存在本地 Obsidian 插件设置中。使用 AI 时，提示词、选中的节点内容和所需上下文会发送给所配置的服务。
- 不要向外部服务发送不应离开本机的笔记、密钥或个人信息；先检查服务商的数据处理政策。API Key 存在本地插件设置中，不要提交到 Git 仓库、Issue 或截图。
- 模型发现失败时，可手动输入服务商支持的模型名；图片生成要单独确认服务是否支持对应接口。
- 遇到权限、连接或工具调用问题时，先检查 endpoint、模型名、凭据和服务日志；本地命令不可用时，优先配置可执行文件的绝对路径。

各功能的实现程度与尚未完成的兼容性验证见 [功能整合矩阵](INTEGRATION_MATRIX.md)。
