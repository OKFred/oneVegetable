# Alibaba OpenAPI 本地授权

该工具只用于 Windows 本地开发，以有头 Chrome 获取已有 Alibaba.com OpenAPI 应用的授权包。它不会创建、删除、下线或重置应用，也不会启用任何真实写能力。

## 准备

在仓库根目录的 `.env` 中配置网站登录账号和密码：

```dotenv
ALI_ACCOUNT=your-login-account
ALL_PASS=your-login-password
```

这两个变量只用于登录 `i.alibaba.com`，不是 AppKey 和 AppSecret。脚本不会打印它们，也不会把它们写入结果文件。

运行：

```powershell
pnpm openapi:auth
```

脚本使用 `artifacts/openapi-auth/profile` 保存独立 Chrome 会话。若出现验证码、滑块、二次验证或安全确认，请在打开的浏览器中手工完成；页面就绪后脚本会自动继续。

## 应用与 Callback

- 脚本会同时检查新版应用中心和旧 ICBU `crosstrade` 应用列表。新版页面可能显示 6 位应用标识，但旧 `oauth.alibaba.com` 需要旧平台 AppKey；当新版标识不可用于 OAuth 且只发现一个旧应用时，脚本自动使用旧应用。
- OAuth authorize 与 Token 交换均传递应用已登记的 `redirect_uri`。
- 多个应用时通过 `OPEN_API_APP_KEY` 或 `OPEN_API_APP_NAME` 精确选择。
- 默认保留线上 Callback URL。
- 只有设置 `OPEN_API_CALLBACK_URL` 时才会编辑并保存 Callback；该值必须是无凭据、无 fragment 的公共 HTTPS URL。
- 自动选中旧 `crosstrade` OAuth 应用时，脚本会拒绝通过新版应用中心修改 Callback，避免误改另一个应用。
- 脚本不会自动恢复显式保存的新 Callback URL。

其他可选变量：

```dotenv
OPEN_API_TARGET_URL=https://i.alibaba.com/explore/open-api
OPEN_API_OUTPUT=artifacts/openapi-auth/credentials.json
OPEN_API_PROFILE_DIR=artifacts/openapi-auth/profile
OPEN_API_MANUAL_FALLBACK=1
OPEN_API_TIMEOUT_MS=180000
OPEN_API_MANUAL_TIMEOUT_MS=600000
```

## 本地输出与安全边界

成功后生成 `artifacts/openapi-auth/credentials.json`，其中包含 AppKey、AppSecret、Access Token 和可能存在的 Refresh Token。授权码只用于即时交换 Token，不写入磁盘。

授权包包含 Refresh Token 时可刷新：

```powershell
pnpm openapi:auth:refresh
```

刷新失败或没有 Refresh Token 时重新运行 `pnpm openapi:auth`。BFF 不会在业务请求中静默刷新 Token。

本地 Node BFF 可直接读取该授权包：

```powershell
pnpm dev:api:real
```

该命令强制使用 `local-node` 与 `real` 网关模式；Worker、staging 和 production 不读取本地授权文件。

## 真实只读 Smoke

真实 Smoke 是显式 opt-in 命令，不进入 CI：

```powershell
$env:ONE_VEGETABLE_REAL_SMOKE='1'
pnpm smoke:alibaba:real
```

脚本只选择 `active + read + realCallEnabled + 非受限` 能力，串行调用且每次间隔至少 300 ms。列表结果中的商品、类目、RFQ、订单和供应商标识会仅在内存中作为详情请求前置参数使用；没有真实前置数据的调用标记为 `skipped-prerequisite`，不会使用文档中的占位 ID。

报告写入 `artifacts/real-smoke/report.json`，只包含 requestId、方法、状态、上游错误码、契约问题和字段类型结构，不保存业务字段值或完整 Alibaba 响应。真实 mutation 不在候选集合中，任何 mutation feature flag 仍保持关闭。

2026-08-20 最新一轮本地账号验证结果为：35 个候选中 21 个通过、5 个因权限包不足被拒绝、1 个返回 Alibaba 远端错误、8 个因缺少真实前置数据跳过，契约漂移为 0。`alibaba.icbu.product.score.get` 在本轮新增为账号验证通过。该账号的逐项结果仍只保存在本地报告；仓库仅记录已通过方法的 `account-verified` 状态和不含账号数据的契约修正。

`artifacts/` 已被 Git 忽略，但 Windows 不保证 POSIX `0600` 文件权限完全生效。不要上传、提交、粘贴或通过聊天发送授权包和 Profile。截图在 AppSecret 显示及 OAuth 授权前生成，诊断文件不记录密码、Cookie、CSRF、授权码或 Token。

失败时不写入不完整的授权包，只保存脱敏的 `last-run.json` 和现场截图。CI 不运行该脚本，也不读取 `.env`。
