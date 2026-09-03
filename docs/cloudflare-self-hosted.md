# Cloudflare 自托管指南

## 一键部署

从公开仓库点击：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OKFred/oneVegetable)

部署过程会从仓库根目录构建 Vue Web 与 Hono Worker，自动创建并绑定 `DB` D1 数据库，先执行 `apps/api/drizzle` migration，再部署 Worker。Web 与 API 同源，业务接口默认位于 `/api/v1`，不需要另外部署 Pages 或配置 CORS。

Wrangler 还会自动创建私有 `SOCIAL_MEDIA` R2 binding，供 Facebook/Instagram 单图发布暂存素材。R2 桶不启用公共访问；Worker 仅通过随机临时地址提供单个对象，最长保留 24 小时。

部署页只要求两个互相独立的 Secret：

- `BOOTSTRAP_ADMIN_TOKEN`：至少 32 字节随机值，仅用于创建首个管理员。
- `ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY`：恰好 32 字节的 Base64URL 值，用于 AES-256-GCM 凭据保险库。

可在 Windows PowerShell 本地生成，命令只输出到当前终端，不要把结果提交到仓库或放进聊天记录：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
```

两个 Secret 必须分别生成，不能使用 Alibaba 密码、AppSecret 或同一个随机值。

## 首次管理员与 Passkey

部署完成后打开 Worker URL：

1. 输入 `BOOTSTRAP_ADMIN_TOKEN` 和工作台用户名。
2. 按浏览器提示使用 Windows Hello、安全密钥或密码管理器创建 Passkey。
3. 将一次性显示的 10 个恢复码保存到密码管理器。

自托管 Worker 不执行 PBKDF2 密码登录。管理员可以在管理后台登记多个 Passkey；唯一登录凭据不能删除。管理员创建用户时会获得 24 小时有效的一次性注册链接，不会生成临时密码。

更换自定义域名会改变 WebAuthn RP ID，旧域名 Passkey 不能直接复用。用户应在新域名选择“恢复访问”，输入用户名和一个未使用的恢复码，登记新 Passkey；成功后全部旧会话和恢复码失效，并生成一套新恢复码。

## Alibaba 凭据保险库

Alibaba 网站登录账号不等于 OpenAPI 凭据。登录工作台后，在“管理后台 → Cloudflare 自托管设置”可选择：

- “一键连接”：使用 Browser Run 尝试读取已有应用并完成 OAuth。账号、密码只在当前请求和临时浏览器内存中处理；不写入 D1、日志、审计、截图或录制。Callback 默认留空并保留应用现值。
- “使用本机插件”：不提交网站密码，也不占用 Browser Run 免费额度；适合滑块、验证码、MFA 或密钥查看确认。

若账号仍需开发者注册、正在审核、被退回、没有应用或应用尚未可授权，Browser Run 只返回脱敏的 `prerequisite-required` 原因码并立即关闭会话。企业资料填写、证明材料、协议确认、注册提交及应用创建必须在用户本机 Alibaba 页面完成。

- “导入凭据”：选择本机 Playwright 或插件导出的 `credentials.json` / `credentialInfo.json`。

云端自动流程不会创建应用、申请 API 权限、填写开发者资料或接受协议。多个应用必须人工选择，显式修改 Callback 必须再次确认。遇到人机验证、机器人拒绝、额度不足或页面布局无法安全识别时，任务立即停止并转入插件引导；系统不会绕过验证，也不会回退到 Mock。

Browser Run 免费额度有限。项目开发和 CI 使用本地模拟、Windows 有头 Playwright 与 Wrangler dry-run；仅在发布候选完成后做一次云端验收。dry-run 不会创建远程浏览器会话。

凭据进入保险库后：

- 导入本地授权包时，浏览器先校验结构；确认后通过同源、带 CSRF 的管理接口提交。
- Worker 使用 AES-256-GCM 加密后写入 D1，AAD 绑定记录 ID、Schema 版本和密钥版本。
- 管理接口只显示完整性、Token 到期时间和刷新状态，不回显 AppKey、AppSecret、Token 或 refresh token。
- Access Token 到期前 5 分钟自动刷新；刷新失败时真实调用会明确失败，不回退到 Mock。

加密 Secret 丢失时无法恢复原密文，只能在 Cloudflare 中配置新密钥并重新导入授权包。本版本不提供在线密钥轮换。

## Meta 社交发布

Alibaba 凭据和 Meta 凭据互不复用。登录后打开“管理后台 → 社交账号”：

1. 在 Meta for Developers 创建或选择一个 Business 应用，并启用 Facebook Login for Business。
2. 将 App ID、App Secret 和当前 Worker 的公开 Origin 保存到 oneVegetable。
3. 复制页面显示的 Callback URL，填入 Meta 的 Valid OAuth Redirect URIs。
4. 连接一个有 Page 管理权限的 Meta 身份；系统会发现 Facebook Page 和与 Page 关联的 Instagram 专业账号。
5. 回到图库，选择一张图片，通过二次确认发布到一个目标。

所需权限是 `pages_show_list`、`pages_read_engagement`、`pages_manage_posts`、`instagram_basic` 和 `instagram_content_publish`。开发模式只能用于应用角色和可访问的测试资产；正式范围与权限审核以 Meta 当前后台为准。完整限制、插件配对和平台验收边界见 [图库社交分享](social-gallery-sharing.md)。

## 真实能力与急停

未导入凭据时，系统和管理功能仍可使用，Alibaba 能力返回 `ALIBABA_CREDENTIALS_NOT_CONFIGURED`，不会显示 Mock 数据。

自托管环境仅开放已经完成真实账号验收的七项写操作：发品、保存平台草稿、更新商品、上下架、图库分组操作、图库上传和外部 URL 转存。RFQ、交易、物流写入及创建商品分组仍关闭，管理员不能自行扩大白名单。

“暂停全部真实写入”会在 ABAC feature flag 前生效，并优先于所有已配置 operation flag。恢复时也只恢复固定白名单，不会启用未验收能力。状态变更需要管理员会话、Origin、CSRF 和 revision，并进入 append-only 审计。

## 本地验收

所有命令在 Windows 环境执行：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm cloudflare:build
pnpm db:migrate:local
pnpm dev:worker
```

`pnpm cloudflare:build` 会检查 OpenAPI、生成类型和 Worker Env 类型，构建同源 Web，并执行 Wrangler dry-run。`/api/v1/readyz` 只检查 Worker、D1、migration 和加密设施；Alibaba 凭据未配置不会让部署变为 not-ready。

生产凭据、恢复码、`.dev.vars`、D1 本地数据和授权包都不进入 Git。真实 mutation 仍应逐项人工确认，requestId 仅用于链路追踪，不是幂等键。
