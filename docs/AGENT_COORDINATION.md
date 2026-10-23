# Agent 协作协议

本文规定并行任务的登记、文件占用和交接方式。分支与审查门禁见 [仓库治理规范](REPOSITORY_GOVERNANCE.md)，验证要求见 [测试与验证规范](TESTING.md)。

任务状态在 [Issue #16 协作登记表](https://github.com/OneLastHuman/obsidian-better-canvas/issues/16) 维护。开始任务时必须核对登记留言和开放 PR 的实际差异。

[2026-10-15 协作快照](archive/2026-10-15-agent-coordination.md) 已归档。历史快照中的分支、待办和文件占用不代表当前状态。

## 状态与文件占用

| 状态 | 含义 | 文件占用规则 |
| --- | --- | --- |
| `painting` | 阅读代码、排查问题、设计或原型阶段 | 默认不占用生产文件；改代码前必须声明文件范围 |
| `working` | 实现、测试或文档修改中 | 仅占用已登记的文件或模块 |
| `review` | PR 等待审查、CI 或维护者决定 | 维持已登记范围；修复审查问题前，必须通知文件范围重叠的任务 |
| `blocked` | 受依赖、权限、CI 或决策阻塞 | 必须写明阻塞项和所需动作 |
| `paused` | 负责人主动暂停 | 必须写明恢复条件；保留任务上下文 |
| `done` | 已合并或由维护者明确关闭，验收证据已记录 | 释放文件占用 |
| `unconfirmed` | 可见分支或 PR，执行者及状态未确认 | 不默认占用；开始前必须联系负责人并检查差异 |

PR 作者不能证明执行 Agent 的身份。PR、分支和历史测试结果也不能证明 Agent 仍在运行。

## 登记与交接

1. 领取前，检查当前分支、工作区、开放 PR 和登记留言。
2. 在 Issue #16 使用 `CLAIM` 留言登记任务、文件范围和验收条件。
3. 若文件范围重叠，先商定单一编辑负责人和整合顺序。
4. 状态变化时，使用 `STATUS` 留言更新状态、commit、PR、阻塞点和下一步。
5. 交接时，使用 `HANDOFF` 留言列出完成项、剩余项、验证证据和接手人。
6. PR 合并或维护者明确关闭任务后，记录验收证据并标为 `done`，释放文件占用。

```text
CLAIM | agent/owner | issue/feature | state=painting/working | branch | reserved files/modules | acceptance criteria | timestamp
STATUS | agent/owner | issue/feature | state | commit/PR | blockers | next step | timestamp
HANDOFF | completed | remaining | tests and exact SHA | risks | next owner
```

测试证据必须对应被审查的 commit。未执行的检查必须标为“未执行”。本地检查、远程 CI 和 Obsidian 运行时验证分别记录。

协调负责人汇总 Issue 正文。各任务通过留言更新状态，不在本文件维护实时登记表。

条目超过 24 小时未更新时，先标记为“需确认”并联系负责人。不得仅凭过期时间删除分支或释放文件占用。
