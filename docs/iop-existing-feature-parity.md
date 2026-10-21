# IOP 单授权补齐 / IOP-only feature parity

本迭代先覆盖现有功能，再拓展采购、销售和履约。旧 TOP、未标记协议的历史授权包、双授权默认配置保持兼容。按钮尺寸分支独立保留；未合并主线、部署或发布。

## 协议覆盖不等于账号权限

`packages/core/src/alibaba-iop-registry.ts` 是业务路径、读写属性、协议适配和 IOP 账号验收状态的共享来源。BFF 和独立插件的可用性结果保留原 `allowed/reasonCode`，可选增加 `protocolSupport`。管理员、CSRF、业务资格、运行时开关仍独立授权。

| 状态             | 含义                                           |
| ---------------- | ---------------------------------------------- |
| supported        | 已适配；仍需应用权限及运行时授权               |
| partial          | 仅部分子能力可用，其他区块独立展示限制         |
| local            | 不依赖 Alibaba 业务 API，不要求补 TOP          |
| not-adapted      | 公开目录有方法，尚未完成适配                   |
| not-public       | 当前公开目录没有确认的对应方法，不推导私有路径 |
| unverified-write | 已发现公开写方法，未完成 IOP 专属真实验收      |

完整逐操作清单见 `alibaba-iop-feature-coverage.json`。更新命令：`pnpm exec tsx scripts/report-iop-coverage.ts --write`；检查使用 `--check`，不访问 Alibaba。

## 边界与后续小批次

- 当前图片查询必须指定分组；不猜全部/未分组 ID，不扫描整库。图片分组支持通过文档中的 `id` 查询父级及其子分组，不再强制转 TOP。
- 订单聚合保留物流；新版手续费不能冒充已付金额。RFQ、橱窗、排名等缺口可提示补充 TOP，不做失败后的跨协议重试。
- 下载商品素材、本地诊断与目录操作不应被 TOP/IOP 协议闸门误拦截。
- 图片文件上传与分组新增、改名、库存增减及商品上下架已完成 IOP 真实回读；图片分组删除仍未验收，单独拦截并在双授权时选 TOP。商品分组新增和视频方法继续按批次适配，未经真实回读不自动开放写入。通用调试器仍为只读，不因协议适配而放开写入。
- 新版 Product V2 不替换现有 Schema 内容语义。采购和销售订单分开，不把 BuyNow 创建采购订单当作卖家起草订单。
- 第二阶段先补订单详情、物流轨迹、运费、仓库和运费模板，再为采购下单、取消、GGS 物流下单和发货设计独立持久回执；不执行付款。
- ZIP 2,000,000 字节、解包 5,470,000 字节及其他现有门禁不放宽。真实验收回执放忽略目录，不保存明文密钥或完整业务响应。

## English

IOP-only coverage is expanded before new procurement, sales and fulfillment features. TOP, historical unmarked bundles and dual-profile defaults remain compatible. The shared registry describes protocol coverage, not granted application permissions, qualifications or runtime mutation approval. Local functionality does not require TOP. Partial aggregates keep available sections; fees never substitute for paid amounts. Unverified writes stay blocked, and failed calls never switch protocol. Public-API gaps may recommend optional TOP authorization. Live receipt, readback and recovery are separate acceptance results. No deployment, release or payment is performed by this development batch.

## 2026-10-21 真实验收

- 隔离 IOP 只读：11 项通过、1 项合法空数据，商品 ID 加密返回平台 `InternalError`，不标为成功或权限不足。
- 只在新建测试分组操作：根分组新增、改名、子分组新增及按父 ID 回读已确认；新增一张项目图标，fileId 与目标分组回读匹配，CDN 下载 SHA-256 与源文件一致。
- 首轮工具错误地只在根层核对子分组，已安全停止；修复后复用已确认的分组，未重复创建、改名或上传。
- 新建空子分组查询得到意外素材记录，因此没有执行删除。子分组保留，删除仍受 IOP 子操作验证闸门限制；不把上传成功扩大解释为删除通过。
- Node 脱敏回执：`artifacts/iop-feature-parity/2026-10-21-photobank.json`。不修改当前凭据、商品或既有素材。
- 正式 MV3 构建复制到隔离 Profile，仅导入 IOP：商品、分组、图片、Schema、订单查询通过，库存和订单物流为合法空结果。28 次真实只读请求、0 次 TOP 请求、0 次 Token 请求及写入；刷新后协议与加密授权仍保留。原生权限确认未测试，仅隔离副本预授予精确 IOP 域名；不修改日常插件。回执：`artifacts/iop-workbench-read-validation/dcdf1f9d-66be-41d9-a06c-c8bdd16c58ae-Rjb22s/report.json`。
- 图片选择、模板组合/携图、ZIP 传输任务及独立插件本地模板共 7 条 E2E 通过；Worker 24 项隔离测试通过。这些回放回归不等于 IOP 模板携图或 S3 全链路已完成真实写入验收。
- 旧 MV3 验收脚本仍依赖已移除的内联导入表单，首次运行在读取授权文件前超时，未发出平台请求。已改为实际的“连接账号 → 本机保护 → 文件导入并保存”入口，重跑通过，不绕开当前 UI。

## 视频查询批次（尚未真实通过）

- 重新读取新版公开目录，仍为 82 项；补存 Video 分类后文档快照包含 36 份详情。CI 使用离线快照，不访问文档站。
- 新增独立 IOP 视频查询响应适配：`video_id` 是明文数字，不伪造成 TOP 加密关联标识。分别保留审核、质量与原始时长；兼容公开示例的数字字符串，拒绝精度丢失及无法确认的空列表。
- IOP 公共查询没有标题参数。界面明确显示本页筛选并在本页匹配标题；精确 ID 使用文档中的 `video_id`。TOP 标题查询及双授权已有选路不变。
- 真实只读调用得到平台 `10000002 / illegal param error`，并非已确认的权限不足。回执：`artifacts/iop-video-read-validation/5966ecce-ecee-49b6-bf15-beddaa7ed8ee.json`。没有成功记录、播放或关联验收，不提升为 `account-verified`；双授权继续使用已验证的 TOP 视频路径。
- 视频上传的排队结果及主视频关联仍未完成 IOP 适配和受控回读，保持关闭；不以 TOP 的上传成功规则替代。
- 额外按官方示例使用 `page_size=10` 的单次只读探测同样返回 `10000002`，不能简单归因于默认每页 20 条。没有尝试虚构视频 ID；精确 ID 回读及实际播放仍待可用样本。
- 按公开公共参数移除 `simplify` 并重新签名的单次只读探测也返回同一错误，不据此盲目修改已验收方法的全局签名或响应约定。
- 视频搜索、预览释放、关联二次确认和上传暂停/恢复共 10 条 Web E2E 回归通过，均使用隔离样本，不代表上面失败的真实查询已通过。

## 商品分组新增批次（未开放）

- 按公开文档将 TOP `parent_id` 映射到 IOP `parent_group_id`，不传 TOP `extra_context`，响应要求明确的分组 ID、名称和父级；缺失或冲突不算成功。
- 单次受控新增保存发送前回执后执行，平台返回业务错误；没有再次发送，回执保守保留 `unknown`。随后 21 次限速只读请求核对根层分组，未发现本次唯一测试名称，仍不能排除平台延迟或其他差异，不自动重试。
- 回执：`artifacts/iop-feature-parity/2026-10-21-product-group.json`；只读核对：`2026-10-21-product-group-reconciliation.json`。未修改商品，不回退 TOP；该方法继续为 `unverified-write`，未开放生产入口。
- 首次工具漏存平台业务子码，现已补齐后续回执的子码和 traceId 字段；不为补日志重复发送这次结果不明的写入。

## 库存增减批次（远程 Node 真实通过）

- 再次读取新版公开文档，库存更新使用顶层 `product_id` 和 `inventory_list`，不是 TOP 的 `request_param`。只映射明确的增减量、SKU 和仓编码；拒绝零/负数、精度损失、重复 SKU+仓、未知字段及绝对库存操作。
- 成功必须同时具有 `success=true`、`data=true` 且没有业务错误码。原生 `message_info` 映射到共享契约的 `message`，不放宽 TOP validator，也不把 HTTP 成功当成库存已生效。
- 远程 Windows 的隔离 IOP 授权完成两次基线读取、单 SKU 加 1、只读轮询确认、减 1及完整快照恢复。只发送两次写入，不改历史异常 SKU，不覆盖历史未决回执；没有修改工作台授权或其他商品字段。
- 回执：`artifacts/iop-feature-parity/2026-10-21-inventory-cycle.json`，各阶段包含发送前独占、fsync 的意图记录及 requestId；已存在的回执不能再次执行。此处为协议/Node 验收，不冒充正式插件库存写 UI 或 Worker 真实写入验收。
- 仍不新增库存写页面或通用写开关。平台受理后只能读取核对，未知结果不自动重试；任何其他库存变化都会停止后续减量。

The isolated remote Node IOP inventory experiment passed: one plus-one request, readback, one sub-one request and full-baseline restoration. Native parameters and acknowledgements are validated without weakening TOP contracts. Historical unresolved receipts remain unresolved. The generic debugger remains read-only; this is not a claim of MV3/Worker write acceptance or a new inventory-write UI.

## 首轮上下架协议适配（仍关闭）

- 新版公开请求为数字 `product_id_list` 数组，旧 TOP 为加密标识字符串。适配器只使用请求中已配对的明文 ID，不把数字伪造成加密 ID，不调用失败的加密接口猜测转换，也不改变 TOP 传参。
- 原生响应必须有可解释的 `fail_id_map`、错误字段及 trace；非空失败表、缺字段或业务错误不转成成功。任务层仍需回读最终状态，不能把这份受理结果当作完成。
- 远程 IOP 真实列表抽样返回商品及明文 ID，但没有加密 ID；现有上下架任务的目标核对仍依赖该标识。该任务链路尚待补齐，因此本批只交付有测试的协议适配，继续 `unverified-write`，没有发送上下架写入，双授权继续选择 TOP。

IOP display transport now separates numeric IDs from TOP encrypted identifiers. Live IOP listing did not supply the encrypted identity required by the existing task workflow, so runtime display mutation remains gated. No display mutation was sent, and no production acceptance is claimed.

## 本批远程回归与原生订单探测

- Windows 完整 `pnpm check` 通过：336 个测试文件、2,918 项单测、格式、Lint、i18n、契约漂移、类型、三端构建、包体和商店合规。另有 24 项 Worker 隔离测试、26 条授权 E2E、7 条库存及批量维护 Web E2E 通过；不是声称重跑了所有 Web E2E。
- 新构建的正式 MV3 在隔离 Profile 只导入 IOP：28 次真实读取、0 TOP、0 Token 请求、0 写入。商品、分组、图片、Schema、8 条真实库存及订单读取通过；订单物流是合法空结果，不当作完整物流验收。刷新后的协议和保险库状态保留。
- MV3 回执：`artifacts/iop-workbench-read-validation/a800f326-8e7f-4813-a0fc-a006cf25e13a-lGLGNp/report.json`。仅测试副本预授予精确 IOP 域名；未验收原生权限弹窗，不替换日常插件或当前配置。
- ZIP 仅在内存实测为 1,275,860 字节，解包 4,371,171 字节；未覆盖既有发布包。没有增加依赖或扩展权限，版本仍为 2.16.1，不部署、不合并、不发版。
- 额外只读探测：销售、采购列表分别成功，使用销售列表真实标识查询 `/alibaba/order/get` 成功且返回标识一致。只记录字段名称与结果，不保存买家、地址等字段值。该探测尚未接入业务页面或扩展为生产能力。
- 当前返回的订单标识不满足轨迹接口文档中的数值要求，跳过 `/order/logistics/tracking/get`，未强行数值化或猜转换；这不是“没有物流”。回执：`artifacts/iop-order-native-validation/55e25d39-4549-488c-9765-d29de5c9e067.json`；列表的 `observationId` 是本地观察标识，不冒充出网 requestId。

Remote Windows checks passed (2,918 unit tests, 24 isolated Worker tests and 33 related browser E2Es). The isolated production MV3 build made 28 real IOP reads with no TOP, token or mutation requests; inventory contained eight valid records and order logistics was explicitly empty. Native sales/buyer lists and one correlated order-detail read also passed a bounded probe, not a shipped UI integration. Tracking was skipped rather than coercing an incompatible identifier. Existing credentials, release archives, deployment and main branches were not changed.

## IOP 上下架任务兼容与恢复验收（远程双端通过）

- 请求可显式绑定 `top/iop`。IOP 使用明文数字 ID（最多 30 个），无需混淆 ID；旧请求和未标记历史任务继续按 TOP 处理。选定协议不可在失败后切换。
- BFF SQLite/D1 migration 17 保留旧任务和索引，兼容 IOP 空混淆 ID，并保存授权上下文、协议及恢复请求标识。扩展使用相同的任务模型。按单个明文 ID 精确回读，不扫描全店。
- 恢复前先核对当前状态；已是原状态则不发写请求。恢复意图必须先持久化，失败即不出网。一旦已保存 `recoveryRequestId`，重启、超时或再次点击都不能重发恢复，只允许读取核对。
- 真实平台成功回执省略 `result.trace_id`，追踪信息在外层 `_trace_id_/request_id`。现兼容该格式，但仍要求明确的错误字段及失败表，部分失败不能当作整批未执行。
- 远程隔离 Node 样本 `1600495255011` 初始上架。一次下架后已回读为下架；首次回执因上述格式差异保留为结果不明，没有重发。只在确认下架后发送一次恢复上架，平台审核结束后回读为上架，原持久任务刷新为 `recovered`。总计两次写请求，没有修改商品内容或库存。
- 正式 MV3 隔离 Profile 只导入 IOP，对同一商品再次完成下架、回读、恢复及最终上架回读。两次原生写入均取得有效回执；审核期间只读等待，不追加恢复。107 次平台请求中只有 2 次写入，TOP、Token 和越界请求均为 0；恢复任务保留协议、授权上下文和一次性恢复标识。
- MV3 回执：`artifacts/iop-feature-parity/2026-10-21-display-mv3-cycle.json`。被测生产代码复制不变，仅隔离 Manifest 预授予精确 IOP Origin；原生权限弹窗本轮未验收，也未重载或替换日常插件。
- 仅上下架方法提升为 `account-verified`，原有管理员、运行时 feature flag、可信扩展页面、CSRF 和授权上下文限制继续执行；通用调试器仍不能绕过专用任务。没有扩大其他未验收写方法。
- 复核补齐了两个失败前置检查：上下文缺失的旧 TOP 任务不能通过静态 IOP 网关回读；精确 ID 查询必须同时满足匹配记录和 `total=1`，不能接受分页首条加上模糊总数。两项均有零写入/零越界请求回归。
- 最小基线、持久任务和脱敏回执：`artifacts/iop-feature-parity/2026-10-21-display-node-cycle.json` 及同名 `.sqlite`。只读续查命令如下；此模式明确禁止平台写请求：

  ```powershell
  pnpm exec tsx scripts/smoke-iop-display-real.ts --verify-existing --credential=artifacts/local-dual-authorization/iop-credentials.json --product-id=1600495255011 --receipt=artifacts/iop-feature-parity/2026-10-21-display-node-cycle.json
  ```

IOP display receipts now support plain product IDs, pinned authorization contexts and durable, one-shot recovery intent while historical TOP receipts remain compatible. Both isolated remote Node and formal MV3 cycles confirmed offline readback and final online restoration. Each cycle sent exactly two writes; review delays caused read-only polling, never another mutation. Only the display method is promoted, with existing runtime authorization and dedicated-task requirements intact. No content/inventory edit, active credential replacement, deployment or release was performed. Native host-permission consent was not part of this isolated pregrant acceptance.

### 本次最终检查

- 远程 Windows `pnpm check` 完整通过：338 个文件、2,964 项单测，以及格式、Lint、i18n、契约漂移、类型、Web/Worker/扩展构建、包体和商店合规门禁。未提高任何预算。
- 另有 24 项 Worker 隔离测试、12 条商品列表/库存能力/批量维护 Web 与正式 MV3 回放 E2E 通过；回放与上面的真实双端上下架分别计验收。
- 最后重建的正式插件再次只配置 IOP：28 次真实只读请求，商品、分组、图片、Schema 和订单通过，所选商品库存和订单物流为合法空结果，TOP、Token 及写请求均为 0。回执：`artifacts/iop-workbench-read-validation/978200b7-2441-4de1-8564-dd871a556be8-EJQaqp/report.json`。
- ZIP 仅在内存测量为 1,277,228 字节；解包 4,376,238 字节，options eager JS 247,321 字节。既有发布包没有覆盖，未在日常浏览器中执行插件安装、重载或授权替换。

## 图片分组范围交叉核对（最新结论优先）

- 上下架批次的 GitHub CI 已通过，包含完整 Web/BFF/授权 E2E。继续补齐图片分组删除前，发现此前“图片可读取”不能等同“按分组查询正确”：请求已知测试子分组，平台返回的一条素材明确属于其他分组。
- 再次读取公开 IOP 文档，参数仍为 `groupId/currentPage/pageSize`。保留文档映射，不猜特殊分组、父级/子级递归语义，也不使用官网私有接口；额外只读比较同时提供旧式参数没有改善范围错误，不进入生产签名逻辑。
- IOP 图片响应现在与实际签名的分组及分页快照关联。异组、混合组、缺少分组或精度不安全的分组标识一律返回 `ALIBABA_IOP_PHOTO_SCOPE_MISMATCH`；不静默过滤成空列表。数量、已返回分页与 total 明显矛盾时同样拒绝，不把不完整数据用于删除或上传核对。
- 两端显示中英文可操作提示，并保留脱敏 requestId/traceId。不会自动重试、跨协议补请求或扫描全库。
- 覆盖清单将 `listPhotos` 改为部分支持、文档验证，增加分组范围未确认限制。双授权在出网前选 TOP；仅 IOP 仍可调用公开方法，但范围不符会明确停止。这修正此前只核对 fileId、图片哈希后过度泛化的验收结论；上传回执和源文件哈希仍是独立有效证据，不代表整个分组列表正确。
- 删除继续关闭。验收脚本必须同时取得可信的 `total=0`、空第一页和唯一且完整的父子关系；删除后父级本身也必须仍可读，不能仅凭子分组未出现判成功。缺失的 photoCount 默认值绝不作为空分组证据。本批没有删除或新增任何远端资源，没有改商品/库存/当前授权。
- 远程只读诊断：`artifacts/iop-feature-parity/2026-10-21-photo-scope-final.json`。只保存结构、匹配数量及请求标识，不保存其他分组图片内容、分组名称、凭据或完整响应。平台 trace 若包含凭据也不保留。
- 正式 MV3 指定同一真实测试子分组完成复核：28 次 IOP 请求，0 TOP、Token、写入及越界请求；商品、商品分组、图片分组、Schema 和订单通过，所选样本库存和物流为合法空结果。图片查询返回 `ALIBABA_IOP_PHOTO_SCOPE_MISMATCH`，所以完整只读验收报告仍为 `failed`，不是宣称整个图库通过；安全拦截已生效。回执：`artifacts/iop-workbench-read-validation/a1e0f263-2900-4f43-9d65-b6cc5303d0cd-lZJ7qz/report.json`。生产代码副本未改，仅隔离 Manifest 预授予 IOP Origin，不替代原生权限弹窗验收。
- 最终 Windows `pnpm check` 通过：339 个测试文件、2,990 项单测，以及格式、Lint、i18n、契约、类型、三端构建、包体和商店合规。补跑 24 项 Worker 隔离测试及 4 条图片选择/模板携图/传输任务 Web E2E；新增验收脚本独立类型检查通过，诊断收集器收窄后的格式和 Lint 另行通过。
- ZIP 在内存测量为 1,277,646 字节、解包 4,377,202 字节；options eager JS 248,225 字节，双语 i18n 309,955 字节。没有提高门槛、写出或覆盖正式发布 ZIP，也没有增加权限、合并主线或部署。

The latest scope check supersedes earlier broad photo-list acceptance: transport, upload identifiers and file hashes do not prove group-scoped listing. A live IOP request for the known test child returned a foreign-group row. The shared client now rejects uncorrelated group/pagination data without filtering, retrying, scanning or falling back. Dual profiles choose TOP before dispatch; IOP-only keeps an explicit, localized limitation. Photo-group deletion remains unverified and disabled. This batch performs read-only checks, not remote deletion, product changes, credential replacement or deployment.

### 传输格式有限对照与 CI 回归

- 对已知父/子分组分别比较表单 POST、JSON POST、GET，共 9 次只读请求。三种方式在子分组均返回异组图片；第二页返回不同图片，但仍不属于目标分组。另从真实分组树选择一个不同根分组，只读查询仍返回原测试父分组的图片。
- 结果不能支持“换成 JSON 或 GET 即可修复”的判断，不修改生产签名、不过滤伪造空结果，也不扩大可删除范围。脱敏报告：`artifacts/iop-feature-parity/2026-10-21-photo-transport-comparison.json` 和 `2026-10-21-photo-other-root.json`；总计 11 次请求、0 次写入。
- 上批 CI 的 118 条 Web/插件 E2E 中，117 条通过，双授权图片选路的旧断言失败。断言现与共享安全策略一致：无论全部图片或指定分组，双授权均在请求前选择 TOP；不在 IOP 失败后重试 TOP，不修改或虚构商家绑定信息。

Eleven bounded, read-only probes show the same incorrect photo-group scope across form POST, JSON POST, GET and a different real root group. No transport change, filtering, mutation or credential replacement is justified. The MV3 dual-profile regression now expects the intentional pre-dispatch TOP choice rather than obsolete IOP scope acceptance.

## IOP 公开订单详情（Node 与正式 MV3 只读通过）

- 使用公开原生路径 `/alibaba/order/get`，不将其冒充旧版 `alibaba.seller.order.get` 或聚石塔受限详情。`TradeOrderAggregate` 兼容增加独立 `publicDetail/publicDetailError`，现有路由和写白名单不变；原 TOP 聚合和双授权请求前选路保持原样。
- IOP 订单抽屉现可展示平台真实返回的状态、买家名称、订单总金额及商品行。买家名称不当作登录名，总金额、预付款和手续费均不当作已付金额；IOP 资金仍明确不可用，物流与公开详情各自成功或失败，不互相隐藏。
- 只保留必要字段，不输出地址、邮箱、联系方式、附件或完整原始响应。订单 ID 保持不透明字符串并与签名请求严格关联；不安全的数字商品 ID、错误金额类型和畸形商品数组不静默修正。字段未返回显示未知，未返回商品行与明确空数组分别处理。
- 请求使用独立的 Alibaba 接口语言，不使用界面语言。缓存按账号、凭据上下文和接口语言隔离 5 分钟；完整公开详情与物流可共用缓存，不要求伪造资金数据。部分失败不缓存为成功，回写前核对账号，拒绝迟到的异账号结果。
- 远程 Node 网关使用隔离 IOP 授权完成一次列表及同一订单详情、物流查询：3 次只读请求，详情、金额、商品行与物流返回有效；0 TOP、Token 和写请求。回执：`artifacts/iop-feature-parity/2026-10-21-order-aggregate-node.json`，只保存字段存在性、数量、指纹和请求标识。
- 最终正式 MV3 构建复制到隔离 Profile，导入后刷新，再执行订单列表和聚合：3 次 IOP 请求通过，0 TOP、Token、写入及越界请求，未替换当前配置。回执：`artifacts/iop-workbench-read-validation/22d2463d-3a4a-463d-aa23-656d346a56d0-aPGyqn/report.json`。仅隔离 Manifest 预授予 IOP Origin，不代表原生权限弹窗验收；生产代码副本未改。
- 仅提升原生订单详情的 IOP 只读验收标记，不声称所有账号有权限，也不开放受限资金或交易写入。独立复查命令：

  ```powershell
  pnpm exec tsx scripts/smoke-iop-workbench-real.ts --confirm-readonly --credential=artifacts/local-dual-authorization/iop-credentials.json --orders-only
  ```

- Windows `pnpm check` 通过 341 个测试文件、3,016 项单测、格式、Lint、i18n、契约漂移、类型、三端构建及商店检查。最终只读验收标记更新后再次构建并复核覆盖注册表及正式 MV3。脚本独立类型检查通过。
- 最终 ZIP 仅在内存测量：1,279,396 字节；解包 4,384,176 字节，options eager JS 248,854 字节，i18n 309,955 字节。预算未提高，既有发布包未覆盖；未合并、部署或上架。
- 原上下架样本另作一次精确 ID 的 IOP 只读复查，`total=1` 且唯一记录仍为上架，与原基线一致；未重复上下架、改写恢复回执或当前配置。回执：`artifacts/iop-feature-parity/2026-10-21-display-readback-recheck.json`。
- 另外通过 24 项 Worker 隔离测试、2 条 Worker/D1/BFF 回放 E2E，以及完整 118 条 Web/正式 MV3 E2E；回放回归与上述真实 IOP 查询分别计验收。首次并行运行两套 Playwright 共用默认输出目录，BFF 启动清理了插件测试的下载临时文件；改用独立 `--output=artifacts/iop-order-web-e2e` 后全量重跑通过，未因此修改产品下载逻辑。

The public native IOP order detail is now independent of restricted TOP/Jushita detail. It supplies real order totals and line items without fabricating paid amounts, timestamps or missing data. Detail and logistics degrade independently; account/language-scoped caching rejects late results after credential changes. Isolated remote Node and formal MV3 each passed three correlated, read-only IOP requests with no TOP fallback, token refresh or mutation. Only the native read is promoted; permission grants and transaction writes are not implied. Photo-group scope remains a separate unresolved platform limitation.

## IOP 素材分组筛选复查与核对流程修正

- 重新读取新版公开目录及 `/icbu/product/photobank/list` 的 SDK 示例，仍只有 `groupId/currentPage/pageSize` 三个业务参数，与生产适配一致。没有发现可替代的公开图片列表路径，不调用官网私有接口。
- 远程再做 4 次有限只读对照：省略 `simplify`、设置为 `false`，分别使用表单与 JSON。已知父分组的单条图片可匹配，但子分组仍返回父分组图片；不能据此放开分组校验、认定子分组为空或宣称列表已修复。脱敏回执：`artifacts/iop-feature-parity/2026-10-21-photo-simplify-comparison.json`。本组没有上传、删除、Token 刷新或配置替换。
- 图片分组导航的缓存、展开状态和迟到响应按工作台身份隔离，目录按真实父子关系排列，不把其他根目录混到当前目录下。
- 仅 IOP 的模板携图导入不再提供依赖全库查询的跨组素材复用。旧任务即使带有复用同意，也不会发起无分组查询或遍历其他目录。已在目标目录确认的精确 fileId 仍直接使用；TOP 的有界、精确 ID 加哈希复用流程保持兼容。
- 权限预检兼容接收可选 `galleryContext`，按任务绑定的身份和凭据查询协议能力，不能使用当前默认选路代替；BFF 和插件均验证上下文，不触发平台请求或 Token 刷新。旧的无上下文查询行为保持不变。模板的素材域名权限预取也携带同一上下文。
- 传输核对保留分组、契约及分页错误码，任务中心显示本地化原因。模板创建在素材未确认时停止，不再吞成笼统的未确认；原上传回执、状态和 requestId 保留，只允许后续只读核对，不重复上传。
- 正式 MV3 可只复查指定的真实分组，避免无关读请求：

  ```powershell
  pnpm exec tsx scripts/smoke-iop-workbench-real.ts --confirm-readonly --credential=artifacts/local-dual-authorization/iop-credentials.json --photos-only --photo-group-id=<实际分组ID>
  ```

The public SDK parameters match the implementation. Four additional read-only comparisons reproduce the same foreign-group result without `simplify` or with `simplify=false`; no transport workaround is justified. Group navigation now isolates local state by identity. IOP-only material reconciliation cannot scan all groups or silently adopt a different directory, and persistent uncertain receipts retain actionable errors without any resend. A matching single-row sample is not full photo-library acceptance; the provider scope limitation remains open.

### 正式 MV3 实际分页复查

- 使用最终正式构建的未改动代码副本，隔离配置仅 IOP，分别查询已知父、子分组，图片分页大小为页面默认的 24。两次分组树读取通过，但两次图片列表均触发 `ALIBABA_IOP_PHOTO_SCOPE_MISMATCH`；这两份业务验收均保留为 `failed`，不能按前面单条匹配样本推断整个目录可用。
- 两份回执的加密存储、刷新后 IOP 配置保留、绑定凭据状态查询、失效上下文拒绝均确认通过。总计 4 次 IOP 只读平台请求、0 TOP、0 Token、0 写入、0 越界请求；没有覆盖现有配置。仅隔离 Manifest 预授予 IOP Origin，不替代原生权限弹窗验收。
- 回执：`artifacts/iop-workbench-read-validation/ff15ce42-890f-44f4-9b81-dae4d03d67bf-hFVIiK/report.json`、`artifacts/iop-workbench-read-validation/6b544bc4-4c08-419f-8ff0-57638a6d043d-cl9w2p/report.json`。不保存完整响应、图片或凭据。
- 远程 Windows `pnpm check` 通过 3,055 项单测、格式、Lint、文案、契约漂移、类型、三端构建和商店检查；另外 24 项 Worker 隔离测试通过。验收工具增加的绑定上下文复查另行通过格式、Lint、独立类型检查及 9 项脚本测试。
- ZIP 仅在内存测量为 1,281,715 字节，未写出或覆盖既有发布包；解包 4,389,574 字节，options eager JS 249,129 字节，i18n 309,948 字节。所有既有预算保持不变。
- 完整 118 条 Web/正式 MV3 E2E 通过，包含图片目录管理、模板携图与传输任务回归；使用独立输出目录，与真实 IOP 失败回执分开计验收。
- 另外 2 条 Worker/D1/BFF 集成回放通过，仅重建专用测试数据库；真实业务数据和线上环境未修改。

At the actual 24-row page size, both isolated formal-MV3 photo-list runs still fail scope validation, although group reads, encrypted storage, persisted IOP configuration and context pinning pass. Four platform reads perform no TOP fallback, refresh, mutation or configuration replacement. These are failed photo-list acceptance receipts, not a claim that IOP-only assets are fully usable. Existing TOP compatibility and the safety stop remain in place.

## 官网目录与官方 SDK 分组范围复查

- 公开定义仍只有 `groupId/currentPage/pageSize`；分组查询将 `groups[].id` 描述为唯一标识，将 `level1/2/3` 描述为层级顺序，不支持用层级坐标替换真实 ID。请求与响应中的分组字段都映射到服务字段 `groupId`，但没有发现另一套 ID 转换的公开依据。
- 在远程 Windows 复用已登录的 Alibaba 页面，进入 **Products → Tools → Image bank**：已有测试父分组显示 **1 张**，其子分组明确显示 **No photos**。测试名称、父子关系与之前创建的资源一致；没有改名、移动、删除或上传。这是官网人工页面核对，不调用其私有接口代替 OpenAPI。
- 另外检查公开文档链接的 Java SDK 字节码：它将公共签名参数放在 URL 查询串，将业务参数放在 POST 表单。按此方式对同一父、子分组各做一次第一页、24 条的只读查询，签名参数值保持不变。两次仍返回 24 条：父查询为 1 条目标组、23 条未返回分组标识；子查询为 1 条父组、23 条未返回分组标识。两次均被现有范围校验拒绝。
- 此结果排除了“仅需模仿 SDK 拆分 Query/Form 就能修复”的假设。当前证据更支持公开服务的筛选/映射异常，但根因仍需 Alibaba 确认；不能把推断写成平台已确认故障，也不把未注明分组的 23 条都称为已证实的异组素材。
- 脱敏回执：`artifacts/iop-feature-parity/2026-10-21-photo-sdk-split-comparison.json`。仅记录数量、分组匹配分类和 requestId/traceId，不记录带 Token 的 URL、凭据、图片地址或完整业务响应。官网核对截图单独保存在忽略目录，不提交测试账号内容。
- `reconcile-iop-photobank-real.ts` 增加显式 `--sdk-query-form` 和 `--photo-page-size=24`，用于平台排障，不改变生产网关。传输助手只接受公开图片列表路径；结果摘要区分匹配、异组、缺失和非法分组，不保存返回内容。文档参数别名比较与 SDK 比较互斥，所有请求禁止自动重试。

  ```powershell
  pnpm exec tsx scripts/reconcile-iop-photobank-real.ts --confirm-read-only --credential=artifacts/local-dual-authorization/iop-credentials.json --receipt=artifacts/iop-feature-parity/2026-10-21-photobank.json --sdk-query-form --photo-page-size=24 --output=artifacts/iop-feature-parity/photo-sdk-recheck.json
  ```

  这是两次只读诊断（分组、图片各一次），不是素材功能成功验收；请使用不存在的新输出文件，避免覆盖历史回执。响应校验不通过时保存 `needs-attention` 并以退出码 `2` 结束，不能把“诊断执行完”当成“图片列表通过”。SDK 模式将临时 Token 放入官方 HTTPS 请求查询串，只存于请求内存，不打印 URL，不新增生产传输方式。

- 继续保留安全边界：双授权在出网前使用 TOP 查询图片；仅 IOP 不过滤伪造空组、不扫描全库、不借用官网私有接口、不重复上传待核对素材。分组列表及已验收的新增/改名保持可用，删除和依赖可信分组列表的最终核对仍不能宣称已通过。
- 文档依据：[IOP 图片列表](https://openapi.alibaba.com/doc/api.htm#/api?cid=1&path=/icbu/product/photobank/list&methodType=GET/POST)、[IOP 分组列表](https://openapi.alibaba.com/doc/api.htm#/api?cid=1&path=/icbu/product/photobank/group/list&methodType=GET/POST)、[文档提供的 Java SDK](https://icbu-open-platform-public.oss-us-east-1.aliyuncs.com/sdk/1.0.4-1690374097817bk5i.jar)。SDK 下载名与内嵌版本不一致，仅作静态检查及有限传输对照，不运行其默认日志实现。

The official Image bank shows one image in the known test parent and no images in its child. Two bounded public-IOP probes matching the official Java SDK's common-query/business-form separation still return 24 rows, including the parent's image for the child and 23 rows without group IDs. This is evidence of an unresolved public-service filtering/mapping problem, not a confirmed provider root cause or a successful IOP-only photo-list acceptance. The operator-only comparison is reproducible and redacted; production scope guards, TOP compatibility and no-resend rules remain unchanged.
