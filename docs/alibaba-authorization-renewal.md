# Alibaba 授权续期 / Authorization renewal

网站登录、工作台登录、保险库解锁和 API 授权是四件不同的事。API 失效时不必注销工作台，也不要重发之前的商品写请求。

## 有效期

按 [ICBU 官方说明](https://developer.alibaba.com/docs/doc.htm?articleId=118846&docType=1&treeId=456)，`expires_in`、`re_expires_in` 分别表示 Access Token 和 Refresh Token 的有效秒数；不同应用及权限可能有不同期限。示例值不是所有账号的固定授权时长。

- 凭据配置显示实际到期时间和近似剩余时间；提前 7 天提示是项目 UX 规则，不是平台保证。
- 缺少有效期显示“未知”，不是永久有效，也不按获取时间猜一个到期日。
- 刷新凭证尚未到期也不保证续期成功；撤销、应用状态或特定接口权限可能使授权更早失效。
- 插件仅保留加密的 Access Token 到期元数据，不自动刷新。重新授权后保存到现有保险库即可；手工换 Token 清除旧到期记录。
- Node/Cloudflare 管理配置可尝试刷新；失败时重新授权并导入。环境变量/启动文件不支持页面直接刷新，先导入为加密配置。
- 刷新失败不等于当前 Access Token 失效：保留原凭据和失败记录，停止自动刷新重试。实际到期或业务 API 拒绝时仍停止调用；未知有效期不能当成永久有效，也不能因一次刷新失败封锁全部页面。可先测试连接，再决定重新授权。
- 续期失败会保留弹窗，展开“平台返回”可查看脱敏的 HTTP 状态、平台错误码、说明及 traceId。凭据确实更换成功后才重载业务工作区；失败不会清空当前页面。诊断不保存完整 Token 响应，也不回显密钥、Token 或授权码。
- 判断是否权限不足须依据实际平台错误，不能只根据 `ALIBABA_TOKEN_REFRESH_FAILED` 推断。当前旧授权包仍使用 TOP OAuth `oauth.alibaba.com/token`；新版 `System API` 为 Active 不代表该旧 Refresh Token 可以续期，也不自动切换到 IOP。

## 总览与新版 System API（2026-10-11 核对）

- 总览在真实 BFF/插件模式用“剩余授权时间”替换图片卡片；倒计时只依据当前凭据实际记录的到期时间，每分钟本地更新，不轮询平台、不自动授权或刷新。
- `System API`（含空格）与旧 `SystemAPI` 是两个不同权限组。新版 [Token 创建](https://openapi.alibaba.com/doc/api.htm#/api?cid=4&path=/auth/token/create&methodType=GET/POST) 文档返回 `expires_in` 和 `refresh_expires_in`；[Token 刷新](https://openapi.alibaba.com/doc/api.htm#/api?cid=4&path=/auth/token/refresh&methodType=GET/POST) 要求有有效 Refresh Token，不能反查旧 Token 的有效期。
- 授权包有精确 `System API / Active` 记录但缺少有效期：提示有效期未返回；快照未启用或未记录该组时提示关注续期；空权限清单、手工凭据、旧授权包均显示“权限未确认”，不冒充平台实际拒绝授权。
- 权限仅是导入时的快照，Tooltip 显示快照时间，不能代表当前后台权限。更换 AppKey/Secret/Token 后清除旧快照与有效期；重新导入或重新授权保存时再记录。
- 普通用户不调用管理员凭据接口；插件锁定时提示解锁，读取失败不判为权限缺失。已有 TOP 凭据记录有效期时也可以倒计时，不强制要求新版权限。
- 新版刷新说明仍引用 Lazada endpoint，存在文档残留；以 [IOP HTTP 调用说明](https://openapi.alibaba.com/doc/doc.htm#/?docId=61)中的 Alibaba 地址为准，不向其他平台发送凭据。
- 2026-10-11 真实验收已单独跑通 **IOP 授权 → Token 创建 → Token 续期 → 续期后真实商品列表查询**。该候选凭据仅保存在本机忽略目录，**未替换现有工作台配置**，没有商品写操作，也没有自动部署。
- 本次新 Token 返回 `expires_in=7560000`（约 87.5 天）和正数 `refresh_expires_in`；这是当前应用的实际响应，不是所有账号的固定有效期。按 [卖家 OAuth 说明](https://openapi.alibaba.com/doc/doc.htm#/?docId=56)，续期会更新 Token，但不会重新开始整个 Refresh Token 授权周期，最终仍可能需要重新授权。
- 旧应用实际返回 `param-refresh.token.expired / refresh token expired`，不是权限不足。即使刚重新授权，旧链路仍返回同一刷新拒绝；不能因新版 `System API` 为 Active 就改用 IOP 刷新旧 AppKey。已确认过期时停止重复刷新，界面保留原错误并引导重新授权；重新导入后重新判定能力。
- 新 AppKey 调旧 `eco.taobao.com/router/rest` 返回 `isv.appkey-not-exists`，旧 AppKey 调新版 Token 入口返回 `InvalidAppKey`。新版商品查询按 [接口详情](https://openapi.alibaba.com/doc/api.htm#/api?cid=1&path=/alibaba/icbu/product/list&methodType=GET/POST)使用 `https://openapi-api.alibaba.com/rest/alibaba/icbu/product/list`、`access_token`、毫秒 timestamp 与带 API 路径前缀的 HMAC-SHA256，已真实成功；协议不能混用。BFF/插件支持显式 IOP 导入及已适配只读能力，缺少协议字段的旧凭据仍按 TOP 处理，本机默认配置不自动改变。IOP 未适配方法及写操作出网前拒绝，不回退 TOP；详见[双协议说明](alibaba-gateway-protocols.md)。

### 独立 IOP 本地验收工具

这些命令是显式本地诊断，不属于生产自动续期，不读取或修改应用权限，也不替换服务的加密配置：

```text
pnpm exec tsx scripts/diagnose-alibaba-iop-auth.ts
pnpm exec tsx scripts/diagnose-alibaba-token-refresh.ts --bundle=<本机候选授权包路径> --refresh --iop
pnpm exec tsx scripts/diagnose-alibaba-token-refresh.ts --document=<上一步生成的refreshed-credentials.json路径> --test-iop
```

- 使用已有新版应用，在 loopback 页面输入应用配置，再到官方页面确认授权并粘贴 Callback；严格校验 state 和已登记 origin/path，只交换一次授权码。
- 续期成功后先原子保存新凭据，再做只读查询；即使查询失败，也不丢弃已轮换的 Token。再次测试使用新生成的文件，不复用可能已被轮换的旧 Refresh Token。
- 所有网络调用单次执行、不自动重试。诊断只保存状态、错误码、耗时及条数，不保存商品详情或完整响应；私有授权包和加密恢复基线在 `artifacts/authorization-renewal-validation/`，不要提交或分享。
- 当前测试账号在新版门户显示关联身份，已由用户确认可受控验证；不能将一次商品查询成功解释为新旧应用的所有身份、权限和业务方法均等价。

### 本机重新授权步骤

已有 `artifacts/openapi-auth/credentials.json` 时运行 `pnpm openapi:auth:reconnect`：

1. 打开终端显示的 `127.0.0.1` 随机端口页面，点击官方授权链接。
2. 使用平时 Chrome 的登录态，在官方页面确认原应用授权。不创建应用、不修改 Callback 或权限。
3. 将跳转后的完整 Callback 粘贴到本机表单。不要将它发到聊天、Issue 或日志。
4. 校验 origin/path/state 后只交换一次 code，完整授权包原子写入原文件。失败不覆盖旧文件；交换结果不明不能重试同一码。
5. 本地服务若已使用加密配置，在设置页导入新 JSON 并测试连接；服务读取启动文件时重新启动即可。不会自动同步到 Cloudflare 或其他插件。

接收器仅监听 loopback，校验 Host、同源 Origin 和随机 state；10 分钟后关闭，不保存 Callback/code，不回显密钥。授权文件含明文密钥，位于 Git 忽略目录。

TOP 和 IOP 可以各自使用原应用重新授权。脚本默认使用授权包中的 `protocol`；历史未标记的包仍按 TOP 处理，绝不根据 AppKey 猜测。Windows PowerShell 中重新授权 IOP 时，显式指定已有 IOP 包的路径：

```powershell
$env:OPEN_API_PROTOCOL = 'iop'
$env:OPEN_API_OUTPUT = 'artifacts/openapi-auth/iop-credentials.json'
pnpm openapi:auth:reconnect
```

该文件必须已经含有对应应用的完整凭据；此命令不创建应用。生成结果明确记录 `protocol`，不会把 IOP 文件误导入 TOP。显式协议与已标记的原包冲突时，出网前停止。两份授权独立导入本地工作台，TOP 默认协议不变；“配置 TOP / IOP”的消息只表示选择编辑对象，不代表已保存或已验证。

## English

Reconnect chooses the existing bundle's explicit protocol, with TOP as the backward-compatible default for unmarked bundles. For IOP, set `OPEN_API_PROTOCOL=iop` and `OPEN_API_OUTPUT` to its existing private bundle in PowerShell before running `pnpm openapi:auth:reconnect`. A conflicting explicit marker is rejected before any network call. Saved bundles always include the protocol; reconnecting one never imports or replaces the other automatically. Profile-selection notifications do not imply a saved or verified grant.

The Overview countdown uses only the current credential's recorded expiry. System API and SystemAPI are distinct. Permission evidence is an import-time snapshot, not a live entitlement check; missing or empty metadata is not proof of missing permission. No expiry means no fabricated countdown. Enabling a new permission cannot reveal an old token's expiry.

On 2026-10-11, the independent IOP flow passed live authorization, token exchange, refresh and a product-list read using the refreshed token. The returned access lifetime was approximately 87.5 days for this application only. The legacy refresh explicitly returned `param-refresh.token.expired`, not a permission error. Known expiry disables repeated refresh attempts until new credentials are imported. The candidate credentials were not installed into the existing workbench; no products were changed.

New IOP app keys are not accepted by the legacy TOP gateway, and legacy app keys are not accepted by the new token endpoint. The documented IOP product-list path requires its own access-token parameter and path-prefixed HMAC-SHA256 signature. Do not mix protocols, send credentials to the stale Lazada endpoint in the refresh description, or assume all methods and identities are equivalent. The local diagnostic tools preserve a successful rotation before any subsequent read, never automatically retry, and store only sanitized receipts plus private ignored credential files.

Website login, workbench login, vault unlock and API authorization are independent. Token lifetime comes from the actual OAuth response, not a universal duration. Unknown expiry never means permanent authorization. The seven-day notice is a local reminder only; access can be revoked earlier.

A failed refresh retains the same credentials and failure record, disables automatic refresh retries, and does not prove that the current access token is invalid. Recorded expiry and business API rejection still apply. Test the connection before reauthorizing; never switch accounts or fall back to Mock.

The renewal dialog stays open after failure. Expand “Platform response” for the sanitized HTTP status, provider error code, description and trace ID. Only a successful credential change reloads the workbench. Diagnostics never expose the full token response or credentials. A generic refresh failure is not proof of insufficient permissions; the legacy TOP OAuth flow is not automatically replaced by IOP when System API becomes active.

Use `pnpm openapi:auth:reconnect` with an existing bundle to authorize in your signed-in browser. Paste the callback into the loopback form, never into a chat or issue. The receiver validates the registered callback and state, exchanges the code once, and atomically saves the local bundle. Import it into the server's encrypted configuration and run a read-only connection test. No product operations are replayed, and no credentials are synced to other installations automatically.
