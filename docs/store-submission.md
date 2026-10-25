# Chrome Web Store 提交清单

检查日期：2026-10-25。当前准备 **2.18.0 发布候选**；上一正式版本为 [v2.17.2](https://github.com/OKFred/oneVegetable/releases/tag/v2.17.2)。候选已构建、打包并冻结文件指纹，尚未创建 Tag / GitHub Release、合并主线或部署，也不查询或改变商店状态。商店上传、提交审核和实际上架仍是三个独立状态；不能根据版本号或候选说明推断已发布，不覆盖或复用旧版本包。

## 2.18.0 候选提交要点

- 中文摘要：选中图库图片后进入新增商品，加载全新类目 Schema，无损带入图片并保留模式切换和身份栅栏；精确商品 ID 回读、IOP auditing 状态与 S3 根前缀目录边界同步修复。
- English summary: Start a new product from selected gallery images with a fresh category Schema, lossless image seeding, editor-mode switching and identity fences. Fix exact product-ID readback, IOP auditing state and S3 root-directory prefix boundaries.
- 未新增依赖或 Manifest 权限，不扩大写入门禁或自动重试。IOP 图片分组范围异常继续严格拦截，不扫描全库、不伪造空分组，也不宣称与 TOP 完全等价。
- 版本说明中的日期、来源及未来 Release / compare 链接是候选元数据，不表示对应 Tag、Release、ZIP 或商店条目已经创建。

### 候选验收与证据

- Node BFF：新建一条 TOP 平台草稿并回读；新建一条 IOP 正式商品，标题修改与恢复、上下架均已回读，最终在线。该证据不等于独立 MV3 写入验收。
- 正式 MV3：冻结的 2.18.0 候选已完成真实图库到新编辑器交接，以及仅标题修改、回读、恢复、再次回读。最终在线、原标题及图片字段指纹不变；两次确认都仅包含标题字段，没有重发。插件独立发品和上下架不冒用 Node BFF 的验收结果。
- S3：受限密钥的范围内列表、PUT、GET / SHA-256 和越界列表 HTTP 403 已有记录；不扩大 IAM、凭据默认值或应用重试范围。宿主存储升级不作为扩展已发布的证据。
- 脱敏功能记录见 [素材带入新增商品](assets-to-product-workflow.md)。真实商品 ID、私人地址、凭据及原始响应只留在既有忽略证据目录，不进入商店文案或公开仓库。

### 质量门禁与后续发布边界

- Windows 格式、Lint、i18n、契约、类型、3,554 条单测和 24 条 Worker 用例通过。E2E：Web/MV3 130 条、授权 47 条、Node 凭据 17 条、Worker/BFF 回放 2 条通过；2.17.2 升级检查 24 项通过。
- Web/API/MV3 构建、包体和商店合规检查通过；实际验收、冻结构建与 ZIP 逐文件匹配。10 条非空本地敏感值规则扫描未发现匹配；不将真实验收记录、密钥或原始响应打包。现有双语引导、配置和能力截图继续适用，未据此宣称新增功能已有商店截图。
- 包体预算保持 ZIP 不超过 **2,000,000 字节**、解包不超过 **5,470,000 字节**。本次候选 ZIP 为 **1,317,306 字节**、解包 **4,492,622 字节**，包含 225 个文件；逐文件 SHA-256 与冻结的实际验收构建一致。Manifest 权限与 2.17.2 一致。
- ZIP SHA-256：d60b5377648779de1ebe0caa3c8ac0623f9f677a4ca296689816e567ba1a7f71。
- 当前提交的 CI 是独立门禁，不根据本地通过推断 CI 通过。后续合并、Tag / Release、商店上传与审核提交、部署分别取得明确授权，本轮未执行这些动作。

## 2.17.2 提交要点（历史记录）

- 更新摘要：修复双授权选路及启动初始化中断橱窗确认，统一 Web 与插件配置入口，增加加载反馈并保留已有内容。
- 英文摘要：Fix dual-authorization routing and startup context interrupting showcase confirmations, align Web and extension setup, and preserve existing content with loading feedback.
- 未新增依赖、Manifest 权限或真实写能力；既有权限理由、数据用途及隐私政策继续适用。IOP 图片分组范围异常仍严格拦截，不宣称 IOP 已覆盖全部 TOP 功能。
- 用新 ZIP 上传已有商店条目，校验 manifest 为 2.17.2，并使用同包附带的 SHA-256。商店截图仍可沿用未变化的功能页；不得用含真实账号或密钥的验收画面。
- v2.17.1 在发布门禁中发现启动竞态，未创建 GitHub Release；保留原 Tag，不移动或复用，也不要上传其候选 ZIP。2.17.2 包含该功能集及确定性回归修复。
- 商店由用户手工上传并确认提交；GitHub Release 不代表商店已发布。以下旧版本记录保留为历史材料，不用作本版本验收结果。

2.13.0 新增统一任务中心和独立日志页，集中查看回执及安全后续入口，将请求诊断、操作审计和本地数据管理从管理/设置页迁入日志。**真实商品视频关联写入继续关闭**，不可宣传为已能关联或取消关联；查看记录、选择商品和只读核对不修改商品。2.13.0 内容保留为历史说明；当前发布检查见 [2.16.1 发布准备](release-2.16.1-readiness.md)。

本版统一列表工具栏、筛选和列设置，新增独立只读库存页，整合图片/视频素材预览，并调整未保存编辑与启动解锁体验。受控视频上传已在 Node `local-node` 和正式 MV3 完成真实上传及回读；Worker 真实上传仍关闭，`staging` / `production` 也不开放。没有新增 Manifest 权限；视频任务数据库新增 `0014_video_upload_tasks.sql`，存在 migration 不代表已部署或验收 Worker。准确功能和验收边界见 [列表、素材与库存体验](list-materials-inventory-ux.md) 与 [视频上传后端](video-upload-backend.md)；下方旧版交接仅为历史记录。

## 自动化检查覆盖与发布前复核

两份隐私政策及对应静态 HTML 同步至 2026-10-20 / 2.16.1，更新日志页的清理和撤权入口，数据处理范围不变。中英文截图、版本、包体、合规及升级检查以 [2.16.1 发布准备](release-2.16.1-readiness.md) 的最终记录为准；[2.12.1 发布准备](release-2.12.1-readiness.md) 保留历史记录。当前上限为解包 5,470,000 字节、ZIP 2,000,000 字节；本次不调整门槛。

- MV3 manifest 的版本、名称和描述本地化、主页地址、权限最小集；
- 必选扩展权限仅为 `storage`、用户主动凭证向导所需的 `scripting`，必选主机仅为正式 HTTPS 网关；`scripting` 只在用户主动启动后向 Alibaba 开发者注册、应用中心及 OAuth 页面注入包内固定检测/引导代码，不读取注册资料值或代替提交；未出现 cookies、`tabs`、`webNavigation` 或必选 `<all_urls>`；
- 最低 Chrome 102，local/session 存储限制为可信扩展上下文，内容脚本不可读取；
- 应用中心、OAuth Callback、自定义网关、用户自托管社交发布 BFF、外部图片来源与用户配置的 S3 Endpoint 保持可选主机权限，并在用户启动对应功能时按具体站点申请；视频分片暂存复用既有 S3 授权，不增加永久主机权限；
- 中英文商店文案、权限理由、本地隐私页和仓库隐私政策存在，发布前须核对生成页与源文档版本一致；
- 128 × 128 商店图标、440 × 280 Small promo tile、3 张商店主截图，以及中英文各 4 张真实扩展页面的 1280 × 800 备选截图；
- 平台草稿、正式发品、商品更新/上下架、商品分组创建、橱窗加入/移出/排序/替换、图库分组管理、图片上传和外部图片转存只在用户主动操作后开放；视频上传通过独立受控任务入口开放，不开放通用调试器写入或商品视频关联。真实验收记录见对应报告，其他未经验证的 mutation 在出网前关闭；
- 插件社交发布必须先与用户自己的 BFF 一次性配对；设备令牌只允许读取发布目标和社交发布，不包含 Meta 密钥，单图发布仍需二次确认；
- 发布 ZIP 可复现，manifest 位于根目录，CI 产物同时包含 SHA-256 和 `store-listing/` 提交资料。

执行：

```bash
pnpm capture:store-assets # UI 发生可见变化后手工刷新截图
pnpm release:extension
```

截图必须来自构建后的扩展，不使用 Web 演示冒充。`pnpm check:store-compliance` 会检查数量、尺寸及页面中的内部测试表述，但无法判断文案的法律充分性或截图是否适合营销。

## 商店后台填写建议

- 单一用途：由用户主动操作的 Alibaba.com 国际站本地运营工作台；
- 类别：Productivity；
- 默认语言：简体中文，同时提交英文文案；
- 权限理由和数据用途声明以 `store-listing/listing.json` 为准；
- 隐私政策 URL：合并到 `master` 后使用 `https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.md`，提交前用未登录窗口确认公开可访问；
- 支持 URL：`https://github.com/OKFred/oneVegetable/issues`；
- 初次建议使用 Private trusted testers。Private、Unlisted 和 Public 同样需要经过政策审核，不能把 Private 当作免审通道。

## 审核人员测试说明

无需账号可以验证：

1. 首次打开时查看图文四步授权引导与数据、权限显著披露，并主动勾选确认；
2. 点击获取凭据，先选择可选本机保护、离线导入或在线连接，再选择 TOP/IOP；可在未配置真实凭据时关闭，不需接受 Alibaba 协议。新版优先 IOP；旧 TOP 需要既有旧应用资料，不能用新版密钥替代；
3. 打开 API 能力目录，检索已类型化的能力及其限制原因；检查 `alibaba.icbu.product.inventory.update` 的同步延迟及禁止重复提交提示，确认受限方法不能调用；不要把契约示例当作真实结果；
4. 打开日志 → 诊断与数据，查看本地数据清单、脱敏诊断和额外主机权限；
5. 本机口令可留空使用设备密钥，或自行设置至少 6 位口令；授权页与设置共用，无需重复设置。重启、更新不自动锁定，无空闲锁定选项。手动锁定后须显式解锁；口令保护模式需要原口令，未配置账号仍可查看帮助及日志；
6. 导出不包含具体值的数据清单，使用确认短语彻底清除本地数据；
7. 重新加载，确认首次使用说明再次出现。

商品、RFQ、交易等 Web 本地演示不属于扩展商店审核凭证。真实查询需要审核人员自有的 Alibaba.com 开放平台凭证；商店文案不提供项目开发账号，也不宣称审核人员无需权限即可完成真实网络流程。

2.12.0 的视频真实验收使用合成测试视频：Node 公网 URL、本地 MP4，以及正式 MV3 的分片暂停、后台重启、手工恢复、一次提交和平台回读均通过；不关联或修改商品、库存。正式插件真实写入走工作台同一受信消息入口，上传弹窗交互由离线 E2E 覆盖，不能混称为真实 UI 全链路自动验收。审核人员实际上传仍需自有账号权限；本地 MP4 还需自有 S3 及相应原生域名授权。平台受理不等于回读确认，未确认结果不得重复提交；完成的远端对象和视频不自动删除。

商品/RFQ 新编辑仅驻当前页面内存，不自动保存或恢复。旧本地编辑草稿不读取、不恢复、不迁移、不主动删除；显式清除本地数据入口保留。平台草稿、批量队列及持久任务不受影响。升级不自动锁定；旧版已锁定或无恢复材料的授权仍需原口令一次，应保留原口令；旧版“恢复编辑草稿”的描述不适用于 2.12.0。

可用于 2.13.0 更新摘要：

> 2.13.0 新增统一任务中心，集中查看商品、批量发品、素材传输及视频任务回执，结果不明时引导核对，不自动重发。独立日志页整合请求诊断、操作审计、本地数据和主机权限管理，并优化图片 ID 和视频关联文案。未增加扩展权限或真实写能力；视频关联写入仍关闭。

> Version 2.13.0 adds a unified task center for product, batch, asset-transfer and video receipts, guiding verification without automatic resubmission. A dedicated Logs page brings together request diagnostics, audit, local data and host permissions. Image ID and video-link labels are clearer. No new extension permissions or real write capabilities; video-relation writes remain disabled.

以下为 2.12.1 历史更新摘要：

> 2.12.1 优化视频素材到商品的选择和预览，已回读确认的上传任务也可进入商品选择；加强异常回执核对，避免将矛盾结果当作成功或自动重试，并精简安装包。真实视频关联写入仍未开放，未增加扩展权限。

> Version 2.12.1 improves product selection and preview from videos and confirmed upload tasks, handles conflicting receipts as unresolved rather than successful or automatically retryable, and reduces package size. Real video-relation writes remain disabled. No new extension permissions.

以下为 2.12.0 历史更新摘要：

> 2.12.0 统一列表搜索、筛选、列设置与行操作，新增独立只读库存页，优化图片/视频素材预览。正式插件支持受控视频上传、手工恢复与平台回读；Worker 真实上传仍关闭。商品/RFQ 编辑改为当前页面内存与离开确认，旧编辑草稿不自动恢复或删除。未新增扩展权限。

> Version 2.12.0 unifies list search, filters, column settings and row actions, adds a dedicated read-only inventory workspace, and improves image/video previews. The formal extension supports guarded video uploads, manual recovery and platform readback; Worker real uploads remain disabled. Product/RFQ edits stay in page memory with leave confirmation; legacy edit drafts are neither automatically restored nor deleted. No new extension permissions.

## V2 API 草稿包上传

Chrome Web Store V2 API 将“上传包”和“提交发布”拆成两个接口。本项目只封装官方 `media.upload` 和只读 `fetchStatus`；脚本中不存在 `publish` 调用，因此上传成功只会更新开发者后台草稿，不会提交审核或发布。官方要求现有条目的新包必须提升 manifest 版本。

推荐在开发者后台绑定 Google Cloud service account，并使用 `gcloud auth print-access-token --impersonate-service-account=... --scopes=https://www.googleapis.com/auth/chromewebstore` 获取短期 Token。不要在仓库、`.env`、GitHub Actions 日志或发布产物中保存 service account JSON key、OAuth client secret、refresh token 或 access token。

Windows PowerShell 本地流程：

```powershell
pnpm release:extension

$env:CHROME_WEB_STORE_PUBLISHER_ID = '<Publisher ID>'
$env:CHROME_WEB_STORE_ITEM_ID = '<32 位扩展 ID>'
$env:CHROME_WEB_STORE_ACCESS_TOKEN = '<短期 access token>'

# 只校验本地 ZIP、SHA-256、版本和目标，不发网络请求
pnpm upload:extension:draft

# 明确确认后，仅上传草稿并轮询上传状态
pnpm upload:extension:draft -- --confirm-draft-upload
```

成功记录写入已忽略的 `artifacts/chrome-web-store-draft-upload.json`，不包含 Token。普通 CI 只生成发布包；正式 SemVer Tag 会创建包含同一发布包和校验值的 GitHub Release，但两者都不默认访问商店 API。正式提交审核、发布范围和可见性仍在 Chrome Web Store Developer Dashboard 中人工确认。

官方参考：[Chrome Web Store API 使用指南](https://developer.chrome.com/docs/webstore/using-api)、[V2 media.upload](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload)、[service account 配置](https://developer.chrome.com/docs/webstore/service-accounts)。

## 当前阻断项

- [x] Chrome Web Store 开发者账号和现有扩展条目已可访问；
- [x] 2.3.1 已合并到公开 `master`，并已由项目所有者确认在 Chrome Web Store 上架；
- [x] 2026-09-08 正式包原生 S3 授权、保存、真实读写、后台重启及撤销权限拒绝均通过；最终报告为 `production-optional-grant`；
- [x] 2026-09-09 项目所有者确认 2.5.0 已上架；来源为用户确认，不是自动商店发布调用；
- [x] 发布包和商店资料不包含项目开发账号、密码、Token 或本地 `.env` 值；
- [x] 图库查询、分组管理、上传和外部图片转存已完成当前账号验证；商品上下架复用已完成真实生命周期验收的接口，并在扩展中增加本地持久任务、回读与恢复门禁；其他写能力继续由扩展后台门禁；
- [x] 商品上下架、平台草稿和正式发品插件路径均已完成真实账号 smoke，并使用持久任务、重复提交门禁和平台回读确认；
- [x] 用户口令加密保险库已实现，支持主动锁定和可选的空闲自动锁定；高安全场景仍建议使用用户控制的 BFF；
- [x] 已提供 V2 API 草稿包上传工具；未配置 Publisher、service account 和短期 Token 时只保留本地预检能力；
- [ ] 本文件不是法律意见，正式公开发布前仍需项目所有者确认隐私文本和适用地区要求。

## 2.6.0 送审交接（历史记录：当时已提交，审核中）

- 送审交接 ZIP：`artifacts/one-vegetable-v2.6.0-chrome-mv3.zip`，986,893 字节；SHA-256 `3acd177478d685578faef9fd8a44a43b38cf8ff808d3f8100f57d17d8e9cc72c`。已含 09-12 S3 缺少配置、本地 HTTP 提示和图库刷新补丁。对应提交 `adb1b1349f5dc3644423e57c9f41d8f1a21be007`，Windows 与主线 CI 产物一致。用户已提交后不再改变同版本运行内容，也不覆盖安装包。
- 仓库发布信息见 [v2.6.0 发布记录](releases/v2.6.0.md)。包内版本历史保留送审时的候选文案，审核进度在仓库单独记录，未来版本再更新包内文案。
- 中英文完整说明：`store-listing/zh_CN.md`、`store-listing/en.md`；权限与数据用途：`store-listing/listing.json`。打包后的副本位于 `artifacts/store-listing/`。
- 截图：`store-listing/assets/screenshots/zh-CN/`、`en-US/` 各 4 张，1280 × 800。全部来自 2.6.0 正式扩展构建的空白 Profile；没有开发凭据、测试账号或虚构商品。原 Small promo tile 与图标可继续使用。
- 本版不新增 Manifest 权限。更新商店功能描述中的图库任务恢复、列表可选列和橱窗管理；权限用途继续按现有声明填写。Node 凭据管理属于 Web/BFF，不宣传为插件新增的后端必需条件。
- 09-12 已对当前候选重新执行完整 `pnpm check`（946 项单测及三端构建）、38 项 Web/MV3 E2E、3 项 Worker 单测、2 项 BFF replay、2 项 Node 凭据 E2E和 28 项旧包升级检查；刷新/重启不会丢失加密配置和草稿，中断传输需手工核对。升级会重新锁定保险库，用户应保留原口令。
- 无账号审核步骤沿用上节。真实任务需要用户自有的 Alibaba 权限和可选 S3 配置；正式商店材料不得附带本项目的真实授权包。新任务能力及真实验收边界见 [2.6.0 候选包验收](release-2.6.0-readiness.md)。
- 送审由用户手工完成；仓库 tag/Release 已发布，现有 Cloudflare 网站经用户单独确认、备份 D1 并迁移后已部署 2.6.0，详见 [部署记录](release-2.6.0-readiness.md)。没有执行 Alibaba 业务写操作、重复 Store 上传或审核提交。审核中不等于已上架。

可用于版本更新摘要（不是替代完整商店描述）：

> 2.6.0 新增图库 ZIP/S3 传输记录、暂停与安全恢复，支持商品、图库和订单列表自定义显示列，以及商品橱窗管理。优化商品链接、表格布局及 S3 配置提示，图库可一键刷新并保留当前视图；升级保留本机配置与草稿。发生中断或结果不明时提示手工核对，避免重复上传。未新增扩展权限；实际接口可用性仍取决于账号权限。

> Version 2.6.0 adds gallery ZIP/S3 transfer history, pause and safe recovery, customizable columns for product, gallery and order lists, and product showcase management. Product links, table layouts and S3 configuration guidance are improved, with a gallery refresh that preserves the current view. Local settings and drafts are retained during upgrades. Interrupted or uncertain transfers require manual verification to avoid duplicate uploads. No new extension permissions; API availability still depends on account permissions.

## 2.5.0 上传交接（历史记录，已上架）

- ZIP：`artifacts/one-vegetable-v2.5.0-chrome-mv3.zip`；校验值以同目录 `.zip.sha256` 和 `release.json` 为准。
- 中英文说明、权限理由及审核说明：`artifacts/store-listing/`（由 `pnpm release:extension` 从仓库提交资料复制）。
- 本版重点：图库 ZIP/S3 导入导出、前缀与图库分组映射、可选自动创建目录，以及插件独立直连 S3。
- S3 密钥仅在受信插件后台使用；本地加密不能防御已被攻破的浏览器 Profile。不得在商店表单或截图中提供测试账号、Endpoint 密钥或真实业务数据。
- 验收边界与遗留项见 `docs/release-2.5.0-readiness.md` 和 `docs/extension-s3-validation.md`。
- Worker 仅在用户另行确认后部署，不调用商店发布 API；最终上传、审核提交与上架状态分别确认。
