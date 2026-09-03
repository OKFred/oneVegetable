# Chrome Web Store 提交清单

检查日期：2026-08-28

## 已自动化验证

- MV3 manifest 的版本、名称和描述本地化、主页地址、权限最小集；
- 必选扩展权限仅为 `storage`、用户主动凭证向导所需的 `scripting`，必选主机仅为正式 HTTPS 网关；`scripting` 只在用户主动启动后向 Alibaba 开发者注册、应用中心及 OAuth 页面注入包内固定检测/引导代码，不读取注册资料值或代替提交；未出现 cookies、`tabs`、`webNavigation` 或必选 `<all_urls>`；
- 最低 Chrome 102，local/session 存储限制为可信扩展上下文，内容脚本不可读取；
- 应用中心、OAuth Callback、自定义网关、用户自托管社交发布 BFF 与外部图片来源保持可选主机权限，并在用户启动对应功能时按具体站点申请；
- 中英文商店文案、权限理由、本地隐私页和仓库隐私政策存在且版本一致；
- 128 × 128 商店图标、3 张商店主截图，以及中英文各 4 张真实扩展页面的 1280 × 800 备选截图；
- 平台草稿、正式发品、商品上下架、图库分组管理、图片上传和外部图片转存只在用户主动操作后开放；其他未经扩展路径真实验收的 mutation 在出网前关闭；
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
- [x] 2.2.0 已合并到公开 `master`，GitHub Release、未登录隐私政策访问和商店草稿包上传均已确认；
- [ ] 使用 2.2.1 披露修复包替换 2.2.0 商店草稿后，才可提交审核；
- [x] 发布包和商店资料不包含项目开发账号、密码、Token 或本地 `.env` 值；
- [x] 图库查询、分组管理、上传和外部图片转存已完成当前账号验证；商品上下架复用已完成真实生命周期验收的接口，并在扩展中增加本地持久任务、回读与恢复门禁；其他写能力继续由扩展后台门禁；
- [x] 商品上下架、平台草稿和正式发品插件路径均已完成真实账号 smoke，并使用持久任务、重复提交门禁和平台回读确认；
- [x] 用户口令加密保险库已实现，支持主动锁定和可选的空闲自动锁定；高安全场景仍建议使用用户控制的 BFF；
- [x] 已提供 V2 API 草稿包上传工具；未配置 Publisher、service account 和短期 Token 时只保留本地预检能力；
- [ ] 本文件不是法律意见，正式公开发布前仍需项目所有者确认隐私文本和适用地区要求。
