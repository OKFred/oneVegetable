# 商品 Schema XML 安全边界

Alibaba `schema.render` 返回的 XML 是商品编辑的权威源文档。解析后的表单模型只用于可视化编辑；没有实际字段变化时必须逐字节返回源 XML，有变化时只补丁对应根字段的值和复合实例。

安全门禁 `inspectProductSchemaSerialization()` 提供以下状态：

- `原样`：模型与源文档语义一致，返回原始 XML。
- `安全补丁`：只更新发生变化的字段，并能从结果无损回读当前模型。
- `结构异常`：字段或实例无法绑定到源节点，阻止层级 Schema、Mock 发布及未来真实提交。

未知节点、注释、命名空间、模板、CDATA 和未编辑 HTML 保持不动。图库展示元数据不写回 XML；`fileId`、`inputValue`、`img` 及未知官方属性继续保留。真实 mutation flags 在账号 smoke test 完成前保持关闭。

## 2026-08-21 真实只读回归

- 商品：`1601928079741`
- 类目：`201712702`
- 语言：`zh_CN`
- Schema：136,570 UTF-8 字节、45 个根字段
- 结果：无编辑序列化逐字节一致，`noOp=true`、`safe=true`
- 校验：复合图片、关键词、发货期和阶梯价不再因模板或父字段空值误报
- 剩余硬错误：`superText` 命中官方带 `exProperty="not include"` 的邮箱正则，现有详情包含邮箱格式内容，应继续提示整改
- 安全边界：没有调用 `updateProduct`、发布、保存平台草稿或其他商品 mutation

脱敏诊断保存在忽略目录 `artifacts/real-web-smoke/`，不提交完整 XML、Token、凭据或真实响应。
