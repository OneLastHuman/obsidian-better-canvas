# 主题设计与原型

本目录保存主题的设计说明和浏览器原型。原型可用于比较视觉方案；当前插件的使用方式见 [功能指南](../FEATURE_GUIDE.md#画布主题)。

| 主题 | 设计说明 | 浏览器原型 |
| --- | --- | --- |
| 手绘白板 | [功能预设设计](excalidraw-presets.design.md) | [手绘原型](excalidraw-theme.prototype.html) |
| 软糖白板 | [风格与形状设计](rounded-map-theme.design.md) | [软糖原型](rounded-map-theme.prototype.html) |

## 打开原型

可直接用浏览器打开 HTML 文件，也可从仓库根目录启动本地服务器：

```bash
python3 -m http.server 4177 --bind 127.0.0.1 --directory docs/design
```

启动后访问 `http://127.0.0.1:4177/`，选择对应 HTML 文件。

手绘原型依赖相邻的 `excalidraw-theme.prototype-assets/` 目录。复制原型时需同时复制该目录；资源来源和许可证见 [资源说明](excalidraw-theme.prototype-assets/README.md)。

软糖原型的文档形状由 [`rounded-map-style.test.ts`](../../src/rounded-map-style.test.ts) 读取并检查。移动或修改原型时，需同步测试路径并运行该测试。

## 查阅范围

原型独立绘制页面，不能证明 Obsidian 中的交互或兼容性。设计文档中的验证记录保留原日期和范围，当前实现与验证状态见 [功能整合矩阵](../INTEGRATION_MATRIX.md)。

可复制到 Vault 的画布见 [示例画布](../examples/README.md)。过去的实施步骤见 [历史记录](../archive/README.md)。
