# 节点样式开发指南

面向后续 Agent。测试要求见 [TESTING.md](TESTING.md)，分支与流程见 [REPOSITORY_GOVERNANCE.md](REPOSITORY_GOVERNANCE.md)。

## 四条法则

1. **分层判断**：面板 UI 是我们自己的 DOM，随便设计；节点卡片视觉用 CSS 画；交互几何（连线端点、框选、手柄、导出）按矩形模型走，只靠设计规避，不改引擎。
2. **数据为准**：状态必须写进节点数据（`bcShape` / `bcBorderStyle` / `bcTextAlign` + `styleAttributes`），DOM 只是渲染结果；改完 `requestSave()` + 重渲染装饰。
3. **形状约定**：裁形用 `.canvas-node-container` 的 `clip-path`，描边用锚元素的 mask 环；顶点落在四边中点；预览与真实渲染共用同一套常量；别在锚元素上剪裁，会裁掉描边环和手柄。
4. **面板约定**：选项定义集中在 `src/node-visual-style.ts`；组合预设排在最前，用缩略卡片同时展示颜色/形状/边框/对齐，不印选项名；形状用可视图元，边框和对齐用图标分段控件；点击立即应用到全部选中节点；选区中同一属性有不同取值时，使用 accessible mixed 状态显示部分匹配；用主题变量；位置 clamp、Esc/外部点击关闭、监听不重复；空选区也可打开面板，选项禁用，选中节点后自动启用；面板跟随当前节点选区，Canvas 视图关闭时一并关闭。连线及节点、连线混合选区不进入节点样式面板。自适应尺寸开关只在插件设置里，不进面板。

## 落地清单（新增一个样式选项）

加选项或数据字段 → 接入解析和 `decorateCanvas` 装饰 → `styles.css` 写预览+渲染两份 → 补测试 → 跑 `lint/typecheck/test/build` + 桌面深浅色实测 → 更新 `README` / [INTEGRATION_MATRIX](INTEGRATION_MATRIX.md)。

## 一条底线

样式入口挂在原生 `.canvas-controls` 控件栈里，**不要 patch 或替换原生节点右键菜单**：它承载原生操作和其他插件的条目，替换会吞掉它们。新增入口时同样要 feature-detect，找不到控件容器就安静跳过。
