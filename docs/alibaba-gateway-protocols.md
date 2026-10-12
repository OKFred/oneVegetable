# Alibaba TOP / IOP 双协议兼容

## 默认与迁移

TOP 仍是默认协议，不自动替换已有本地、Node、Cloudflare 或插件凭据。历史授权包和加密设置没有 `protocol` 时按 TOP 读取；未知协议标识拒绝，不猜测 AppKey 或 Token 所属协议。

新版应用导出包通过 `protocol: "iop"` 显式标记。管理员或插件用户确认导入后才替换该工作台配置；导入包含明文密钥的 JSON 前应备份原授权包。旧 TOP 包仍可重新导入，两种协议不得共享或混搭凭据。

| 协议            | 业务网关                                                      | 认证与签名                                                        | 续期                                  |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| TOP（历史默认） | `https://eco.taobao.com/router/rest`，部分既有操作使用旧 sync | `method`、`session`、既有 TOP 签名；保持原行为                    | 旧 OAuth Token 端点                   |
| IOP（显式选择） | `https://openapi-api.alibaba.com/rest` + 逐项登记 API path    | `access_token`、毫秒 timestamp、API path + 排序参数的 HMAC-SHA256 | `/auth/token/refresh`；禁止跨协议刷新 |

来源：[新版 API 文档](https://openapi.alibaba.com/doc/api.htm)，[新版指南](https://openapi.alibaba.com/doc/doc.htm)。同名接口可能有不同参数、响应、权限及路径，不能用 `method.replaceAll('.', '/')` 推导。

## 当前 IOP 支持范围

| TOP 能力标识                               | IOP path                             | 适配说明                                                                                 |
| ------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `alibaba.icbu.product.list`                | `/alibaba/icbu/product/list`         | 商品分页、摘要；要求真实列表和总数                                                       |
| `alibaba.icbu.product.group.get`           | `/alibaba/icbu/product/group/get`    | 已通过账号只读核对；根目录 `group_id=-1`，此方法未出现在当前新版菜单中，不把它当目录承诺 |
| `alibaba.icbu.product.schema.render`       | `/icbu/product/schema/render`        | 将原请求 DTO 映射为 `render_request`；要求成功及 XML                                     |
| `alibaba.icbu.product.schema.render.draft` | `/icbu/product/schema/render/draft`  | 明确传入类目、语言和草稿 ID；真实草稿已创建并回读确认                                    |
| `alibaba.icbu.photobank.group.list`        | `/icbu/product/photobank/group/list` | 图片分组                                                                                 |
| `alibaba.icbu.photobank.list`              | `/icbu/product/photobank/list`       | `groupId/currentPage/pageSize`；必须选择指定分组                                         |
| `alibaba.icbu.category.get.new`            | `/icbu/product/category/get`         | 保留正式类目层级，不使用旧接口或猜测类目                                                 |
| `alibaba.icbu.category.id.mapping`         | `/alibaba/icbu/category/id/mapping`  | 旧类目映射；文档无需用户授权时不发送 access_token                                        |
| `alibaba.icbu.category.schema.level.get`   | `/icbu/product/schema/level/get`     | 层级属性 Schema；文档无需用户授权时不发送 access_token                                   |
| `alibaba.icbu.product.schema.get`          | `/alibaba/icbu/product/schema/get`   | 仅映射文档支持的 cat_id、language，不默默丢弃不支持的业务筛选                            |
| `alibaba.icbu.product.score.get`           | `/icbu/product/score/get`            | 读取真实评分，缺失或无效值不能默认成 0                                                   |
| `alibaba.icbu.product.type.available.get`  | `/icbu/product/other/available/get`  | 可用商品类型                                                                             |
| `alibaba.icbu.product.inventory.get`       | `/icbu/product/inventory/get`        | 商品库存，保留 SKU 和仓编码；单层/双层 result 按明确结构校验，缺库存不当作零             |
| `alibaba.icbu.product.id.encrypt`          | `/alibaba/icbu/product/id/encrypt`   | 已类型化；本次账号真实调用返回 InternalError，尚未通过 IOP 账号验收                      |
| `alibaba.seller.order.list`                | `/alibaba/order/list`                | 文档明确支持 seller/buyer；原角色和分页逐项映射，不支持的筛选出网前拒绝                  |
| `alibaba.seller.order.logistics.get`       | `/order/logistics/query`             | 交易 ID 映射为 trade_id；无物流状态时展示未知，不伪造已发货                              |

总览可以查询商品及订单统计；跨全部分组的图片统计仍显示不可用，不伪造为 0。IOP 的全部图片、未分组查询不猜特殊分组 ID，也不全店扫描。

写接口参数和响应适配已补齐三项，但验收与开放分开：

| 能力               | IOP path                         | 当前开放状态                                                                |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| `schema.add.draft` | `/icbu/product/schema/add/draft` | 真实创建并回读确认，允许保存平台草稿；仍需管理员和原环境 mutation flag      |
| `schema.add`       | `/icbu/product/schema/add`       | 真实创建、审核后字段回读确认；仍受管理员、环境 mutation flag 及任务核对控制 |
| `schema.update`    | `/icbu/product/schema/update`    | 标题增量修改回读、恢复原标题并再次回读通过；未修改字段不进入补丁            |

尚未找到新版公开 RFQ 方法；订单资金查询也不能以 `/order/fund/query` 的手续费字段冒充原 paidAmount。上下架文档的数字商品标识与旧能力的加密标识不等价，未确认前不猜转换。以上能力在 IOP 中返回 `ALIBABA_IOP_METHOD_UNSUPPORTED`，TOP 的原能力不受影响。

未验收写入返回 `ALIBABA_IOP_MUTATION_UNVERIFIED`。不会失败后切到 TOP、Mock 或其他应用，也不继承 TOP 的全部写白名单。无需用户授权仍需要应用签名及平台应用权限。

BFF 与插件的能力目录及方法定义使用同一协议限制：IOP 未适配方法标为不可调用；已映射的方法仍保留原有权限和启用状态，不因映射存在而自动开放。IOP 的 verification 单独由真实验收记录确定，不继承 TOP 的 account-verified 标签；未验收及未适配项显示 documented。TOP 和未标记的旧凭据保留原目录状态。

## 续期和安全

- Node/Cloudflare 凭据 Provider 按协议刷新；TOP 保持旧链路，IOP 只调用新版 System API。
- 平台未返回到期时间时保持未知；到期/失效时显示重新授权入口，不猜固定授权周期。
- IOP Refresh Token 可能轮换；结果不明时需要重新授权，不能重新发送同一个续期请求。续期在共享租约和 revision 下原子保存，配置身份不因正常 Token 刷新改变。
- 独立插件 IOP 工具可授权、续期及导出 JSON，再由工作台显式导入。旧 `pnpm openapi:auth:refresh` 只接受 TOP；遇 IOP 提示使用新版工具或凭据面板，不发送到旧端点。
- 网关校验协议与 endpoint；未适配方法和写请求出网前拒绝。公开响应仅含协议、来源、到期时间和 AppKey 尾号，不返回 Secret 或 Token。
- 新增 IOP 商品任务持久化身份和凭据配置上下文，提交及回读均绑定同一配置；换凭据后旧任务不可用新配置核对。正常 Token 刷新不改变上下文；无上下文的旧 TOP 任务不推断账号归属。
- 写请求最多发送一次；超时、缺少明确成功字段或无法解释的响应保留结果不明，不能依据 retryable=false 将其当作明确未执行。

## 验证边界

自动测试使用 `mock/data/alibaba-auth/iop-business-responses.json`，覆盖两种协议、旧包/设置、错误及预先拒绝。真实验收使用独立 IOP 包，不替换用户当前 TOP 配置、不续期现有 Token。商品写验收有独立显式确认通道，不是生产调用的绕过开关。

“IOP 只读可用”不等于其全部接口或写操作已验收。正式切换前仍需逐领域补齐映射和账号验收；当前无需旧用户重新授权或迁移。

### 2026-10-12 验收记录

- 独立 IOP 授权包真实读取通过 11 项：商品列表、商品分组、正式商品 Schema、获取类目 Schema、产品分、类目树、可用商品类型、图片分组、指定分组图片、卖家订单列表、订单物流。无发货信息的物流字段保留未知。
- 真实创建一条平台草稿，随后 schema.render.draft 回读确认商品 ID 和 XML；Node BFF 的认证链路也完成订单列表及这条草稿的只读回读。
- 正式发布与现有商品标题增量更新先取得明确受理回执，回读一度返回 `PUB_BIZCHECK_PRODUCT_IN_AUDITING`。审核结束后，新增商品字段回读匹配；现有商品的标题标记回读匹配后，只发送一次原标题恢复，随后再次回读确认原值。两次更新分别保存 requestId，商品 ID 和最小恢复基线留在忽略目录，没有重复原写请求、下架或删除测试商品。
- 隔离 Node BFF 通过 JSON 导入、真实商品列表连接测试、显式 IOP 手动配置、重启保留、清除防回退及重新导入。验收使用临时 SQLite，不修改当前工作台 TOP 配置，也不轮换真实 Token。
- 正式 MV3 构建的离线 E2E 通过静态 Pages 回调、加密保存/导出、单次续期、错误 state 拒绝，以及工作台 IOP 持久化、图片分组查询和未适配读写拦截。测试副本预授予主机权限并使用 `mock/data` 响应，不声称该项是插件真实账号验收。
- 全量单测 296 文件 / 2168 项通过；Worker 隔离测试 23 项通过；相关 E2E 21 项通过（静态授权与 IOP 写操作 9、双语 Node 配置 2、旧 TOP 插件及任务中心 10）。正式工作区类型、格式、Lint、i18n、OpenAPI 漂移、离线审计和回放覆盖检查通过；Lint 有既有 warning，无 error。
- 正式扩展 ZIP 1,189,689 字节，解包 4,099,375 字节；继续执行 ZIP 1,500,000 字节、解包 4,100,000 字节及既有门禁，未增加永久 Manifest 权限。代码推送不等于已部署 Worker、Pages 或发布商店。
- 额外根目录 `tsconfig.json` 扫描仍有既有脚本和 Playwright 配置类型欠账，本轮新增/修改的 IOP 验收脚本未新增诊断。工作区的正式 `pnpm typecheck` 与此额外扫描分别记录，不宣称根目录全部脚本已无类型问题。

只读真实回执保存在忽略目录 `artifacts/iop-business-read-validation/`，Node 设置验收记录在 `artifacts/node-credential-management/`；不提交凭据、完整 Schema 或平台业务响应。

受控写回执及最小恢复基线位于 `artifacts/iop-product-write-validation/`。原写请求已发出时不得再次运行对应写入；先用 reconcile 做只读核对，只有最新标题仍等于本次标记、且显式确认后，才允许一次原标题恢复：

```text
pnpm snapshot:iop-docs
pnpm smoke:iop:read --credential=<ignored IOP bundle> --confirm-read-only
pnpm smoke:iop:product-write --credential=<ignored IOP bundle> --mode=draft --confirm-real-write
pnpm reconcile:iop:product-write --credential=<ignored IOP bundle> --receipt=artifacts/iop-product-write-validation/<date>/publish.json
pnpm reconcile:iop:product-write --credential=<ignored IOP bundle> --receipt=artifacts/iop-product-write-validation/<date>/update.json --confirm-restore
```

文档审计快照包含 82 项目录和 32 项商品/交易详情，保存在 `docs/alibaba-iop-api-docs.json`；审计命令仅显式执行，生产构建和 CI 不访问实时文档站。

### 2026-10-13 库存与正式插件只读验收

- 显式映射扩至 16 项只读方法。库存真实回读 8 条 SKU/仓记录通过；暂未适配 SKU 专属查询或库存写入，不借用商品库存方法冒充。
- 商品 ID 加密在两件真实商品上返回平台 `InternalError`，不能归因为权限不足，更不能标为账号验证通过。旧类目映射和层级 Schema 仍只有 IOP 文档验证；本轮不制造前置参数进行试调用。
- 新增 `pnpm smoke:iop:workbench --confirm-readonly --credential=<ignored IOP bundle> [--product-id=<verified product ID>]`。从已有正式 MV3 构建复制隔离 Profile，经设置页导入授权包、加密保存并刷新；成功验证商品列表、20 个商品分组、18 个图片分组、指定分组图片、Schema、8 条库存、订单列表，以及合法无数据的订单物流。
- 真实插件共发送 28 次受限 IOP 只读请求。商品分组的 21 次请求为根节点及 20 个子节点，不是重试；验收工具限量串行并禁止重复读取同一分组。其余操作各一次，相邻出网请求至少 350ms。未访问 TOP、未续期 Token、未执行 mutation，也未替换用户当前 TOP 配置。
- 只修改测试副本 Manifest，预授予精确 IOP 域名；没有替换签名、端点或正式代码，不把原生权限确认弹窗计为通过。未保存完整响应、XML、截图或密钥；Profile 仅含加密保险库，随机口令不导出。
- 单测全量 298 文件 / 2201 项通过，之后新增验收护栏测试 5 项通过；正式 MV3 静态授权及双协议 E2E 9 项通过。Chrome `tabs.create` 可早于 Playwright locale 注入，测试用真实语言按钮显式固定中文，不修改用户语言默认行为。
- 本批正式扩展 ZIP 1,190,035 字节，解包 4,099,851 字节；权限和所有包体门禁保持不变。剩余解包预算很小，后续开发应继续整理重复代码，不直接放宽门槛。
- Web、静态授权 Pages、扩展和 Worker dry-run 构建通过；此处 dry-run 不是线上部署。额外根目录类型扫描仍有旧欠账，本批两个验收脚本及新增测试没有新增诊断。

正式插件脱敏回执在忽略目录 `artifacts/iop-workbench-read-validation/`；API 只读回执仍在 `artifacts/iop-business-read-validation/`。不得把这些目录中的授权包、Profile 或真实业务内容提交到仓库。

## English

TOP remains the backward-compatible default. Unmarked historical bundles/settings remain TOP; an explicit `protocol: "iop"` import is required to select IOP. Do not mix secrets or tokens between protocols. Sixteen reads have explicit paths, including seller orders, logistics and product inventory. Live inventory returned eight SKU/warehouse records. Product ID encryption returned InternalError and remains documented-only; IOP verification never inherits TOP acceptance. Schema draft/formal creation passed live creation and field readback; incremental title update and original-title restoration were each confirmed after platform review. Those three methods now pass the protocol gate, without bypassing administrator checks or environment mutation flags. RFQ has no confirmed public IOP path, and fees cannot substitute for paid amounts. No TOP/Mock fallback or automatic configuration switch occurs. Request-scoped credentials and persisted job contexts prevent readback with a changed account. Renewal uses the matching protocol; an uncertain renewal requires reauthorization rather than resending. An isolated production MV3 copy passed eight live read operations (including a valid empty logistics result), encrypted import and persistence. Native host consent was pregranted in the disposable manifest and was not tested. No active TOP credentials, tokens or products were changed by this read acceptance.
