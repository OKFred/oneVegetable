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

- 当前图片查询必须指定分组；不猜全部/未分组 ID，不扫描整库。图片分组子级参数仍需专门适配。
- 订单聚合保留物流；新版手续费不能冒充已付金额。RFQ、橱窗、排名等缺口可提示补充 TOP，不做失败后的跨协议重试。
- 下载商品素材、本地诊断与目录操作不应被 TOP/IOP 协议闸门误拦截。
- 图片文件上传、分组操作、商品分组新增、上下架、库存写入和视频方法按批次适配，未经真实回读不自动开放写入。
- 新版 Product V2 不替换现有 Schema 内容语义。采购和销售订单分开，不把 BuyNow 创建采购订单当作卖家起草订单。
- 第二阶段先补订单详情、物流轨迹、运费、仓库和运费模板，再为采购下单、取消、GGS 物流下单和发货设计独立持久回执；不执行付款。
- ZIP 2,000,000 字节、解包 5,470,000 字节及其他现有门禁不放宽。真实验收回执放忽略目录，不保存明文密钥或完整业务响应。

## English

IOP-only coverage is expanded before new procurement, sales and fulfillment features. TOP, historical unmarked bundles and dual-profile defaults remain compatible. The shared registry describes protocol coverage, not granted application permissions, qualifications or runtime mutation approval. Local functionality does not require TOP. Partial aggregates keep available sections; fees never substitute for paid amounts. Unverified writes stay blocked, and failed calls never switch protocol. Public-API gaps may recommend optional TOP authorization. Live receipt, readback and recovery are separate acceptance results. No deployment, release or payment is performed by this development batch.
