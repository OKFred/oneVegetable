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
- 图片文件上传与分组新增、改名已完成 IOP 真实回读；分组删除仍未验收，单独拦截并在双授权时选 TOP。商品分组新增、上下架、库存写入和视频方法继续按批次适配，未经真实回读不自动开放写入。
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
- 视频搜索、预览释放、关联二次确认和上传暂停/恢复共 10 条 Web E2E 回归通过，均使用隔离样本，不代表上面失败的真实查询已通过。

## 商品分组新增批次（未开放）

- 按公开文档将 TOP `parent_id` 映射到 IOP `parent_group_id`，不传 TOP `extra_context`，响应要求明确的分组 ID、名称和父级；缺失或冲突不算成功。
- 单次受控新增保存发送前回执后执行，平台返回业务错误；没有再次发送，回执保守保留 `unknown`。随后 21 次限速只读请求核对根层分组，未发现本次唯一测试名称，仍不能排除平台延迟或其他差异，不自动重试。
- 回执：`artifacts/iop-feature-parity/2026-10-21-product-group.json`；只读核对：`2026-10-21-product-group-reconciliation.json`。未修改商品，不回退 TOP；该方法继续为 `unverified-write`，未开放生产入口。
