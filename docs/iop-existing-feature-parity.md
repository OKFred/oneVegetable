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
