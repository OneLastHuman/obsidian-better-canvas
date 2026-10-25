# 安装与构建指南

Better Canvas 要求 Obsidian 1.5.0 或更高版本。手动安装时，插件目录必须同时包含 `main.js`、`manifest.json` 和 `styles.css`。

## 方式一：从 GitHub Releases 安装

1. 打开 [GitHub Releases](https://github.com/OneLastHuman/obsidian-better-canvas/releases)，下载对应版本的 `obsidian-better-canvas.zip`。
2. 将 ZIP 解压到 Vault 的 `.obsidian/plugins/` 目录。压缩包内已包含 `obsidian-better-canvas/` 文件夹，最终目录应如下：

   ```text
   <Vault>/.obsidian/plugins/obsidian-better-canvas/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. 打开 Obsidian 的 **设置 → 社区插件**，重新加载插件列表并启用 **Better Canvas**。

Releases 也会提供三个独立文件，可按下方的手动安装方式使用。

## 方式二：手动安装 main 分支构建

将以下文件放入 `<Vault>/.obsidian/plugins/obsidian-better-canvas/`：

- [main.js（生产构建）](https://raw.githubusercontent.com/OneLastHuman/obsidian-better-canvas/main/release/main.js)
- [manifest.json](https://raw.githubusercontent.com/OneLastHuman/obsidian-better-canvas/main/release/manifest.json)
- [styles.css](https://raw.githubusercontent.com/OneLastHuman/obsidian-better-canvas/main/release/styles.css)

然后在 **设置 → 社区插件** 中重新加载列表并启用插件。

成功的 `main` 分支 Build workflow 会将生产构建的 `main.js`、`manifest.json` 和 `styles.css` 同步到 [`release/`](https://github.com/OneLastHuman/obsidian-better-canvas/tree/main/release) 目录。`main.js` 是构建产物，不纳入版本控制，只在本地构建后生成。Pull Request 构建只负责验证，不生成安装包 artifact。`release/` 提供主分支最新成功构建，不等同于固定的正式版本；正式版请使用 GitHub Releases。

## 方式三：从源码构建

需要安装 Node.js 22 和 npm：

```bash
git clone https://github.com/OneLastHuman/obsidian-better-canvas.git
cd obsidian-better-canvas
npm install
npm run build
```

构建完成后，将生成的 `main.js` 与仓库中的 `manifest.json`、`styles.css` 一起复制到插件目录。

`npm run dev` 执行一次开发构建。修改源码后需重新运行该命令。

## 验证与常见问题

- **插件没有出现在列表中：** 确认目录层级没有多嵌套一层，并确保目录内存在三个必需文件。
- **更新后功能没有变化：** 在社区插件设置中重新加载插件列表，必要时重启 Obsidian。
- **CI 构建与实际行为不同：** CI 执行类型检查、单元测试和生产构建，但不会启动 Obsidian GUI；Canvas 原生交互、菜单、Portal、PDF 坐标及真实 AI 请求仍需在目标环境验证。
- **修改源码后准备交付：** 按 [标准本地检查](TESTING.md#3-本项目的标准本地检查) 执行检查。自动化检查通过不代表 Obsidian 运行时行为已验证。

测试层级和验证证据要求以 [测试与验证规范](TESTING.md) 为准。
