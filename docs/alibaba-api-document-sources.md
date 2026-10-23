# Alibaba OpenAPI 文档源策略

## 决策

Alibaba OpenAPI 接口按协议分别审计，不把任一站点单独视为完整目录；旧 TOP 接口继续采用双源审计：

- 旧 TOP 接口的淘宝开放平台详情页（`open.taobao.com/api.htm`）作为请求参数、嵌套类型、响应结构、示例、错误码和更新时间的契约主源。
- Alibaba.com 国际站开放平台目录（`developer.alibaba.com` 的国际站目录及文章）作为业务归属、免费标签、授权要求、聚石塔限制、业务资格和生命周期的准入标签源。
- Alibaba 国际站原生运营页面只作为字段回填、交互流程和展示口径的行为对照，不调用、抓取或依赖其私有接口，也不作为公共契约或准入证据。
- 新版 IOP 的 `openapi.alibaba.com` 接口详情和开发指南作为对应新协议的契约、OAuth、签名和网关主源；不能用旧 TOP 文档替代新接口参数或凭据规则。
- `openapi/one-vegetable.json` 仍是应用、Mock、扩展消息和 BFF 的唯一运行时契约；官方文档只作为离线生成输入和审计证据，运行时与 CI 不访问文档站。

### 新旧版区分与推荐（2026-10-11）

- 后续新增、规划和用户指引优先推荐有对应能力且经验证的新版 IOP。现有旧版能力作为兼容路径保留，不因为“推荐新版”就静默替换或禁用用户的可用配置。
- 审计记录分别标注协议（TOP/OAuth 或 IOP）、应用来源、API 名称/路径、授权与刷新地址、业务网关、签名、文档更新时间和真实验收状态；界面推荐不能把“文档存在”说成“当前账号可用”。
- 新旧应用的 AppKey、AppSecret、Access Token、Refresh Token 和签名不能混用。权限组 `System API` 与 `SystemAPI` 分开记录；新版组 Active 不等于旧 Refresh Token 可刷新，也不代表所有业务权限已迁移。
- 同名业务 API 在新版可能使用路径名称和新的响应包裹；逐项依据新版详情及 SDK 协议说明映射，不通过字符串替换批量猜路径。两版文档冲突时按所实现的协议选择主源，而不是单纯比较域名或日期。
- 业务接口生命周期与平台传输协议分开记录：旧平台上的 active Schema 发品接口不因使用 TOP 就自动变为 deprecated；新版平台也可能承载旧业务能力，仍须核对具体路径和 SDK 协议。
- 新版首次迁移至少验证授权、换 Token、续期及真实业务只读链路；写接口另行受控验收。切换当前工作台配置须由用户确认，失败不回退 Mock、不自动重放任务。
- 本轮新版授权、续期和真实商品列表已成功，但现有 BFF/插件尚未迁移为新版生产适配器；不要直接将独立候选授权包导入旧 TOP 配置。

参考：[新版 HTTP 请求与签名](https://openapi.alibaba.com/doc/doc.htm#/?docId=61)、[SDK 协议区分](https://openapi.alibaba.com/doc/doc.htm#/?docId=62)、[新版授权验收记录](alibaba-authorization-renewal.md)。

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

2026-09-10 补充：对淘宝官方详情明确标为 ICBU、免费且不需用户授权，但国际站旧目录未收录的方法，允许保留独立 TOP 补充审计并进行用户明确授权的少量验证。不得把补充条目当作国际站目录重审结果；应用 API 权限仍由平台判断。文本翻译的用户提供文档、差异及权限拒绝证据见 `icbu-text-translation.md`，未标记 account-verified。

新增或重新审计接口时必须完成：

1. 在淘宝详情页确认方法名、参数、嵌套结构、响应、错误码和更新时间。
2. 在国际站目录或文章确认领域、费用、授权、聚石塔和业务资格。
3. 保存两侧文档地址、文档 ID、检查日期和差异；缺少任一侧证据时明确标记未知项。
4. 通过人工 override 处理条件必填、异常示例和类型冲突。
5. 更新领域文档快照、`openapi/one-vegetable.json`、生成类型、standalone validator、Mock example 和适配器测试。
6. 先完成无账号 Mock/Replay 验证；真实账号验证结果单独记录为 `account-verified`，不反向修改全局准入标签。

每次开始新的领域迭代前，先对两套目录执行差异审计，再决定新增、保留、废弃或默认关闭的方法；不能沿用旧快照数量作为固定目标。

### 协议注册清单（离线）

后续新增或重审 API 必须明确登记 `TOP / IOP / both / unconfirmed`，不能从接口名称、说明文字或“新版推荐”推断协议。机器可核对清单为 `docs/alibaba-protocol-registration.json`：

- 逐逻辑方法记录 TOP 精确方法名与官方来源、IOP 显式映射或目录精确标题对应的路径与官方来源。TOP 通用首页不算方法详情证据；未出现在当前 IOP 目录快照中的条目只记为文档 `unconfirmed`，不能据此宣称平台不支持。
- `documentedProtocols` 仅描述已确认文档的组合；请同时查看 `top.documentation` 和 `iop.documentation`，`top` 不等于“IOP 不存在”。已实测的旧别名可保留 IOP `accountVerified` 和说明，但不冒充当前公开目录保证。
- 两个协议分别记录 `adapted`、`accountVerified` 和 `constraints`。TOP 接受结果不继承到 IOP；现有 TOP 验证标签和 `IOP_METHODS` 独立实测标记分别作为历史证据，生成器不执行新的账号验证。文档存在、适配完成和账号实测均不代表当前应用权限、业务资格或写操作授权。
- 数据仅从现有 capability 定义/目录、显式 `IOP_METHODS` 与检入的 `docs/alibaba-iop-api-docs.json` 生成；不抓取在线文档，不请求供应商，不改变运行时路由。报告只在脚本/单元测试中使用，不导入运行时或 UI。

更新输入后运行 `pnpm exec tsx scripts/generate-protocol-registration.ts`；用 `pnpm exec tsx scripts/generate-protocol-registration.ts --check` 检查漂移。普通 Vitest 单元测试会在内存中重新生成完整数据并比较检入 JSON，新增方法或源证据变化必须同步审阅清单。

## 快速发品与旧接口取舍

- `docId=27010` 对应的 `alibaba.icbu.product.update.field` 已由国际站官方变更说明列为旧发品链路，不进入快速发品或商品编辑主路径。
- 首次保存平台草稿使用 `alibaba.icbu.product.schema.add.draft`，首次正式发布使用 `alibaba.icbu.product.schema.add`；正式商品后续完善使用 active 的 `alibaba.icbu.product.schema.update`。
- 官方文档目前未提供可覆盖既有平台草稿的 OpenAPI。2026-08-21 真实验证中，`schema.update` 对刚创建的草稿返回 `Record does not exist`，确认它只适用于正式商品记录。因此一次平台草稿创建成功后，后续编辑只保存本地 V3 草稿，不能重复调用 `schema.add.draft`；重新进入时通过 `schema.render.draft` 读取平台基线，并提供国际站官方编辑页入口写回同一草稿。
- 快速模式允许带 Schema 内容问题保存平台草稿，但 XML 结构安全、请求契约、类目和语言仍是前置条件。直接发布与正式更新仅在商品名称、主图等最低条件缺失时提前阻止；其余 Schema 规则作为预检警告，最终以 Alibaba 接口返回为准。
- `saveProductDraft` 使用 `https://open-api.alibaba.com/sync`、HMAC-SHA256 和 Unix 毫秒时间戳。2026-08-21 真实 Smoke 已创建草稿 `1601930390138`，并由 `schema.render.draft` 回读标题与图库素材。
- 2026-09-01 使用本地构建的 MV3 扩展再次验证 `saveProductDraft`：service worker 在出网前持久化任务，平台返回草稿 `1601938471572` 后由 `schema.render.draft` 回读，任务状态为 `verified`。
- 同日通过国际站官方编辑页对该草稿同 ID 保存标题变更，再由 `schema.render.draft` 二次回读确认。官方页面使用依赖网页登录态与 CSRF 的站内提交接口，它不是 OpenAPI，不能作为 BFF 或扩展适配器。
- 2026-08-28 通过 `alibaba.icbu.product.schema.add` 完成首次正式发布真实 Smoke：平台明确返回 `biz_success=true` 和商品 ID `1601935651469`，随后商品列表回读到相同标题标记，状态为 `auditing`。2026-09-01 又通过本地构建的 MV3 service worker 发布并回读商品 `1601938537310`，扩展因此开放受持久任务保护的 `publishProduct`；staging 和 production 继续关闭。

参考：[商品接口变更说明](https://developer.alibaba.com/docs/doc.htm?articleId=119212&docType=1&treeId=456)、[Schema 增量更新接口](https://developer.alibaba.com/docs/api.htm?apiId=50189)、[草稿 Schema 回读](https://developer.alibaba.com/docs/api.htm?apiId=50205)。

## 原生页面行为对照记录

2026-08-21 对照国际站商品管理页时观察到：关键词输入提示采用 384 字符口径，原生页面展示的产品分为 `4.9/6.0`。`alibaba.icbu.product.score.get` 的正式接口文档仅定义 `final_score`，没有声明满分或最大值。项目从 2026-08-29 起按原生卖家页面将产品分展示为 6 分制，但 OpenAPI 运行时契约只约束分数非负，不硬编码最大值，也不对平台返回值做换算。

商品列表接口 `alibaba.icbu.product.list` 的响应已包含 `main_image.images`。商品列表缩略图直接使用该字段，不为每个商品额外调用详情或 Schema 接口，避免形成 N+1 请求。
