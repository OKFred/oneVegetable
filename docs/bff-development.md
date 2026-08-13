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

## staging

staging 与 production 使用独立 D1 和显式 API prefix。仓库中的 database id 是不可部署的占位符，
首次配置 Cloudflare 项目时必须替换。staging 必须由 Cloudflare Access 保护；CI smoke 使用 service
token。production 网关固定为 `disabled`，本阶段不部署 production，也不会请求 Alibaba。
