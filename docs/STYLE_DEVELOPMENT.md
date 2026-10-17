# 节点样式开发指南

面向后续 Agent。测试要求见 [TESTING.md](TESTING.md)，分支与流程见 [REPOSITORY_GOVERNANCE.md](REPOSITORY_GOVERNANCE.md)。

## 四条法则

1. **分层判断**：面板 UI 是我们自己的 DOM，随便设计；节点卡片视觉用 CSS 画；交互几何（连线端点、框选、手柄、导出）按矩形模型走，只靠设计规避，不改引擎。
2. **数据为准**：状态必须写进节点数据（`bcShape` / `bcBorderStyle` / `bcTextAlign` + `styleAttributes`），DOM 只是渲染结果；改完 `requestSave()` + 重渲染装饰。
3. **形状约定**：裁形用 `.canvas-node-container` 的 `clip-path`，描边用锚元素的 mask 环；顶点落在四边中点；预览与真实渲染共用同一套常量；别在锚元素上剪裁，会裁掉描边环和手柄。
4. **面板约定**：选项定义集中在 `src/node-visual-style.ts`；每个选项有可视图元和 aria 标签；点击立即应用；用主题变量；位置 clamp、Esc/外部点击关闭、监听不重复。

## 落地清单（新增一个样式选项）

加选项或数据字段 → 接入解析和 `decorateCanvas` 装饰 → `styles.css` 写预览+渲染两份 → 补测试 → 跑 `lint/typecheck/test/build` + 桌面深浅色实测 → 更新 `README` / [INTEGRATION_MATRIX](INTEGRATION_MATRIX.md)。

## 一条底线

原生 popup 与菜单是内部 API：patch 要 feature-detect、失败回退原生；不破坏原生交互和导出。
