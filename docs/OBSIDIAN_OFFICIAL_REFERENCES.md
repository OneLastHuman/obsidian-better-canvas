# Obsidian 官方开发参考

本文整理 Better Canvas 开发时可直接查阅的 Obsidian 官方维护仓库。这些链接是实现、API 和用户文档的参考入口，不代表 Better Canvas 已复制或完整采用其中的代码与工程结构。

## 官方仓库

| 资源 | 主要用途 | 在 Better Canvas 中的使用方式 |
| --- | --- | --- |
| [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) | 最小插件示例与开发模板，展示插件入口、命令、设置页、Ribbon、Modal、事件注册、构建和打包等基础模式。 | 排查插件生命周期、命令/设置接入、事件清理和发布包结构时，用它对照官方推荐的基础写法。先检查本仓库现有实现与构建配置，不要直接覆盖项目自己的架构。 |
| [obsidian-help](https://github.com/obsidianmd/obsidian-help) | Obsidian 官方帮助文档的源文件，包含功能说明、用户工作流、术语与文档写作风格。 | 编写或修订面向用户的 Canvas 操作说明、设置项解释和排错文档时，用于核对 Obsidian 现有概念、界面名称与用户文档表达。它不是未公开 API 行为的规范。 |
| [obsidian-api](https://github.com/obsidianmd/obsidian-api) | Obsidian API 的 TypeScript 类型定义及相关说明，是检查公开 API 类型与注释的重要入口。 | 修改插件 API 调用、类型声明、Workspace/Vault 交互或事件订阅时优先查阅，并结合本项目的 TypeScript 检查与目标 Obsidian 版本做验证。 |

配套入口：[Obsidian 插件 API 文档](https://docs.obsidian.md/)。

## 建议查阅顺序

1. **确认预期行为。** 对照官方帮助文档和 Better Canvas 的功能指南，先明确用户看到的行为与术语。
2. **确认 API 契约。** 查看 `obsidian-api` 的类型定义和 TSDoc；优先使用公开 API，并检查调用是否受当前支持的 Obsidian 版本约束。
3. **参考最小实现。** 在 `obsidian-sample-plugin` 中寻找生命周期管理、命令注册、设置页、事件注册等基础模式，再按 Better Canvas 现有模块结构实现。
4. **验证实际行为。** 运行仓库定义的 `npm run typecheck`、`npm test` 和 `npm run build`；涉及 Canvas DOM、Workspace 状态、主题、导出或内部 API 时，还要按 [测试与验证规范](TESTING.md) 在 Obsidian 桌面环境中验证，并更新 [功能整合矩阵](INTEGRATION_MATRIX.md) 或 [已知限制](KNOWN_LIMITATIONS.md)。

## 使用边界

- 官方 API 类型不等于所有运行时行为都受稳定 API 契约保证。Better Canvas 中依赖内部实现、Canvas DOM 或未公开行为的代码，应明确记录限制并进行针对性回归验证。
- 示例仓库的目录结构、依赖版本、脚本和发布流程可能与本项目不同。项目的实际命令与流程以本仓库的 `package.json`、[仓库治理规范](REPOSITORY_GOVERNANCE.md)、[测试与验证规范](TESTING.md) 和 [发版流程](RELEASING.md) 为准。
- 查阅或借鉴上游代码时，先核对目标版本、许可证及版权声明；不要把参考实现未经审查地整段复制进项目。

## 链接

- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian Help](https://github.com/obsidianmd/obsidian-help)
- [Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Obsidian 插件 API 文档](https://docs.obsidian.md/)
