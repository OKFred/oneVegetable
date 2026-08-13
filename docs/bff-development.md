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

## 本地权限与审计

- 密码使用 PBKDF2-HMAC-SHA256（600,000 次），连续 5 次失败锁定 15 分钟。
- session 绝对有效期 8 小时、空闲有效期 30 分钟；数据库只保存 session 与 CSRF 的 SHA-256 hash。
- 普通用户只允许 active/read 操作；管理员仍不能绕过 capability、资格限制和 mutation flag。
- 用户实体使用 Unix Epoch 毫秒审计字段、`remark` 与乐观锁 `revision`。
- `audit_events` 只追加 requestId、主体、动作、资源、结果和 revision，不保存 Cookie、Token、密码、
  App Secret、文件 Base64 或完整 Alibaba 响应。
- `ONE_VEGETABLE_MUTATION_FLAGS` 默认空值。没有真实账号验收前不要添加 `operation:*` 或
  `capability:*` 写能力标记。

## staging

staging 与 production 使用独立 D1 和显式 API prefix。仓库中的 database id 是不可部署的占位符，
首次配置 Cloudflare 项目时必须替换。staging 必须由 Cloudflare Access 保护；CI smoke 使用 service
token。production 网关固定为 `disabled`，本阶段不部署 production，也不会请求 Alibaba。

`BOOTSTRAP_ADMIN_TOKEN` 必须通过 `wrangler secret put BOOTSTRAP_ADMIN_TOKEN --env staging` 注入，不能
写入 `wrangler.jsonc` 或 CI 日志。Cloudflare Access 保护的是 staging 入口，BFF 本地账号仍会在应用层
再次认证；Access service token 仅用于 CI 的 `healthz/readyz` smoke，不会自动获得管理员权限。
