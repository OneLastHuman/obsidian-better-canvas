# AGENTS.md — Better Canvas Agent 工作入口

本文是本仓库所有代码 Agent 的入口约定。开始工作前，先阅读本文件和与任务相关的规范。

## 必读规则

1. 仓库治理规范：[docs/REPOSITORY_GOVERNANCE.md](docs/REPOSITORY_GOVERNANCE.md)。包含 Issue 分流、分支、Agent 交接、PR 审查和发布门禁。
2. 测试与验证规范：[docs/TESTING.md](docs/TESTING.md)。包含环境预检、测试层级、项目专项回归清单和证据要求。
3. 功能状态参考：[docs/INTEGRATION_MATRIX.md](docs/INTEGRATION_MATRIX.md)。查看功能当前实现状态与尚未验证的限制。

## 通用工作规则

- 开始前检查当前分支、工作区状态和目标 commit；不得覆盖用户已有更改。
- 除非得到明确授权，不直接提交或推送到 `main`，不绕过 PR 审查或 CI。
- 先理解 Issue 和验收条件，再确定最小改动范围；一个 PR 聚焦一个主要目标。
- 搜索同类实现与调用方，避免只修复一个入口而遗漏同类路径。
- 不伪造测试结果。没有执行的检查要标记为“未执行”或“受阻”；远程 CI 结果和本地执行结果应分别报告。
- 涉及用户可见功能、配置、命令、快捷键、兼容性或已知限制时，同步更新对应文档。
- 对网络请求、凭据、MCP、本地进程、Vault 文件写入、导入导出和发布工作流等高风险变更，先检查完整 diff 与副作用；不要在包含真实用户数据或凭据的环境中运行未经审查的代码。
- 完成前检查 `git diff`、`git diff --check` 和工作区状态，并在 PR 描述中写明变更、验证证据和剩余风险。

## 本项目开发命令

以当前 `package.json` 为准。当前标准命令为：

```bash
npm run typecheck
npm test
npm run build
```

测试路径、环境阻塞处理、Obsidian 桌面集成验证的定义，以及“通过/失败/未执行”的判定标准，统一以 [docs/TESTING.md](docs/TESTING.md) 为准，不在本文重复维护。
