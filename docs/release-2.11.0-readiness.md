# 2.11.0 发布交接

检查日期：2026-09-22。版本范围：免费 API 能力补齐与平台同步延迟提示。

## 发布边界

- 新增 35 项类型化能力，包含请求/响应校验、示例、权限及业务前置条件；其中六项普通只读能力可经现有网关策略调用，27 项条件能力保留限制，新库存/视频写操作不默认开放。
- 当前测试账号的最新方法结果为 2 项通过、7 项无权限、26 项缺少前置条件；不是 35 项真实业务全部通过。新库存验收已按新记录的基线完成增加、回读、恢复；更早缺失基线的历史事件仍单独保留，不推断恢复。
- 新增中英文平台同步提醒，区分已受理、待核对与结果不明；不承诺固定生效时间、不自动重发 mutation、不把失败当作成功。
- 无新增 Manifest 权限，无相对 2.10.0 的 D1 migration，不扩大默认真实写白名单。正式 ZIP 上限仍为 1,500,000 字节，解包及各分块预算不变。
- 详细真实验收边界见 [免费 API 迭代记录](free-api-catalog-completion.md)。真实账号数据、凭据和完整响应不进入商店包、文案或截图。

## 发布前检查

本节在本轮检查完成后填入实际结果，不能把历史通过记录当成本版验收。

- [ ] Windows 全量 `pnpm check`、Worker 测试。
- [ ] Web/正式 MV3、BFF replay、Node 凭据 E2E。
- [ ] 正式 ZIP、SHA-256、包体及商店合规。
- [ ] `staging`、`master`、annotated Tag 和 GitHub Release；远端产物与本地校验一致。
- [ ] 现有 Cloudflare 站点部署和只读验收；保留资源绑定、密钥及回退版本。
- [ ] Chrome Web Store 上传、审核提交、上架分别确认，不由 GitHub/Worker 状态推断。

## 商店资料

- 完整中英文说明：`store-listing/zh_CN.md`、`store-listing/en.md`。
- 权限与数据用途：`store-listing/listing.json`；隐私政策和非官方关联声明沿用。
- 图标、Small promo tile 和已有中英文截图可以沿用，截图不是新增能力已获授权的证据。
- 审核人员按 [提交清单](store-submission.md) 查看首次引导、受限能力、双语提示和本地数据控制。账号真实调用需要合法的平台应用权限；不提供开发者的生产凭据。
- 使用正式 `chrome-mv3` 包，不上传 `chrome-mv3-dev` 或工作区打包文件。商店新包版本须高于此前已上传版本，后台如已有相同/更高版本须停止并重新定版。

更新摘要（中文）：

> 2.11.0 新增 35 项类型化开放平台能力，补充请求示例、权限与业务前置条件说明。库存、商品、图库及视频核对增加平台同步延迟提示，区分已受理与结果不明，避免重复操作。加强实际方法授权、签名参数保护和敏感响应脱敏；未新增扩展权限或默认开放的写操作，接口可用性仍取决于平台应用和账号权限。

Update summary (English):

> Version 2.11.0 adds 35 typed Open Platform capabilities with request examples, permission details and prerequisites. Inventory, product, gallery and video checks explain delayed updates and distinguish acknowledged requests from uncertain results to discourage duplicate writes. Method-specific authorization, signing protection and sensitive-result redaction are improved. No new extension permissions or additional default-enabled writes; availability still depends on platform app and account permissions.
