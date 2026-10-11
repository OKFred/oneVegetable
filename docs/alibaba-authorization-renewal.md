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

## 总览与新版 System API（2026-10-11 核对）

- 总览在真实 BFF/插件模式用“剩余授权时间”替换图片卡片；倒计时只依据当前凭据实际记录的到期时间，每分钟本地更新，不轮询平台、不自动授权或刷新。
- `System API`（含空格）与旧 `SystemAPI` 是两个不同权限组。新版 [Token 创建](https://openapi.alibaba.com/doc/api.htm#/api?cid=4&path=/auth/token/create&methodType=GET/POST) 文档返回 `expires_in` 和 `refresh_expires_in`；[Token 刷新](https://openapi.alibaba.com/doc/api.htm#/api?cid=4&path=/auth/token/refresh&methodType=GET/POST) 要求有有效 Refresh Token，不能反查旧 Token 的有效期。
- 授权包有精确 `System API / Active` 记录但缺少有效期：提示有效期未返回；快照未启用或未记录该组时提示关注续期；空权限清单、手工凭据、旧授权包均显示“权限未确认”，不冒充平台实际拒绝授权。
- 权限仅是导入时的快照，Tooltip 显示快照时间，不能代表当前后台权限。更换 AppKey/Secret/Token 后清除旧快照与有效期；重新导入或重新授权保存时再记录。
- 普通用户不调用管理员凭据接口；插件锁定时提示解锁，读取失败不判为权限缺失。已有 TOP 凭据记录有效期时也可以倒计时，不强制要求新版权限。
- 新版刷新说明仍引用 Lazada endpoint。本轮只核对文档和兼容有效期字段，**未切换 OAuth endpoint、签名、网关或执行真实刷新**。IOP 授权、换 Token、刷新及真实商品只读调用须单独验收，不能因权限 Active 混用 TOP。

### 本机重新授权步骤

已有 `artifacts/openapi-auth/credentials.json` 时运行 `pnpm openapi:auth:reconnect`：

1. 打开终端显示的 `127.0.0.1` 随机端口页面，点击官方授权链接。
2. 使用平时 Chrome 的登录态，在官方页面确认原应用授权。不创建应用、不修改 Callback 或权限。
3. 将跳转后的完整 Callback 粘贴到本机表单。不要将它发到聊天、Issue 或日志。
4. 校验 origin/path/state 后只交换一次 code，完整授权包原子写入原文件。失败不覆盖旧文件；交换结果不明不能重试同一码。
5. 本地服务若已使用加密配置，在设置页导入新 JSON 并测试连接；服务读取启动文件时重新启动即可。不会自动同步到 Cloudflare 或其他插件。

接收器仅监听 loopback，校验 Host、同源 Origin 和随机 state；10 分钟后关闭，不保存 Callback/code，不回显密钥。授权文件含明文密钥，位于 Git 忽略目录。

## English

The Overview countdown uses only the current credential's recorded expiry. System API and SystemAPI are distinct. Permission evidence is an import-time snapshot, not a live entitlement check; missing or empty metadata is not proof of missing permission. No expiry means no fabricated countdown. Enabling a new permission cannot reveal an old token's expiry. The IOP flow still needs separate live acceptance and never replaces the existing TOP flow automatically.

Website login, workbench login, vault unlock and API authorization are independent. Token lifetime comes from the actual OAuth response, not a universal duration. Unknown expiry never means permanent authorization. The seven-day notice is a local reminder only; access can be revoked earlier.

A failed refresh retains the same credentials and failure record, disables automatic refresh retries, and does not prove that the current access token is invalid. Recorded expiry and business API rejection still apply. Test the connection before reauthorizing; never switch accounts or fall back to Mock.

Use `pnpm openapi:auth:reconnect` with an existing bundle to authorize in your signed-in browser. Paste the callback into the loopback form, never into a chat or issue. The receiver validates the registered callback and state, exchanges the code once, and atomically saves the local bundle. Import it into the server's encrypted configuration and run a read-only connection test. No product operations are replayed, and no credentials are synced to other installations automatically.
