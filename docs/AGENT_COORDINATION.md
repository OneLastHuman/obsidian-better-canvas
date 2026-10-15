# Agent 协作登记表与并行开发协议

**登记表 Issue：** [#16 — shared Agent coordination registry](https://github.com/OneLastHuman/obsidian-better-canvas/issues/16)  
**本次核对日期：** 2026-10-15  
**最新 main 基线：** `5d0087cb53641745e6bd748bbed42bdbb7fa09b9`；本表为 2026-10-15 的状态快照，不是实时心跳。

本文规定协作方式，并保留一次可核验的 GitHub 状态快照。Agent 的实际运行身份不会总是出现在 GitHub API 中，因此“PR 作者”不等同于已确认的执行 Agent；无法确认的负责人或状态明确写为“未确认”，不得猜测。

## 状态定义

| 状态 | 含义 | 文件占用规则 |
| --- | --- | --- |
| `painting` | 方案设计、代码阅读、问题排查或原型阶段 | 默认不占用生产文件；若要改代码，必须同时声明具体文件范围 |
| `working` | 正在实现、编写测试或同步文档 | 仅对登记的文件/模块声明写入占用 |
| `review` | 已开 PR，等待审查、CI 证据或维护者决定 | 不再扩展范围；修复 review 时先通知可能受影响的并行任务 |
| `blocked` | 被依赖、权限、CI 或待决策事项阻塞 | 写明阻塞项、需要谁采取的动作 |
| `paused` | 负责人主动暂停，仍保留上下文 | 必须说明恢复条件；暂停不是已完成 |
| `done` | 已合并或由维护者明确关闭，验收证据已记录，文件占用已释放 | 不继续保留文件占用 |
| `unconfirmed` | GitHub 上能看到分支/PR，但无法确认执行者是否仍在工作或当前状态 | 不得默认占用；开始前先联系负责人并检查最新 diff |

## 当前工作登记（截至 2026-10-15）

这是本次远程核对的快照，不是实时 Agent 心跳。最新状态变更应在 Issue #16 留言；只有协调负责人更新 Issue 正文的快照表，避免多个 Agent 同时覆盖同一份 Markdown 表格。

| Agent / 负责人 | 任务 | 状态 | 预留范围 / 冲突点 | 分支 / PR | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 未确认执行 Agent；PR 作者为 `OneLastHuman` | Spaced Repetition 闪卡 Markdown 导出 | `done`（PR 关闭但未合并；功能已在 main） | 闪卡 formatter、设置 UI 和导出集成已出现在 main；原 PR #12 不应重复合入 | `feat/10-spaced-repetition-flashcards-rebased` / [PR #12](https://github.com/OneLastHuman/obsidian-better-canvas/pull/12) | PR #12 已于 2026-10-15 关闭并由维护者标记为 superseded；主线功能仍需 Obsidian + Spaced Repetition 实测 |
| 未确认执行 Agent；PR 作者为 `OneLastHuman` | MCP Resources / Prompts 与持久化 stdio 会话 | `done` | 支持 Streamable HTTP、旧式 SSE、本地 stdio 的 Resources/Prompts；std io 会话有空闲超时、LRU 数量限制和插件卸载清理 | `feat/mcp-resources-prompts` / [PR #14](https://github.com/OneLastHuman/obsidian-better-canvas/pull/14) | 已于 2026-10-15 合并为 `7dbbb927615a2d00eec613ecc74fca093af6a553`；Build run [38679842405](https://github.com/OneLastHuman/obsidian-better-canvas/actions/runs/38679842405) 对准确 head 通过。Obsidian/真实 MCP 服务实测仍未执行 |
| 未确认 | 仓库治理与测试规范 | `unconfirmed` | 可见分支变更涉及 `.github/ISSUE_TEMPLATE/*`、`.github/pull_request_template.md`、`AGENTS.md`、`docs/REPOSITORY_GOVERNANCE.md`、`docs/TESTING.md`；开始前须与负责人对齐 | `chore/agent-repository-governance` | 请分支负责人认领/更新状态；本任务不修改这些共用文件 |
| 当前会话；GitHub 未暴露更具体的 Agent 身份 | 协作登记和状态转换规则 | `review` | 仅修改本文件 `docs/AGENT_COORDINATION.md`；没有更改治理分支预留的 `AGENTS.md` | `docs/agent-coordination-register` / [PR #17](https://github.com/OneLastHuman/obsidian-better-canvas/pull/17) | 已将 PR #14、#19、#21 的最终状态同步到本文；等待本次 head CI 及合并 |

| 未确认执行 Agent；PR 作者为 `OneLastHuman` | Canvas Portal 几何边界校验 | `done` | 只改 `src/portal-adoption.ts` 与 `src/portal-adoption.test.ts`，拒绝 NaN/Infinity、非正尺寸、溢出矩形和无效 inset | `agent/portal-adoption-geometry-guards` / [PR #19](https://github.com/OneLastHuman/obsidian-better-canvas/pull/19) | 已于 2026-10-15 合并为 `915ce78fcff546eb42afc3de17d5ae08bcd53a4a`；Build run [38679845708](https://github.com/OneLastHuman/obsidian-better-canvas/actions/runs/38679845708) 对准确 head 通过 |
| 未确认执行 Agent；PR 作者为 `OneLastHuman` | 每个 AI 模型的可选能力探测 | `done` | 用户确认后最多发一条文本请求和一条微型图片输入请求；保存脱敏且最多 50 条的 provider/protocol/model 报告，未测试能力仍显式未知 | `feat/model-capability-probes-rebased` / [PR #21](https://github.com/OneLastHuman/obsidian-better-canvas/pull/21) | 已于 2026-10-15 合并为 `5d0087cb53641745e6bd748bbed42bdbb7fa09b9`；Build run [38680082263](https://github.com/OneLastHuman/obsidian-better-canvas/actions/runs/38680082263) 对准确 head 通过；没有执行真实供应商探测 |

### 共用文件冲突提醒

PR #12 已关闭且未合并，维护者确认闪卡功能已由独立提交整合至 main；不应重复合并。PR #20 同样已关闭且未合并，其模型能力探测实现由基于最新 main 的 PR #21 继承并合并。PR #14、#19、#21 现已合入 main；后续任务仍应在修改 README、功能矩阵、测试规范或集成器前检查所有新开放 PR，确认文件所有权与差异。

治理分支涉及 `AGENTS.md` 与测试/治理文档，因此本次协作机制改动被隔离在独立文件，暂不修改 `AGENTS.md` 或功能矩阵。等治理工作负责人确认整合顺序后，再将入口链接合入。

## 需要负责人确认的候选分支

以下是与当时 `main` 的比较结果。Ahead/behind 表示提交图差异，不代表分支仍活跃，也不证明这些提交尚未被其他路径等价整合。先让负责人确认是否继续、放弃或移植，不要直接把旧分支合并到当前 main。

| 分支 | 相对 main 的提交差异 | 可见改动范围 | 建议处理 |
| --- | --- | --- | --- |
| `chore/track-installable-plugin-bundle` | ahead 5 / behind 39 | Build workflow、README、Canvas 链接物化模块/测试、版本文件 | 确认安装包工作是否已由 main 上的实现替代 |
| `docs/agent-testing-playbook` | ahead 1 / behind 148 | `AGENTS.md` | 与治理分支统一，不单独再合并 |
| `docs/readme-humanizer-pass` | ahead 1 / behind 128 | `README.md` | 确认是否仍有未移植的文档改动 |
| `feat/direct-install-package` | ahead 3 / behind 140 | Build/Release workflow、README | 对照现行安装包流程，只移植仍缺失的内容 |
| `feat/opencode-acp-impl` | ahead 9 / behind 115 | OpenCode ACP、AI 主入口与测试、README | 先确认当前 main 的 ACP 实现与此分支差异 |
| `feat/unified-settings-redesign` | ahead 4 / behind 92 | 设置 UI、主入口、样式与集成器 | 与 v2 文件范围重叠，先决定唯一后续分支 |
| `feat/unified-settings-redesign-v2` | ahead 5 / behind 90 | 设置 UI、主入口、样式与集成器 | 与非 v2 分支冲突，确认是否已废弃/替代 |
| `fix/remove-default-node-border` | ahead 3 / behind 90 | Canvas 增强、自动连线与测试 | 复现当前 main 的实际行为再决定是否移植 |
| `integration/canvas-frontmatter-json-editor` | ahead 6 / behind 97 | Canvas frontmatter、集成器、测试与 README | 对照当前实现确认尚存差距 |

## 功能整合待办队列（尚未认领即不代表有人在做）

| 优先顺序 | 任务 | 完成标准 | 推荐状态 |
| --- | --- | --- | --- |
| 1 | 验证已合并的 MCP resources/prompts 与持久化 stdio | 用测试 MCP 服务器在 Obsidian 测试 Vault 完成浏览资源、读取资源、解析 Prompt、会话复用/超时/卸载验证 | 未认领 |
| 2 | 加固本地 MCP 分页结果处理 | stdio catalog 统一 50 页/1000 项上限并对多页重复键去重；覆盖 tools/resources/prompts，新增回归测试 | 未认领 |
| 3 | 决定治理分支和候选旧分支去留 | 负责人确认分支状态，必要时 rebase/移植到新分支；一个文件只由一个 Agent 负责编辑 | `painting` |
| 4 | Canvas Portal 深层/复杂场景 | 补充嵌套 Portal、跨 Portal 连线和源文件并发修改用例；测试验证失败恢复与保存结果 | 未认领 |
| 5 | Canvas 样式/静态导出兼容性 | 明确未支持的 `styleAttributes` 与 Markdown embed 场景，补齐纯逻辑测试和导出回归 | 未认领 |
| 6 | PDF 注释完整度与 Obsidian 宿主端回归 | 评估原生 PDF 高亮编辑、多页批注；在测试 Vault 覆盖 Canvas、Portal、PDF、MCP、AI 与导出并记录版本/commit | 未认领 |

## 每个 Agent 必须遵守的流程

1. **领取前：** 先检查本登记规则、开放 PR、当前分支和工作区；在 [Issue #16](https://github.com/OneLastHuman/obsidian-better-canvas/issues/16) 留言领取任务。
2. **领取格式：**
   `CLAIM | agent/owner | issue/feature | state=painting/working | branch | reserved files/modules | acceptance criteria | timestamp`
3. **明确文件边界：** 尽量让并行任务拥有不重叠的文件范围。若必须修改共用文件，先留言协商单一负责人和合并顺序，不以“各自分支独立”为理由忽略冲突。
4. **状态变化：** 开始实现、进入 review、被阻塞、暂停、完成或放弃时，都在 Issue #16 添加 `STATUS` 留言，更新状态、当前 commit/PR、阻塞点和下一步。
5. **交接格式：** `HANDOFF | completed | remaining | tests and exact SHA | risks | next owner`。未执行的测试必须标为未执行，不可写成通过。
6. **完成与释放：** 只有在 PR 合并/维护者明确关闭、验证证据记录完成后才标为 `done` 并释放文件范围。不要自行合并 PR。
7. **防止登记表冲突：** Agent 通过 Issue #16 的留言报告状态；由协调负责人汇总并更新 Issue 正文快照，不要让所有 Agent 同时修改本 Markdown 文件。
8. **过期检查：** 超过 24 小时没有状态更新的条目先标记“需确认”，联系负责人后再判断是否释放占用；不要自动删除分支或假定工作已停止。

## 验证原则

- PR 和分支是工作范围与代码状态的证据，不能作为 Agent 实时在线状态的证据。
- CI 结果必须对应准确的 PR head SHA；历史 main 通过不能替代当前 PR 验证。
- Typecheck、单元测试、production build 与真实 Obsidian 运行时验证分开记录。
- 本文件是协作快照/流程规范，不声称仓库所有功能已完成，也不声称过往分支仍有人在工作。
