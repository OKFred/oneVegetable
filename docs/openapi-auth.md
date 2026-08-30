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

默认从仓库根目录的 `.env` 读取 Alibaba 网站登录账号。要用未绑定应用的测试账号验证“无应用、验证码或人工验证”分支，可显式运行：

```powershell
pnpm openapi:auth:free
```

该命令只在当前进程内读取 `.env.free`。脚本不会打印或持久化网站密码，也不会自动创建应用、申请 API 权限或接受平台协议；遇到滑块、验证码、MFA 等验证时保留有头页面供用户处理。

脚本使用 `artifacts/openapi-auth/profile` 保存独立 Chrome 会话。若出现验证码、滑块、二次验证或安全确认，请在打开的浏览器中手工完成；页面就绪后脚本会自动继续。

## 应用与 Callback

- 脚本会同时检查新版应用中心和旧 ICBU `crosstrade` 应用列表。新版页面可能显示 6 位应用标识，但旧 `oauth.alibaba.com` 需要旧平台 AppKey；当新版标识不可用于 OAuth 且只发现一个旧应用时，脚本自动使用旧应用。
- OAuth authorize 与 Token 交换均传递应用已登记的 `redirect_uri`。
- 多个应用时通过 `OPEN_API_APP_KEY` 或 `OPEN_API_APP_NAME` 精确选择。
- 默认保留线上 Callback URL。
- 只有设置 `OPEN_API_CALLBACK_URL` 时才会进入 Callback 修改流程；该值必须是无凭据、无 fragment 的公共 HTTPS URL。脚本会展示新旧地址并要求再次输入 `yes`，未确认时保留线上现值。
- 非交互调用若确实需要修改 Callback，必须额外显式设置 `OPEN_API_CALLBACK_CHANGE_CONFIRMED=1`；只设置新地址不会静默保存。
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

Node 授权工具只支持带桌面的 Windows 本机与系统 Chrome。远程或无桌面的 Node 部署不会尝试启动浏览器，应改用正式扩展导出授权包。

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

2026-08-20 最新一轮本地账号验证结果为：35 个候选中 22 个通过、5 个因权限包不足被拒绝、1 个返回 Alibaba 远端错误、7 个因缺少真实前置数据跳过，契约漂移为 0。商品评分和根商品分组查询已新增为账号验证通过。

完整本地报告仍位于已忽略的 `artifacts/`。仓库只保存脱敏快照 `config/alibaba-account-verification-results.json`，其中仅有方法、状态、稳定原因码和检查时间，不包含 requestId、traceId、响应结构、账号标识或凭据。构建期生成只读 TypeScript 快照，CI 检查漂移；契约文档状态和该次账号结果继续分开。

## 真实 Web 页面 Smoke

页面级 Smoke 同样需要显式 opt-in，且只允许在 Windows 本地运行：

```powershell
$env:ONE_VEGETABLE_REAL_WEB_SMOKE='1'
pnpm smoke:web:real
```

脚本使用独立的 `artifacts/real-web-smoke/one-vegetable.sqlite`，自动启动真实 Node BFF 与 BFF 模式 Web，验证管理员初始化、Dashboard、商品、图库、订单、RFQ、数据洞察和管理后台。商品验证会从真实列表响应中仅在内存提取明文商品 ID、混淆商品 ID和类目 ID，分别用于 Schema 编辑和评分；这些值不写入报告。报告只保存 operation、requestId、HTTP 状态、错误码和 Mock 哨兵检测结果，不保存真实响应内容。

2026-08-20 的页面验证中，Dashboard、顶级类目、商品分组、商品列表、真实商品 Schema、商品评分、图库分组、图库列表和订单列表均返回 200。编辑已有商品会调用 `alibaba.icbu.product.schema.render`，并要求真实 XML 成功解析、至少一个编辑字段已回填且无损 XML 预览非空；新建商品才调用 `schema.get` 获取类目模板。Alibaba 可能对列表中仍显示为 approved 的商品返回 `PUB_BIZCHECK_PRODUCT_IN_AUDITING`，因此 Smoke 会如实记录该 provider error，并在最多 5 个真实商品内寻找当前可渲染的样本。RFQ 与供应商排名按当前账号权限返回拒绝；Mock 哨兵为 0。商品更新按钮在真实模式中保持禁用，测试还会直接尝试一个商品分组写操作，并要求它在出网前以 `MUTATION_FLAG_DISABLED` 被拒绝。

`artifacts/` 已被 Git 忽略，但 Windows 不保证 POSIX `0600` 文件权限完全生效。不要上传、提交、粘贴或通过聊天发送授权包和 Profile。截图在 AppSecret 显示及 OAuth 授权前生成，并会先清空账号、密码、Token 等敏感表单值；进入密钥查看阶段后即使失败也不会补拍页面。诊断文件不记录密码、Cookie、CSRF、授权码或 Token。

失败时不写入不完整的授权包，只保存脱敏的 `last-run.json` 和现场截图。CI 不运行该脚本，也不读取 `.env`。
