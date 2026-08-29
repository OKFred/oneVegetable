# Cloudflare 自托管指南

## 一键部署

从公开仓库点击：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OKFred/oneVegetable)

部署过程会从仓库根目录构建 Vue Web 与 Hono Worker，自动创建并绑定 `DB` D1 数据库，先执行 `apps/api/drizzle` migration，再部署 Worker。Web 与 API 同源，业务接口默认位于 `/api/v1`，不需要另外部署 Pages 或配置 CORS。

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

Alibaba 网站登录账号不等于 OpenAPI 凭据。登录工作台后，在“管理后台 → Cloudflare 自托管设置”选择本地 `credentials.json`：

- 浏览器先校验授权包结构；确认后通过同源、带 CSRF 的管理接口提交。
- Worker 使用 AES-256-GCM 加密后写入 D1，AAD 绑定记录 ID、Schema 版本和密钥版本。
- 管理接口只显示完整性、Token 到期时间和刷新状态，不回显 AppKey、AppSecret、Token 或 refresh token。
- Access Token 到期前 5 分钟自动刷新；刷新失败时真实调用会明确失败，不回退到 Mock。

加密 Secret 丢失时无法恢复原密文，只能在 Cloudflare 中配置新密钥并重新导入授权包。本版本不提供在线密钥轮换。

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
