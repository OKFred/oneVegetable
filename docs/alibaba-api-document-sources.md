# Alibaba OpenAPI 文档源策略

## 决策

Alibaba OpenAPI 接口采用双源审计，不把任一站点单独视为完整目录：

- 淘宝开放平台接口详情页（`open.taobao.com/api.htm`）作为请求参数、嵌套类型、响应结构、示例、错误码和更新时间的契约主源。
- Alibaba.com 国际站开放平台目录（`developer.alibaba.com` 的国际站目录及文章）作为业务归属、免费标签、授权要求、聚石塔限制、业务资格和生命周期的准入标签源。
- Alibaba 国际站原生运营页面只作为字段回填、交互流程和展示口径的行为对照，不调用、抓取或依赖其私有接口，也不作为公共契约或准入证据。
- `openapi/one-vegetable.json` 仍是应用、Mock、扩展消息和 BFF 的唯一运行时契约；两套官方文档只作为离线生成输入和审计证据，运行时与 CI 不访问文档站。

淘宝详情页通常能检索到国际站目录未展示的接口详情，例如 `alibaba.icbu.product.group.get`。这不代表淘宝站的所有内容都自动适用于国际站，也不表示它在每个接口上都更新；是否接入仍须通过国际站准入标签审计。

## 冲突处理

同一方法在两套文档中不一致时，按以下顺序处理：

1. 请求和响应结构优先采用淘宝详情页，并保留页面的文档 ID、更新时间和抓取日期。
2. 免费、收费、聚石塔、ISV、额外权限和业务资格等调用边界以国际站目录或国际站官方文章为准。
3. 国际站目录没有列出的方法不能仅凭淘宝详情页标记为“免费可调用”；先记为 `unlisted` 或默认关闭，取得官方准入证据后再启用。
4. 国际站文章明确宣布迁移、废弃或下线时，文章结论高于旧接口详情页；旧接口可保留类型化能力，但必须标记 `deprecated` 或禁用。
5. 文档示例、字段类型或条件必填互相冲突时，在领域 override 文件记录原值、采用值、理由和检查日期，不静默覆盖原始快照。
6. 真实账号响应只能作为契约差异证据，不能替代通用授权、免费或业务资格判断。

## 新增接口流程

新增或重新审计接口时必须完成：

1. 在淘宝详情页确认方法名、参数、嵌套结构、响应、错误码和更新时间。
2. 在国际站目录或文章确认领域、费用、授权、聚石塔和业务资格。
3. 保存两侧文档地址、文档 ID、检查日期和差异；缺少任一侧证据时明确标记未知项。
4. 通过人工 override 处理条件必填、异常示例和类型冲突。
5. 更新领域文档快照、`openapi/one-vegetable.json`、生成类型、standalone validator、Mock example 和适配器测试。
6. 先完成无账号 Mock/Replay 验证；真实账号验证结果单独记录为 `account-verified`，不反向修改全局准入标签。

每次开始新的领域迭代前，先对两套目录执行差异审计，再决定新增、保留、废弃或默认关闭的方法；不能沿用旧快照数量作为固定目标。

## 快速发品与旧接口取舍

- `docId=27010` 对应的 `alibaba.icbu.product.update.field` 已由国际站官方变更说明列为旧发品链路，不进入快速发品或商品编辑主路径。
- 首次保存平台草稿使用 `alibaba.icbu.product.schema.add.draft`，首次正式发布使用 `alibaba.icbu.product.schema.add`；正式商品后续完善使用 active 的 `alibaba.icbu.product.schema.update`。
- 官方文档目前未提供可覆盖既有平台草稿的 OpenAPI。2026-08-21 真实验证中，`schema.update` 对刚创建的草稿返回 `Record does not exist`，确认它只适用于正式商品记录。因此一次平台草稿创建成功后，后续编辑只保存本地 V3 草稿，不能重复调用 `schema.add.draft`；重新进入时通过 `schema.render.draft` 读取平台基线，并提供国际站官方编辑页入口写回同一草稿。
- 快速模式允许带 Schema 内容问题保存平台草稿，但 XML 结构安全、请求契约、类目和语言仍是前置条件。直接发布与正式更新仍要求 Schema 硬错误清零。
- `saveProductDraft` 使用 `https://open-api.alibaba.com/sync`、HMAC-SHA256 和 Unix 毫秒时间戳。2026-08-21 真实 Smoke 已创建草稿 `1601930390138`，并由 `schema.render.draft` 回读标题与图库素材。
- 同日通过国际站官方编辑页对该草稿同 ID 保存标题变更，再由 `schema.render.draft` 二次回读确认。官方页面使用依赖网页登录态与 CSRF 的站内提交接口，它不是 OpenAPI，不能作为 BFF 或扩展适配器。
- 2026-08-28 通过 `alibaba.icbu.product.schema.add` 完成首次正式发布真实 Smoke：平台明确返回 `biz_success=true` 和商品 ID `1601935651469`，随后商品列表回读到相同标题标记，状态为 `auditing`。本地 Node real 因此开放受 flag 保护的 `publishProduct`；staging、production 和扩展真实商品写入继续关闭。

参考：[商品接口变更说明](https://developer.alibaba.com/docs/doc.htm?articleId=119212&docType=1&treeId=456)、[Schema 增量更新接口](https://developer.alibaba.com/docs/api.htm?apiId=50189)、[草稿 Schema 回读](https://developer.alibaba.com/docs/api.htm?apiId=50205)。

## 原生页面行为对照记录

2026-08-21 对照国际站商品管理页时观察到：关键词输入提示采用 384 字符口径，原生页面展示的产品分为 `4.9/6.0`。`alibaba.icbu.product.score.get` 的正式接口文档仅定义 `final_score`，没有声明满分或最大值。项目从 2026-08-29 起按原生卖家页面将产品分展示为 6 分制，但 OpenAPI 运行时契约只约束分数非负，不硬编码最大值，也不对平台返回值做换算。

商品列表接口 `alibaba.icbu.product.list` 的响应已包含 `main_image.images`。商品列表缩略图直接使用该字段，不为每个商品额外调用详情或 Schema 接口，避免形成 N+1 请求。
