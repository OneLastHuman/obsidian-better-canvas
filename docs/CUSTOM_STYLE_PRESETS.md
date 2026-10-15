# CSS 自定义样式预设

Better Canvas 可读取已加载 CSS 样式表中的 Advanced Canvas 兼容配置，并将预设值持久化到 Canvas 节点或连线的 `styleAttributes` 中。对应值会作为 `data-<key>` 属性暴露给 CSS，方便样式片段按状态应用外观。

## 定义节点样式

在 Obsidian 已启用的 CSS snippet 中加入配置注释：

```css
/* @advanced-canvas-node-style
key: validation-state
label: Validation State
icon: hourglass
options:
  -
    label: Stateless
    value: null
  -
    label: Approved
    value: approved
  -
    label: Pending
    value: pending
*/
.canvas-node[data-validation-state="approved"] {
  border-color: var(--color-green);
}
.canvas-node[data-validation-state="pending"] {
  border-color: var(--color-orange);
}
```

连线使用 `@advanced-canvas-edge-style`，声明结构相同。每个配置必须有合法的 `key`、非空 `label`、至少一个选项，并且恰好有一个不带引号的 `value: null` 选项用于重置。键名只允许小写字母、数字和连字符，并须以小写字母开头。重复的同类型键名会由后出现的定义替代。

## 使用

选中一个或多个节点，运行命令面板中的 **Better Canvas: 应用 CSS 自定义样式预设**，再选择属性值。也可以从节点右键菜单打开该选择器。连线可通过选中一个或多个连线后运行同一命令应用预设。节点与连线不能混合选择。

选择重置选项会把对应属性值写为 `null`，渲染时移除匹配的 `data-<key>` 属性。原有的其他 `styleAttributes` 会保留。应用样式会更新 Canvas JSON 并请求保存。

## 限制

- 配置来自已加载的内联样式，或从当前 Vault 的配置目录（`Vault.configDir`）下读取的 CSS snippet 原始文件。读取 snippet 原文可以保留 CSSOM 中不可见的配置注释；远程样式表不会被读取。找不到源文件或文件无法访问时会跳过该样式表。
- 配置解析器仅支持此预设格式所需的 YAML 标量与列表子集，不支持 YAML 锚点、别名、自定义标签或复杂对象。
- CSS 声明由用户的 Obsidian CSS snippet 负责；Better Canvas 仅保存属性并暴露数据属性，不会自动创建 CSS 规则。
- 真实渲染仍须在目标 Obsidian 版本中验证。
