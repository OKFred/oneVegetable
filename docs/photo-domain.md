# 图库域与素材治理

## 范围

本迭代固定了 2026-08-21 的 4 个国际站图库（官方文档称“图片银行”）免费目录接口：

- `alibaba.icbu.photobank.group.list`
- `alibaba.icbu.photobank.group.operate`
- `alibaba.icbu.photobank.list`
- `alibaba.icbu.photobank.upload`

官方文档快照保存在 `docs/alibaba-photo-api-docs.json`，人工修正在
`config/alibaba-photo-overrides.json`。`openapi/one-vegetable.json` 仍是运行时唯一契约，生成
`PhotoCapabilityRequestMap`、`PhotoCapabilityResponseMap` 和 CSP 安全的 standalone validators。

`alibaba.icbu.file.urlposting.upload` 被明确记录在排除清单中。它只能返回 URL，不能保证返回图库
`fileId`，因此不能替代图库素材上传。外部 URL 转存继续由 service worker 安全下载图片字节，再调用
`alibaba.icbu.photobank.upload`。

## 运行时边界

- `PhotoAdapter` 统一处理官方嵌套响应、分组层级、分页、日期、HTTPS URL 和 `fileId`。
- `group.list` 不传 `id` 时读取一级分组；选择一级分组后以其 `id` 懒加载当前分组及全部子分组。页面不再依赖一次请求返回完整树。
- 页面只调用严格类型的 runtime message，不能访问 App Secret 或直接访问 Alibaba 网关。
- 查询分组和素材属于只读能力；分组操作、上传和 URL 转存属于真实写能力。
- 所有真实写能力在取得账号并完成逐方法 smoke test 前保持关闭，Web Mock 可完整体验。
- 响应 Schema 漂移由通用能力调试器返回原始数据、`traceId` 与契约告警，不伪造成功结果。

## 素材治理

图库工作台显示文件大小、引用数量、更新时间和图库 `fileId`，并提供两类确定性建议：

- 未引用：`referenceCount` 为 0，提示评估是否清理。
- 低分辨率：宽或高低于 750 px，提示替换高清素材。官方 `photobank.list` 不返回尺寸时，页面从已加载图片的自然尺寸补充；读取完成前不判定为低分辨率。

这些建议只用于筛选和整改，不阻止素材选择或商品提交。官方 Schema 的图片尺寸硬规则仍由商品表单
的 AJV/Schema 校验负责，二者不会混为一类。

## 验证边界

2026-08-20 的真实账号只读 Smoke 已确认 `alibaba.icbu.photobank.group.list` 与
`alibaba.icbu.photobank.list` 均通过，分别返回 12 个分组和 10 个素材，且契约漂移为 0。Web Mock
继续用于完整写流程演示；`group.operate`、`photobank.upload` 和 URL 转存属于 mutation，仍在出网前关闭，
不能把只读通过表述为真实写操作验收。
