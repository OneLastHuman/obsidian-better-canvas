# Better Canvas 测试与验证规范

本文定义 Better Canvas 的环境预检、自动化测试、浏览器测试、真实 Obsidian 集成测试、回归重点和测试结果汇报方式。Agent 的通用工作规则见根目录 [AGENTS.md](../AGENTS.md)；Issue、PR、分支与发布工作流见 [仓库治理规范](REPOSITORY_GOVERNANCE.md)。

## 1. 基本原则

1. **先检查环境，再选择测试路径。** 不要假定当前环境有 Git、外网、npm registry、浏览器、Obsidian Desktop 或 Obsidian CLI。
2. **以当前 commit 的完整仓库为测试对象。** 不要把通过 GitHub API 读取的文件片段、手工复制的源码快照或临时 mock 项目称为完整仓库测试。
3. **证据必须对应 commit，并遵守产物生命周期。** 报告测试结果时记录测试环境、测试命令、成功/失败状态和被测试的 commit SHA。远程 CI 的成功不能表述为当前沙盒刚刚本地执行成功。结论写在对应 PR/Issue；Actions 日志默认就是证据，只有确实需要下载或审查截图、DOM 快照、视频时才附加小型 artifact。截图和长日志也可直接附加到 PR/Issue。仅将可复用的自动化测试 fixture 和产品文档所需截图纳入版本控制。
4. **没有执行就明确说未执行。** 类型检查通过、单元测试通过、打包成功、浏览器测试通过和 Obsidian 运行时验证是不同结论，不要互相替代。
5. **优先使用小而真实的测试。** 可直接测试纯函数时，不要先构建整套假 Obsidian；只有需要时才添加 mock、adapter 或浏览器 Harness。
6. **对文件操作使用专用测试 Vault。** 不要让自动化测试操作用户真实 Vault 或包含私人资料的目录。
7. **不为通过测试而削弱断言。** 修复行为或测试前置条件；不要仅为了绿灯跳过有意义的测试。
8. **每次变更后复查 diff。** 不要覆盖或重置用户已有更改；未经明确授权，不要将工作直接提交到 main。
9. **按用途选择发布通道。** Build workflow 只负责验证，不上传 artifact；`main` 的安装文件由 [`release/`](../release/README.md) 提供；正式安装包只由 GitHub Release 发布。需要临时审查文件时，上传单个用途明确的 artifact，并设置最短可行保留期。

## 2. 开始任务时的环境预检

从仓库根目录执行可用的检查：

```bash
pwd
git status --short --branch
git rev-parse HEAD 2>/dev/null || true
node --version
npm --version
command -v git || true
command -v obsidian || true
command -v chromium || command -v chromium-browser || command -v google-chrome || true
command -v Xvfb || true
```

检查依赖和网络时，优先用轻量探测，避免反复重试造成等待：

```bash
test -d node_modules && echo "node_modules exists" || echo "node_modules missing"
npm config get registry
npm view vitest version --fetch-retries=0 --fetch-timeout=5000
```

如果 DNS、代理、沙盒策略或网络访问导致下载失败：

- 不要不断重试同一个下载地址，也不要把连接器能够读取远程文件等同于 shell 可以联网克隆仓库。
- 如本地完整 checkout 和依赖可用，继续运行本地测试。
- 如本地没有完整 checkout，只能通过 GitHub API/连接器检查代码或 CI 结果，应明确标记这是远程审查，不能声称已在本地运行项目测试。
- 先查看现成 CI 的 workflow、对应 commit SHA、job steps 和日志。仅在目标 SHA 和测试步骤确实匹配时引用该结果。
- 可以测试可运行的独立模块，但必须说明其输入是完整 checkout、从仓库提取的模块还是源码快照，并列出未覆盖的部分。
- 不要尝试规避执行环境的网络或权限策略。必要时转向可联网的 CI runner 或预配置 VM。

## 3. 本项目的标准本地检查

本仓库的 package scripts 定义如下：

- `npm run lint`：运行 Obsidian 官方 ESLint 规则；现有非安全规则先以警告方式提示，安全敏感规则会使检查失败。
- `npm run validate:metadata`：校验 package.json、manifest.json 与 versions.json 的插件版本和最低 Obsidian 版本是否一致；不依赖 node_modules，CI 在安装依赖之前运行。
- `npm run typecheck`：TypeScript 类型检查。
- `npm test`：运行 Vitest 单元测试。
- `npm run build`：生成生产构建。
- `npm run verify:workflow-artifacts`：检查 Build/Release/Cleanup 工作流是否遵守 artifact 用途、预算、保留期和文档入口约定。
- `npm run dev`：运行开发构建；当前脚本是一次性 esbuild 构建，不代表持续 watch 模式。

仓库提供 `package-lock.json` 时使用 `npm ci`；若锁文件缺失或与 `package.json` 不一致，先修复锁文件，不要用 `npm install` 掩盖差异。常规验证顺序：

```bash
npm ci
npm run lint
npm run validate:metadata
npm run typecheck
npm test
npm run build
npm run verify:workflow-artifacts
```

如果任务触及构建或开发脚本，也要验证相应命令的实际行为。检查构建产物是否存在、体积非零，并确认 `main.js`、`manifest.json` 和 `styles.css` 的部署路径符合 Obsidian 插件要求。

CI 只能证明 workflow 实际运行过的步骤。读取 Actions 时至少核对：

- commit SHA 是否对应正在评审的代码；
- workflow 是否包含 typecheck、test 和 build；
- 各步骤结论及测试数量；
- 是否有警告、跳过或未运行的集成测试。

## 4. 测试层级：由快到慢

### Tier 1 — 纯逻辑单元测试（每次变更优先）

使用 Vitest 验证不依赖 Obsidian GUI 的业务逻辑，例如：

- Canvas JSON 的读取、规范化、节点/连线构造和属性保留；
- 布局方向 LR/RL/TB/BT、边界值、循环图、多父节点和缺失端点；
- WikiLink / Canvas link 解析；
- 连线样式、箭头、floating side、分组折叠/展开与 z-order；
- SVG 导出尺寸处理、MCP 文本/图片结果规范化；
- AI provider 请求构造、流式响应解析、错误处理和取消逻辑（通过 mock fetch）。

测试应验证输出数据、保存/刷新调用、输入边界和原始数据不被意外破坏，而不是只断言函数“没有抛错”。

### Tier 2 — 宿主依赖模拟测试（按需）

主插件入口和集成功能会使用 `Plugin`、`App`、`Workspace`、`Vault`、`TFile`、`Notice`、Modal 和内部 Canvas 对象。测试相关协调逻辑时：

- 仅 mock 被测逻辑真正需要的 API 表面；
- 为 Canvas 提供可观察的 `getData`、`importData`、`requestSave` 和 `requestFrame`；
- 为 Vault/文件系统提供临时目录或内存 Fake，并记录副作用；
- 对命令注册、未选中节点、多个选中节点、只读状态、无效文件、API 失败和取消操作做负向测试；
- 不把 Fake 的行为当成 Obsidian 真实实现的证据。

如果模块与 Obsidian API 耦合严重，优先抽取小型纯函数或窄接口；避免为了测试而重写整套 Obsidian API。

### Tier 3 — 浏览器 Harness / Playwright（有浏览器时）

只有在浏览器实际可启动、脚本真实执行并检查结果后，才报告浏览器测试通过。

- Harness 应尽可能导入当前 checkout 中的真实业务模块或其构建产物，避免维护一份与生产源码漂移的复制版本。
- 对 DOM/CSS、选择、键盘交互、拖放、模态框和 SVG 渲染做断言，并按需生成截图。
- 在不同环境使用 DOM 模拟器时，注明其不等价于真实浏览器。
- 如果 Harness 自己绘制 Canvas，它能验证插件业务逻辑和 Harness UI，但不能证明 Obsidian Canvas 内部渲染、原生拖动或内部 API 兼容。
- 需要保留失败截图、浏览器控制台与关键 DOM 状态时，优先附加到对应 PR/Issue。只有附件无法承载且后续确实需要下载时，才上传一个小型 artifact；默认保留 3 天，单次上传不应包含整套依赖、安装程序或无关的成功日志。不要提交临时截图、运行日志或 run manifest。

### Tier 4 — 真实 Obsidian CLI / Desktop 集成测试（具备运行环境时）

Obsidian CLI 不是 Node 包或纯 Headless Runtime 的替代品。执行前必须确认 Obsidian Desktop 已安装、CLI 已启用，并且测试应用能够启动。对 Linux runner，需要具备兼容的桌面应用运行依赖；在无实体显示器的机器上可评估 Xvfb 等虚拟显示方案，但要实际验证启动成功。

- 使用独立的临时/测试 Vault，安装当前 commit 构建的插件。
- 启动 Obsidian 后，通过 CLI 或 CDP 确认应用和插件就绪，再执行测试。
- 根据当前安装版本的官方 CLI 文档确认命令语法；不要假定命令、输出格式或应用状态。
- 可用时，检查插件重载、命令注册、`dev:errors`、`dev:console`、DOM/CSS、截图和运行时状态。
- CLI 负责启动和诊断并不代表它自动完成所有鼠标、键盘和视觉断言。需要真实交互时使用 Playwright/CDP，并检查持久化结果。
- 测试结束后读取 Vault 中生成的 .canvas/Markdown/附件文件，验证真实副作用；同时确认应用没有 JavaScript 错误。
- 若 Obsidian 不存在或无法启动，应将该层标记为 BLOCKED，而非 PASS。

## 5. Better Canvas 重点回归清单

根据功能范围，优先为以下路径保留稳定测试数据和明确断言：

### Canvas 数据与布局
- 空数据、格式不完整的数据、缺失节点、重复 ID、断开的边、循环图和多父节点；
- 新增/重排/折叠节点后，所有边的端点仍有效；
- LR、RL、TB、BT 布局方向及非树结构；
- 导入和更新之后保留未知扩展字段、节点样式和连线属性；
- 选择 0/1/多个节点时的行为和通知。
- Zoom breakpoint：将 Obsidian 的 log2 zoom 转为线性 scale；测试 0/1/负值、接近断点、等于断点、非有限值，并验证内容只在 scale 小于断点时隐藏。

### 插件命令与键盘操作
- 每个命令都在正确的 view/selection 状态下执行；
- 编辑文本时，不应拦截 Tab、Enter 和方向键的默认行为；仅按功能说明拦截 Shift + Tab 与 Shift + Enter 创建节点；
- Canvas 卡片编辑在 Obsidian 1.14+ 运行于同源 iframe；验证编辑态快捷键时，键盘事件必须在 iframe 的 `contentDocument` 上触发，不能只验证父文档的 `view.containerEl`；
- 只读模式阻止修改，但不意外阻断设计上允许的画布平移/缩放；
- 插件重载或重复的 workspace 事件不应重复绑定监听器或触发重复操作。

### 文件与持久化
- 保存、导入、删除、重命名、缺失源文件以及文件写入失败；
- Canvas Portal 同步：源和镜像的 ID 映射、跨 Portal 边、源节点删除、重复刷新与错误恢复；
- 只在专用测试 Vault 中验证；检查磁盘数据而不只看当前内存对象。

### AI、HTTP 和 MCP
- 使用 mock HTTP/固定响应测试请求格式、非 2xx、超时、断网、坏 JSON、流式结束、流式中止和重复生成；
- API Key 不得进入日志、截图、测试 fixture 或提交记录；
- Provider request parameters：测试 JSON 格式/大小/键数/嵌套限制、保留字段与凭据字段拒绝、不同协议的参数合并位置、Temperature 和最大输出 token 数边界；不要在测试中调用真实供应商。
- 模型能力探测：用固定 mock 验证文本/图片请求的接受、失败时跳过第二个请求、键值脱敏和报告按 provider/protocol/model 隔离。普通 CI 不调用真实供应商；真实探测须由用户明确点击并确认。
- 对 MCP 文本/图片块、不支持的 MIME、无效 payload、工具失败及用户确认流程分别测试；
- MCP Resources/Prompts：测试 resources/list 与 prompts/list 的分页/重复游标、resources/read 文本及二进制/图片处理、prompts/get 参数验证和三种传输层的错误路径；真实服务器兼容性仍需用用户配置的测试服务复验。
- 本地 MCP 会话：使用固定 fixture 验证多个操作复用同一子进程，并确保测试结束和插件卸载时关闭子进程；超时/意外退出后的重新启动需保留负向回归测试。
- 本地 Agent 可执行文件查找：验证 PATH 命中、PATH 缺失但常见安装目录（macOS Homebrew、Linux snap/Linuxbrew/Nix、Windows npm/pnpm/scoop/Chocolatey/WinGet、三平台共用的 Bun/Volta/mise/nvm/fnm 与 `~/.opencode/bin`）命中、找不到时回退裸命令，以及设置「查找」按钮只填入草稿、仍需「保存更改」才生效；Windows 的 npm `.cmd` 启动器需验证解析为 `node.exe` + JavaScript 入口且不经过 shell。CI 不依赖真实安装的 CLI。
- 将确定性的模拟测试和真实 provider smoke test 分开；真实 smoke test 需要明确配置和密钥，默认不应在普通 CI 中调用付费 API。

### PDF 与导出
- PDF 文字选择、固定页、批注坐标映射、缩放/旋转/resize、撤销及删除页节点；
- 验证文本层与页面 bitmap 对齐要使用真实渲染集成测试；纯函数坐标测试不能替代它；
- SVG/PNG 尺寸、透明背景、字体、嵌入资源和大画布导出；
- 记录 Obsidian 版本、操作系统和测试文件版本，避免把版本相关行为误判为确定性逻辑错误。

## 6. 真实集成测试的最小完成标准

对声称通过的关键功能，至少应有以下可追溯证据；记录需对应被测 commit，但不要求把证据文件存入 Git 仓库：

1. 测试前记录 commit SHA、Obsidian 版本和测试 Vault 路径。
2. 确认目标插件成功加载，所需命令已注册。
3. 用明确操作触发功能，而非仅在控制台直接调用内部函数。
4. 检查可观察结果：磁盘上的 Canvas JSON、Markdown/附件文件、界面或 DOM 状态。
5. 检查 Obsidian 捕获的错误和控制台错误。
6. 失败时，在 Actions 日志中保留必要命令输出，并将最小截图或实际结果附加到对应 Issue/PR。只有附件无法承载且后续确实需要下载时，才上传一个默认保留 3 天的小型 artifact；单次上传不应包含整套依赖、安装程序或无关的成功日志。只有可复现问题必需的最小输入 fixture 才纳入版本控制。不要提交临时截图、运行日志、run manifest 或专门存放验收证据的目录。
7. 在报告里明确 PASS / FAIL / BLOCKED，并注明是哪一层测试；不以单元测试通过替代宿主集成测试。

## 7. 面对环境阻塞时的降级策略

按下列次序降级，不要把不同级别混为一谈：

1. **完整本地 checkout + 依赖可用：** 跑 typecheck、所有 Vitest 测试和 production build。
2. **完整源码可用但依赖安装受阻：** 检查是否存在可用的现有 node_modules/缓存；不要假定缓存完整；报告哪些命令真实执行。
3. **只有远程 GitHub 读取能力：** 审查源码、workflow、对应 SHA 的 Actions 日志；不声称本地测试已执行。
4. **只有独立模块或源码快照可运行：** 将它们称为定向验证，明确不是完整仓库测试，并写明 snapshot 与目标 commit 的对应关系及未覆盖模块。
5. **浏览器/Obsidian 无法启动：** 保存环境诊断结果；将浏览器或宿主集成层标记为 BLOCKED，转到可运行该环境的 CI runner/VM。
6. **当前环境缺少关键依赖或网络：** 不伪造测试结果、不绕过安全策略；提出最小的外部 runner 要求，并让可运行的检查继续提供价值。

## 8. 提交前检查与结果汇报

提交前：

```bash
git status --short
git diff --check
git diff --stat
```

- 确认测试没有意外改动 fixture、Vault 数据、构建产物或密钥。
- 报告新增/修改内容，以及实际执行过的命令与结果。
- 分开列出“本地执行通过”“远程 CI 通过”“未执行/被阻塞”。
- 对未跑的测试明确写出原因和剩余风险。
- 不承诺后台执行；只汇报本次已完成并可核验的工作。

## 9. 对当前架构的具体提醒

- `esbuild.config.mjs` 将 `obsidian` 标记为 external；构建成功不代表运行时 API 一定存在或行为兼容。
- 当前 `npm run dev` 是一次性构建；如需热重建，应明确改造 watch 流程，而不要把现状描述为自动 watch。
- 纯逻辑模块应尽量保持不依赖 Obsidian，测试可直接操作 JSON 数据。
- 对内部 API、原生 Canvas DOM、PDF Embed、Portal 源文件序列化和主题相关样式，始终保留真实宿主回归测试。
- 任何新加入的 Harness 都应复用真实业务模块并保持与生产代码同源；不得用示意页面的通过结果宣称完整插件通过浏览器或 Obsidian 测试。
