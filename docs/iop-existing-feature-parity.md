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
- 图片文件上传与分组新增、改名、库存增减已完成 IOP 真实回读；分组删除仍未验收，单独拦截并在双授权时选 TOP。商品分组新增、上下架和视频方法继续按批次适配，未经真实回读不自动开放写入。通用调试器仍为只读，不因协议适配而放开写入。
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

## 上下架协议适配（仍关闭）

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
