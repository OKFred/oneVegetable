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

- 只有一个应用时自动使用该应用。
- 多个应用时通过 `OPEN_API_APP_KEY` 或 `OPEN_API_APP_NAME` 精确选择。
- 默认保留线上 Callback URL。
- 只有设置 `OPEN_API_CALLBACK_URL` 时才会编辑并保存 Callback；该值必须是无凭据、无 fragment 的公共 HTTPS URL。
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

`artifacts/` 已被 Git 忽略，但 Windows 不保证 POSIX `0600` 文件权限完全生效。不要上传、提交、粘贴或通过聊天发送授权包和 Profile。截图在 AppSecret 显示及 OAuth 授权前生成，诊断文件不记录密码、Cookie、CSRF、授权码或 Token。

失败时不写入不完整的授权包，只保存脱敏的 `last-run.json` 和现场截图。CI 不运行该脚本，也不读取 `.env`。
