# 2.11.0 发布交接

检查日期：2026-09-22。版本范围：免费 API 能力补齐与平台同步延迟提示。

## 发布边界

- 新增 35 项类型化能力，包含请求/响应校验、示例、权限及业务前置条件；其中六项普通只读能力可经现有网关策略调用，27 项条件能力保留限制，新库存/视频写操作不默认开放。
- 当前测试账号的最新方法结果为 2 项通过、7 项无权限、26 项缺少前置条件；不是 35 项真实业务全部通过。新库存验收已按新记录的基线完成增加、回读、恢复；更早缺失基线的历史事件仍单独保留，不推断恢复。
- 新增中英文平台同步提醒，区分已受理、待核对与结果不明；不承诺固定生效时间、不自动重发 mutation、不把失败当作成功。
- 无新增 Manifest 权限，无相对 2.10.0 的 D1 migration，不扩大默认真实写白名单。正式 ZIP 上限仍为 1,500,000 字节，解包及各分块预算不变。
- 详细真实验收边界见 [免费 API 迭代记录](free-api-catalog-completion.md)。真实账号数据、凭据和完整响应不进入商店包、文案或截图。

## 发布前检查

以下为本轮 Windows 实际检查结果；远端发布和部署单独记账。

- [x] Windows 全量 `pnpm check`：格式、Lint（0 error / 23 warning）、i18n、134 项离线审计、50/50 replay、OpenAPI 漂移、类型、237 文件 / 1,291 项单测、三端构建及合规。Worker/D1 4 文件 / 6 项测试通过。
- [x] Web/正式 MV3 51 项、BFF replay 2 项、Node 凭据中英文 2 项 E2E；2.10.0 → 2.11.0 升级 15 项检查通过。首次并行生成文件触发 HMR，导致一项浏览器测试中断；构建结束后完整串行复验 51/51 通过，没有跳过或放宽断言。
- [x] 正式 ZIP 1,069,846 字节 / 152 文件；SHA-256 `83d8edafbcd01c9d00ebaf54360b1b26c0a2fc108bb766af68a11290a25f0c96`。解包 4,097,218 字节，后台 95,074 字节，入口 eager JS 128,128 字节，i18n 308,214 字节，全部在原预算内。包内没有环境文件、授权包、Mock 文件、source map 或扫描到的本机凭据值。
- [ ] `staging`、`master`、annotated Tag 和 GitHub Release；远端产物与本地校验一致。
- [ ] 现有 Cloudflare 站点部署和只读验收；保留资源绑定、密钥及回退版本。
- [ ] Chrome Web Store 上传、审核提交、上架分别确认，不由 GitHub/Worker 状态推断。

本机日志在忽略目录 `artifacts/release-2.11.0-*.log`，正式安装包为
`artifacts/one-vegetable-v2.11.0-chrome-mv3.zip`，校验文件在同路径追加 `.sha256`。

部署前已核对现有网站为 2.6.0，Worker version `c1c4ff32-1985-4199-a35a-5beee6ebf43f`；6 项运行变量与配置一致，沿用 D1、R2、Browser 和两个 Secret。远端 schema v13，无待执行 migration；只读统计为用户 1、凭据 1、凭据 revision 1。D1 备份留在忽略目录，333,468 字节，SHA-256 `88e9192760823589b1edd26e8fd73588de495e12832abfa737711d1ed7877374`；已在临时内存 SQLite 恢复并通过 `integrity_check`，不上传数据库备份到 GitHub。Cloudflare 同源 BFF 构建和 Worker dry-run 已通过。

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
