# 文档索引

初次使用从 [项目首页](../README.md) 开始。查操作步骤、开发规则或历史记录时，使用下列入口。

## 使用与安装

| 文档 | 内容 |
| --- | --- |
| [安装与构建指南](INSTALLATION.md) | 正式版、主分支构建、源码构建与安装排错 |
| [功能指南](FEATURE_GUIDE.md) | Canvas 编辑、主题、思维导图、PDF、导出与 AI 工作流 |
| [示例画布](examples/README.md) | 可复制到 Vault 的展示画布、主题样例与配套图片 |
| [AI 与 MCP 配置指南](AI_SETUP.md) | 模型服务、MCP 传输、本地 OpenCode ACP 与 Codex CLI |
| [自定义样式预设](CUSTOM_STYLE_PRESETS.md) | CSS snippet 的节点/连线样式预设格式与使用方法 |
| [已知限制与安全注意事项](KNOWN_LIMITATIONS.md) | Portal、PDF、导出、AI 服务、本地进程和隐私限制 |
| [上游项目与致谢](ACKNOWLEDGEMENTS.md) | 上游项目来源与第三方资源许可证 |

## 开发与维护

| 文档 | 内容 |
| --- | --- |
| [Agent 工作入口](../AGENTS.md) | 开工前的必读规则和工作约定 |
| [测试与验证规范](TESTING.md) | 标准检查命令、回归清单与验证证据要求 |
| [功能整合矩阵](INTEGRATION_MATRIX.md) | 各功能的实现状态、上游差异、待验证行为和覆盖范围 |
| [节点样式开发指南](STYLE_DEVELOPMENT.md) | 节点面板、形状、边框、颜色和文字排列的开发约定 |
| [Obsidian 官方开发参考](OBSIDIAN_OFFICIAL_REFERENCES.md) | 官方示例、帮助文档与 API 类型定义 |
| [仓库治理规范](REPOSITORY_GOVERNANCE.md) | Issue、分支、PR 审查和发布门禁 |
| [Agent 协作协议](AGENT_COORDINATION.md) | 任务登记、文件占用、状态转换与交接格式 |
| [发版流程](RELEASING.md) | 版本文件、标签、发布检查与安装包 |
| [集成状态提醒](../INTEGRATION_STATUS.md) | 将当前分支视为已验证版本前需检查的证据 |

## 设计与历史记录

| 入口 | 内容 |
| --- | --- |
| [主题设计与原型](design/README.md) | 主题设计说明、浏览器原型与配套资源 |
| [产品截图说明](screenshots/README.md) | README 截图的采集环境和验证范围 |
| [历史记录](archive/README.md) | 按日期保存的协作快照与实现计划 |

设计原型用于查阅视觉方案；功能状态以功能整合矩阵和验证证据为准。历史记录保留当时结论，当前任务按治理规范和协作协议执行。

## 仓库目录

| 路径 | 用途 |
| --- | --- |
| [`src/`](../src/) | 插件源码及同目录的单元测试 |
| [`src/assets/`](../src/assets/README.md) | 打包字体、来源与许可证 |
| 根目录 `main.js`、`manifest.json`、`styles.css` | 插件安装入口；`main.js` 是构建产物 |
| [`release/`](../release/README.md) | 主分支成功构建后自动同步的安装文件 |
| [`scripts/`](../scripts/) | 元数据、工作流工件策略与桌面验证脚本 |
| [`.github/`](../.github/) | Issue/PR 模板与构建、发布工作流 |
| [`docs/examples/`](examples/README.md) | 用户示例及示例依赖的图片 |
| [`docs/design/`](design/README.md) | 设计说明与可打开的原型 |
| [`docs/screenshots/`](screenshots/README.md) | 产品文档使用的截图 |
| [`docs/archive/`](archive/README.md) | 带日期的历史记录 |
| `dist/` | 打包生成的 ZIP 与校验和，已由 Git 忽略 |

新增文档按用途放入对应目录，并补充本页或目录内的索引。临时测试截图和日志按 [测试规范](TESTING.md) 保存到仓库外。
