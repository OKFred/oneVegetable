# 商品详情可视化编辑

商品发布/编辑默认使用六步新手向导，技术字段类型和 Schema XML 默认隐藏。必填项与带官方提示的推荐项优先展示，其他字段位于“更多选填信息”；最终检查页可从问题直接跳回字段。高级模式仍展示完整单页表单与 XML 预览，切换模式不会复制或丢失表单值。

商品分组字段使用可复用的三级名称选择器，不向新手直接暴露 `group_id`。一级、二级和三级名称通过 `alibaba.icbu.product.group.get` 按父级懒加载，Schema 内仍无损保存官方分组 ID；无法解析的历史 ID 会明确显示为未知分组并保留原值。

浏览器草稿使用版本化 V2 结构，按 `existing:<productId>` 或 `new:<categoryId>` 隔离。表单变化约 750 ms 后自动保存；最多保留最近 10 份和 30 天内草稿。恢复前必须由用户确认，旧单一草稿键迁移后也不会自动覆盖平台 Schema。

## 支持边界

国际站 Schema 中 `valueTypeRule=html` 或字段 ID 为 `superText` 时，界面加载受限 Tiptap 编辑器。提交仍走 Schema 发布/更新接口，并将详情类型保持为 `productDescType=2`。当前 API 不直接维护智能详情，也不尝试生成智能详情。

智能详情或包含不支持 HTML 的历史详情不会在加载时被自动改写：界面先显示原始 HTML，只读保存；用户点击“查看转换变化”后可检查删除、解包和链接加固清单，第二次确认才把安全结果写回 Schema。

允许的标签是：`p`、`br`、`h2`–`h4`、`strong`、`em`、`u`、`ul`、`ol`、`li`、`blockquote`、`table`、`tbody`、`tr`、`th`、`td`、`a`、`img`、`hr`。链接限 HTTP(S) 并固定安全 `rel`；图片限国际站 PhotoBank CDN。脚本、事件属性、iframe、表单、内联样式、class 和未知属性会被删除。

## 图库（图片银行）

`Photo.id` 对应国际站图库 `fileId`。Schema `<value>` 会无损保存 `fileId`、`inputValue`、`img` 等属性；主图保存 URL 与 `fileId`，详情图片保存安全 `<img>` 和内部 PhotoBank 关联。

复用选择器支持：

1. 按分组与分页选择已有素材。
2. 本地上传成功后自动选中。
3. 下载公共 HTTP(S) 图片后上传 PhotoBank，并自动插入。

URL 转存只在扩展 service worker 下载。校验覆盖凭据 URL、localhost、本地域名、回环、私网、link-local、逐跳重定向、图片 Content-Type 和流式大小上限。绝对上限为 20 MiB；Schema 限制更小时使用更小值。真实写操作仍受 mutation flag 控制。

## 整改等级

- `Alibaba Schema`：必填、类型、长度、正则和 Schema 图片规则等硬错误，阻止提交。
- `官方提示`：`tipRule`、`devTipRule` 与 `product.score.get` 的问题，仅提示。
- `项目建议`：确定性内容和图片质量检查，仅提示。

项目建议包括空/过短详情、长文缺少标题、超长段落、图片缺少 alt、加载失败、重复、低于 750×750、非图库来源、空表格/列表及联系方式或外部引流。提交按钮会显示建议数量，但不会因此禁用。

## 无账号验证

Web Mock 内置普通详情、商品 `10000002` 的智能详情、商品 `10000003` 的历史详情、图片选择、上传、URL 转存和官方评分。MV3 E2E 只验证查询入口与真实写按钮保持禁用；取得账号后才逐方法增加真实 smoke test。
