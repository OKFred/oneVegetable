# 双运行时 BFF 开发

## 本地 Node

所有 Node 与 pnpm 命令在 Windows 终端运行：

```powershell
pnpm dev:api
```

默认监听 `http://localhost:8787/api/v1`，数据库位于 `.data/one-vegetable.sqlite`。仅
`local-node` 默认执行 migration；staging 与 production 必须先显式 migration 再启动。

Node 24 使用内置 `node:sqlite`，通过 Drizzle `sqlite-proxy` 接入共享 repository。这样无需
`better-sqlite3` 的 Visual Studio C++ 编译链；Worker 仍使用 `drizzle-orm/d1`。

首次启动前在本机 `.env` 配置一次性 `BOOTSTRAP_ADMIN_TOKEN`。Web 登录页的“初始化管理员”只在
数据库没有任何用户时有效；完成后应从环境中删除或轮换该值。账号不开放注册，普通用户只能由管理员创建。

## 本地 Worker + D1

```powershell
pnpm db:migrate:local
pnpm dev:worker
```

Wrangler 使用隔离的本地 D1。`GET /healthz` 仅确认进程存活，`GET /readyz` 还会确认当前
migration 版本。其他 API 全部使用 POST 和 JSON Body。

## Web 切换 BFF

复制 `.env.example` 后设置：

```text
VITE_GATEWAY_MODE=bff
VITE_BFF_BASE_URL=http://localhost:8787
VITE_BFF_API_PREFIX=/api/v1
```

Web 的所有业务调用会经 `BffGatewayClient -> NetworkManager -> NativeFetchTransport`，并在
Body 与 `X-Request-ID` 中关联同一个 UUID v4。

BFF 模式使用 HttpOnly 不透明 session Cookie 和双提交 CSRF。开发时 Web 与 API 的 Origin 必须出现在
`ONE_VEGETABLE_CORS_ORIGINS`；mutation 还必须携带匹配的 `Origin` 与 `X-CSRF-Token`。建议通过同源
反向代理暴露 Web 和 `/api/v1`，跨 Origin 部署时需要 HTTPS 且不能使用通配 CORS。

## Alibaba 真实只读网关

`ONE_VEGETABLE_GATEWAY_MODE` 支持 `mock`、`replay`、`disabled` 和 `real`，默认仍为 `mock`。没有真实账号
验收前，staging 使用 `replay`，production 保持 `disabled`。`replay` 使用 OpenAPI 文档示例经过真实签名、
NetworkManager、拆包、契约校验和领域适配器，但不会连接 Alibaba，也不需要任何 Alibaba 凭据。启用
`real` 时必须同时提供：

```text
ONE_VEGETABLE_ALIBABA_APP_KEY=
ONE_VEGETABLE_ALIBABA_APP_SECRET=
ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN=
ONE_VEGETABLE_ALIBABA_ENDPOINT=https://gw.open.1688.com/openapi/
ONE_VEGETABLE_ALIBABA_SIGN_METHOD=hmac-sha256
```

Node 本地值放在未提交的 `.env`；Worker 使用 `wrangler secret put` 注入 App Key、App Secret 和 Access
Token，不能写入 `wrangler.jsonc`、D1、日志或审计事件。管理页只显示是否配置、端点 Origin 和签名算法，
不会返回凭据值。

真实网关支持通用 capability 调试器和商品、RFQ、交易、数据洞察、图库（图片银行）、运费模板、旧订单
查询等专用只读操作。每次请求发送前验证 capability 请求契约，仅允许 active、read、无额外资格限制且
`realCallEnabled` 的能力；响应漂移会保留原始结果与 traceId，并附带契约告警。只读网络错误使用有限重试，
所有 attempt 复用同一个 requestId。

所有 mutation、文件上传、URL 转存和需要 OneTouch 等额外资格的物流能力仍在出网前拒绝。当前实现仅完成
Mock、契约和本地双运行时验证，不代表已通过 Alibaba 真实账号验收。

## 本地 BFF 文档回放 E2E

在 Windows 终端执行：

```powershell
pnpm test:e2e:bff-replay
```

该命令会删除并重建专用的 `apps/api/.wrangler/bff-replay-e2e` 测试 D1，随后在 8796 端口启动
Cloudflare Worker，在 4174 端口启动 BFF 模式 Web。Playwright 会通过页面初始化本地管理员，验证商品、
图库、RFQ、交易、运费模板、数据洞察和能力目录读请求，并确认管理后台显示 `cloudflare + D1 + replay`。
测试还会直接验证 mutation 在网关调用前返回 403，且响应 Body 与 `X-Request-ID` 保留同一个 requestId。

`pnpm check:replay-coverage` 是更细粒度的契约门禁：所有 active、read、`realCallEnabled` 且无资格限制的
能力都必须具有请求/响应示例，并能经过签名、文档回放拆包和响应 validator。官方错误示例保留在原始快照，
仅通过 `docs/alibaba-product-api-overrides.json` 的人工说明层修正。以上流程都不请求 Alibaba。

## 本地权限与审计

- 密码使用 PBKDF2-HMAC-SHA256（600,000 次），连续 5 次失败锁定 15 分钟。
- session 绝对有效期 8 小时、空闲有效期 30 分钟；数据库只保存 session 与 CSRF 的 SHA-256 hash。
- 普通用户只允许 active/read 操作；管理员仍不能绕过 capability、资格限制和 mutation flag。
- 用户实体使用 Unix Epoch 毫秒审计字段、`remark` 与乐观锁 `revision`。
- `audit_events` 只追加 requestId、主体、动作、资源、结果和 revision，不保存 Cookie、Token、密码、
  App Secret、文件 Base64 或完整 Alibaba 响应。
- `request_events` 记录 runtime、route、operation、actor、结果、状态码和耗时，不保存 Header、Body、
  Alibaba 原始响应或文件内容。管理员可按 requestId 精确关联请求诊断与操作审计。
- `ONE_VEGETABLE_REQUEST_RETENTION_DAYS` 控制请求诊断留存，默认 30 天、允许 1–90 天；清理接口只删除
  超过留存窗口的 `request_events`，不会删除 append-only 的 `audit_events`。管理页执行清理前需要二次确认。
- `ONE_VEGETABLE_MUTATION_FLAGS` 默认空值。没有真实账号验收前不要添加 `operation:*` 或
  `capability:*` 写能力标记。

## staging

staging 与 production 使用独立 D1 和显式 API prefix。仓库中的 database id、Origin 是不可部署的占位符，
首次配置 Cloudflare 项目时必须替换。`pnpm check:staging-config` 会在 migration 之前拒绝占位 D1、共享
database、非 HTTPS Origin、真实 staging 网关、production 非 disabled、mutation flag 或缺失部署凭据；
`pnpm check:staging-config:local` 仅用于验证仓库结构，允许占位配置。

staging 必须由 Cloudflare Access 保护；CI smoke 会先确认无 Access 凭据的请求被拒绝，再使用 service token
验证 healthz、readyz、requestId 和 `cloudflare + d1 + staging + replay` metadata。production 网关固定为
`disabled`，本阶段不部署 production，也不会请求 Alibaba。完整准备清单见
[staging 近生产验收手册](./staging-readiness.md)。

`BOOTSTRAP_ADMIN_TOKEN` 必须通过 `wrangler secret put BOOTSTRAP_ADMIN_TOKEN --env staging` 注入，不能
写入 `wrangler.jsonc` 或 CI 日志。Cloudflare Access 保护的是 staging 入口，BFF 本地账号仍会在应用层
再次认证；Access service token 仅用于 CI 的 `healthz/readyz` smoke，不会自动获得管理员权限。
