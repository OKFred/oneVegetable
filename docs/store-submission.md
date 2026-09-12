# Chrome Web Store 提交清单

检查日期：2026-09-12；项目所有者已确认 **2.6.0 提交 Chrome Web Store 审核**，尚未确认审核通过或上架。2.5.0 为此前已确认上架的版本；本次状态来自用户确认，不是自动化后台查询。不要重复上传或撤回审核。

## 已自动化验证

- MV3 manifest 的版本、名称和描述本地化、主页地址、权限最小集；
- 必选扩展权限仅为 `storage`、用户主动凭证向导所需的 `scripting`，必选主机仅为正式 HTTPS 网关；`scripting` 只在用户主动启动后向 Alibaba 开发者注册、应用中心及 OAuth 页面注入包内固定检测/引导代码，不读取注册资料值或代替提交；未出现 cookies、`tabs`、`webNavigation` 或必选 `<all_urls>`；
- 最低 Chrome 102，local/session 存储限制为可信扩展上下文，内容脚本不可读取；
- 应用中心、OAuth Callback、自定义网关、用户自托管社交发布 BFF、外部图片来源与用户配置的 S3 Endpoint 保持可选主机权限，并在用户启动对应功能时按具体站点申请；S3 不增加永久主机权限；
- 中英文商店文案、权限理由、本地隐私页和仓库隐私政策存在且版本一致；
- 128 × 128 商店图标、440 × 280 Small promo tile、3 张商店主截图，以及中英文各 4 张真实扩展页面的 1280 × 800 备选截图；
- 平台草稿、正式发品、商品更新/上下架、商品分组创建、橱窗加入/移出、图库分组管理、图片上传和外部图片转存只在用户主动操作后开放；其他未经扩展路径真实验收的 mutation 在出网前关闭；
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
2. 点击“开始授权向导”，确认直接进入开发者注册、平台审核、创建应用和 OAuth 四步凭证助手；无需实际 Alibaba 凭证即可关闭；
3. 打开 API 能力目录，检索已类型化的能力及其限制原因；
4. 打开设置，查看本地数据清单、脱敏诊断和额外主机权限；
5. 创建加密凭证保险库，配置空闲锁定时间，锁定后确认凭证编辑区消失，再用口令解锁；
6. 导出不包含具体值的数据清单，使用确认短语彻底清除本地数据；
7. 重新加载，确认首次使用说明再次出现。

商品、RFQ、交易等 Web 本地演示不属于扩展商店审核凭证。真实查询需要审核人员自有的 Alibaba.com 开放平台凭证；商店文案不提供项目开发账号，也不宣称审核人员无需权限即可完成真实网络流程。

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

## 2.6.0 送审交接（已提交，审核中）

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
