# staging 近生产验收手册

## 验收边界

staging 运行真实 Cloudflare Worker、Cloudflare Access 和独立 D1，但 Alibaba 网关固定为 `replay`。
文档回放会执行与真实只读模式相同的签名、集中网络层、重试、响应拆包、契约校验和领域适配器；数据只来自
仓库中的 OpenAPI examples。它能发现运行时、数据库、契约和适配器问题，不能替代 Alibaba 账号、权限、
限流和真实响应验收。

production 始终保持 `ONE_VEGETABLE_GATEWAY_MODE=disabled`、空 mutation flags，当前流程不会部署
production。

## 首次配置

1. 分别创建 staging、production D1，替换 `apps/api/wrangler.jsonc` 中三个占位 database id；不得复用
   database name 或 id。
2. 将 staging、production 的 CORS 值替换为各自 Web HTTPS Origin，并设置 GitHub Environment `staging`
   的 `STAGING_BASE_URL`。
3. 在 Cloudflare Access 中保护 staging Worker 自定义域名，创建仅供 CI 使用的 service token。
4. 配置 GitHub Environment secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CF_ACCESS_CLIENT_ID`
   - `CF_ACCESS_CLIENT_SECRET`
5. 使用 `wrangler secret put BOOTSTRAP_ADMIN_TOKEN --env staging` 写入一次性初始化值。初始化管理员后轮换或
   删除；不要写入 `wrangler.jsonc`、D1、GitHub 日志或仓库文件。

staging replay 不配置 App Key、App Secret 或 Access Token。真实 Alibaba 凭据缺失不会影响回放。

## 部署顺序

工作流 `.github/workflows/deploy-staging.yml` 只在合并到 main 或手工触发时运行，顺序固定为：

1. 全仓质量检查。
2. 严格 staging preflight。
3. 针对 `--env staging` 的 Worker dry-run 构建。
4. 对远程 staging D1 应用 migration。
5. 部署固定 staging Worker。
6. Cloudflare Access 保护与 metadata smoke。

preflight 不读取或输出 secret 内容，只报告缺失变量名称。严格检查失败时不得跳过 migration 前的安全门。

## Windows 本地仿真

所有命令在 Windows 终端执行。使用独立 persist 目录，避免污染日常 local-worker D1：

```powershell
pnpm check:staging-config:local
pnpm --filter @one-vegetable/api exec wrangler d1 migrations apply one-vegetable-staging --local --env staging --persist-to .wrangler\staging-replay
pnpm --filter @one-vegetable/api exec wrangler dev --env staging --port 8795 --persist-to .wrangler\staging-replay --var BOOTSTRAP_ADMIN_TOKEN:local-one-time-token
```

另开 Windows 终端执行管理员及 replay smoke：

```powershell
$env:SMOKE_BASE_URL='http://127.0.0.1:8795'
$env:SMOKE_BOOTSTRAP_TOKEN='local-one-time-token'
$env:SMOKE_EXPECTED_GATEWAY_MODE='replay'
pnpm smoke:local-auth
```

本地没有 Cloudflare Access，因此只能显式跳过 Access 拒绝检查来验证其余 staging smoke：

```powershell
$env:STAGING_BASE_URL='http://127.0.0.1:8795'
$env:CF_ACCESS_CLIENT_ID='local-smoke'
$env:CF_ACCESS_CLIENT_SECRET='local-smoke'
$env:STAGING_SMOKE_ALLOW_HTTP='true'
$env:STAGING_SMOKE_SKIP_ACCESS_DENIAL_CHECK='true'
node scripts/smoke-staging.mjs
```

这两个本地开关不得配置到 GitHub staging Environment。

## 故障验证

`DocumentationReplayTransport` 的测试覆盖：

- 首次 429 后使用同一个 requestId 重试。
- 持续 503 映射为可重试的上游不可用错误。
- 响应漂移保留原始数据并返回契约告警。
- fixture 递归拒绝凭据、Cookie、签名及文件 Base64 字段。

故障模式只通过测试构造参数注入，不暴露为 staging HTTP 参数或管理员开关，避免外部调用者改变服务行为。
