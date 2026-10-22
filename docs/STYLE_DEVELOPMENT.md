# 节点样式开发指南

面向后续 Agent。测试要求见 [TESTING.md](TESTING.md)，分支与流程见 [REPOSITORY_GOVERNANCE.md](REPOSITORY_GOVERNANCE.md)。

## 四条法则

1. **分层判断**：面板 UI 是我们自己的 DOM，随便设计；节点卡片视觉用 CSS 画；交互几何（连线端点、框选、手柄、导出）按矩形模型走，只靠设计规避，不改引擎。
2. **数据为准**：状态必须写进节点数据（`bcShape` / `bcBorderStyle` / `bcTextAlign` + `styleAttributes`），DOM 只是渲染结果；改完 `requestSave()` + 重渲染装饰。
3. **形状约定**：裁形用 `.canvas-node-container` 的 `clip-path`，描边用锚元素的 mask 环；顶点落在四边中点；预览与真实渲染共用同一套常量；别在锚元素上剪裁，会裁掉描边环和手柄。
4. **面板约定**：选项定义集中在 `src/node-visual-style.ts`；组合预设排在最前，用缩略卡片同时展示颜色/形状/边框/对齐，不印选项名；形状用可视图元，边框和对齐用图标分段控件；点击立即应用到全部选中节点；选区中同一属性有不同取值时，使用 accessible mixed 状态显示部分匹配；用主题变量；位置 clamp、Esc/外部点击关闭、监听不重复；空选区也可打开面板，选项禁用，选中节点后自动启用；面板跟随当前节点选区，Canvas 视图关闭时一并关闭。连线及节点、连线混合选区不进入节点样式面板。自适应尺寸开关只在插件设置里，不进面板。

## 落地清单（新增一个样式选项）

「柔软便签」的六款主题预设和曲线集中在 `src/soft-notes-style.ts`，通过 `bcTheme: "soft-notes"` 与节点的 `bcSoftNotesPreset` 保存。实时节点使用同源 SVG `objectBoundingBox` 裁剪，缩略图与完整导出复用同一个路径；视口导出须携带裁剪定义及内嵌字体。此主题只裁剪文本节点的容器，不裁剪定位锚点，且始终隐藏卡片描边和阴影。编辑器专用样式放入同源 iframe 的 body，避免被 Obsidian 的 head 同步机制移除。

加选项或数据字段 → 接入解析和 `decorateCanvas` 装饰 → `styles.css` 写预览+渲染两份 → 补测试 → 跑 `lint/typecheck/test/build` + 桌面深浅色实测 → 更新 `README` / [INTEGRATION_MATRIX](INTEGRATION_MATRIX.md)。

## 一条底线

样式入口挂在原生 `.canvas-controls` 控件栈里，**不要 patch 或替换原生节点右键菜单**：它承载原生操作和其他插件的条目，替换会吞掉它们。新增入口时同样要 feature-detect，找不到控件容器就安静跳过。

## 软糖白板

`bcTheme: "rounded-map"` 的六种组合定义在 `src/node-visual-style.ts`，应用时复用 `bcShape`、`bcBorderStyle`、`bcTextAlign`、颜色及 `styleAttributes`。`src/rounded-map-style.ts` 按节点尺寸生成同源路径，供容器 CSS `clip-path: path(...)`、锚元素 mask 描边、预设缩略图及静态导出使用。尺寸变更时重新计算装饰；切换主题或卸载时移除私有 CSS 变量。路径仅绘制视觉，不改变原生矩形交互几何。
