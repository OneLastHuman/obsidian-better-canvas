# Issue 102 — 切换协议后 Temperature 范围说明和输入上限未更新

- 对应问题：[GitHub Issue #102](https://github.com/OneLastHuman/obsidian-better-canvas/issues/102)
- 修复前基线：`cb397ed0f1f9e6ab0da7f4ffef9c0d0a5dd2795e`（`origin/main`），安装包 `main.js` SHA-256 `1800f7f218e104162746dfc215259847fb0b0bee11ba59b0c942d25efec9c922`
- 被测代码 commit：`e14c511ad5b057d1308188e66a7767bd6757eb92`，安装包 `main.js` SHA-256 `e70f3992bdeb42d24685e0cdb7fa5e8fa35782f646e23b329af8c1d1c18010b5`（与测试 Vault 中安装的产物哈希一致）
- 被测 Obsidian：1.14.4 桌面版（Linux AppImage，隔离 Xvfb `:242`，CDP `127.0.0.1:9602`），Chromium 150.0.7871.250 / Electron 43.7.7
- 测试方式：Playwright CLI 0.1.22 经 CDP 操作真实 Obsidian 设置界面；点击、输入与下拉选择都作用于真实控件，断言读取真实 DOM（范围说明、`max`、`aria-invalid`、通知文本）和 Vault 里插件 `data.json` 的实际持久化结果，没有 mock 设置页面。
- 测试结果：修复前 2 项复现全部成立，修复后 5 项检查全部通过；两个窗口的 console error 均为 0，也没有观察到动态网络请求。
- 安全边界：仅使用独立合成 Vault `~/bc-vault-102`，`apiKey` 为空，没有配置真实服务商，也没有调用任何供应商 API。

## 修复前

1. `01-before-stale-range.png`：协议已是 Anthropic（磁盘 `protocol=anthropic`，`temperature=1.5`），但 Temperature 仍显示「范围 0 到 2」，输入框 `max=2`、值为 `1.5` —— 界面允许并显示的值正好落在请求阶段校验会拒绝的区间。
2. `02-before-silent-reset.png`：重启 Obsidian 后，上次保存的 `temperature=1.5` 被静默改成 `0.4`（磁盘同样变为 `0.4`），没有提示，用户无法判断这是协议限制还是设置丢失。

## 修复后

3. `03-after-start-openai.png`：同一初始状态（协议 OpenAI 兼容，Temperature `1.5`，「范围 0 到 2」），作为对照起点。
4. `04-after-switch-clamped.png`：把协议切到 Anthropic 的同一渲染会话内，说明立即变为「Anthropic 范围 0 到 1」，输入框 `max=1`，值调整为 `1`，磁盘同时写入 `temperature=1`。
5. `05-after-switch-notice.png`：切换时弹出通知「Temperature 已按当前协议上限从 1.5 调整为 1。」（窗口右上角），值的变化是被告知的，不再静默。
6. `06-after-range-error.png`：协议已是 Anthropic 时输入 `1.5`，出现「请输入 0–1 范围内的数值；当前值尚未保存。」和 `aria-invalid="true"`，磁盘值保持 `1` 不变；改成 `1` 后错误清除并保存。
7. `07-after-reload-keeps-value.png`：再次重启 Obsidian，`temperature` 仍为 `1`，界面显示 `1` 与「Anthropic 范围 0 到 1」，没有再被静默改写。

## 观察到的值

| 步骤 | 协议 | 范围说明 | 输入框 `max` | 输入框值 | 磁盘 `temperature` |
| --- | --- | --- | --- | --- | --- |
| 修复前：切到 Anthropic | anthropic | 范围 0 到 2 | 2 | 1.5 | 1.5 |
| 修复前：重启后 | anthropic | Anthropic 范围 0 到 1 | 1 | 0.4 | 0.4 |
| 修复后：切到 Anthropic | anthropic | Anthropic 范围 0 到 1 | 1 | 1 | 1 |
| 修复后：Anthropic 下输入 `1.5` | anthropic | Anthropic 范围 0 到 1 | 1 | 1.5（未保存） | 1 |
| 修复后：Anthropic 下输入 `1` | anthropic | Anthropic 范围 0 到 1 | 1 | 1 | 1 |
| 修复后：重启后 | anthropic | Anthropic 范围 0 到 1 | 1 | 1 | 1 |
