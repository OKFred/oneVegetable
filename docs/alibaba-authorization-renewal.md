# Alibaba 授权续期 / Authorization renewal

网站登录、工作台登录、保险库解锁和 API 授权是四件不同的事。API 失效时不必注销工作台，也不要重发之前的商品写请求。

## 有效期

按 [ICBU 官方说明](https://developer.alibaba.com/docs/doc.htm?articleId=118846&docType=1&treeId=456)，`expires_in`、`re_expires_in` 分别表示 Access Token 和 Refresh Token 的有效秒数；不同应用及权限可能有不同期限。示例值不是所有账号的固定授权时长。

- 凭据配置显示实际到期时间和近似剩余时间；提前 7 天提示是项目 UX 规则，不是平台保证。
- 缺少有效期显示“未知”，不是永久有效，也不按获取时间猜一个到期日。
- 刷新凭证尚未到期也不保证续期成功；撤销、应用状态或特定接口权限可能使授权更早失效。
- 插件仅保留加密的 Access Token 到期元数据，不自动刷新。重新授权后保存到现有保险库即可；手工换 Token 清除旧到期记录。
- Node/Cloudflare 管理配置可尝试刷新；失败时重新授权并导入。环境变量/启动文件不支持页面直接刷新，先导入为加密配置。

## 本机重新授权

已有 `artifacts/openapi-auth/credentials.json` 时运行 `pnpm openapi:auth:reconnect`：

1. 打开终端显示的 `127.0.0.1` 随机端口页面，点击官方授权链接。
2. 使用平时 Chrome 的登录态，在官方页面确认原应用授权。不创建应用、不修改 Callback 或权限。
3. 将跳转后的完整 Callback 粘贴到本机表单。不要将它发到聊天、Issue 或日志。
4. 校验 origin/path/state 后只交换一次 code，完整授权包原子写入原文件。失败不覆盖旧文件；交换结果不明不能重试同一码。
5. 本地服务若已使用加密配置，在设置页导入新 JSON 并测试连接；服务读取启动文件时重新启动即可。不会自动同步到 Cloudflare 或其他插件。

接收器仅监听 loopback，校验 Host、同源 Origin 和随机 state；10 分钟后关闭，不保存 Callback/code，不回显密钥。授权文件含明文密钥，位于 Git 忽略目录。

## English

Website login, workbench login, vault unlock and API authorization are independent. Token lifetime comes from the actual OAuth response, not a universal duration. Unknown expiry never means permanent authorization. The seven-day notice is a local reminder only; access can be revoked earlier.

Use `pnpm openapi:auth:reconnect` with an existing bundle to authorize in your signed-in browser. Paste the callback into the loopback form, never into a chat or issue. The receiver validates the registered callback and state, exchanges the code once, and atomically saves the local bundle. Import it into the server's encrypted configuration and run a read-only connection test. No product operations are replayed, and no credentials are synced to other installations automatically.
