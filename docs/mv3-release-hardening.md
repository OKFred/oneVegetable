# MV3 发布与可观测性加固

## 权限边界

生产 manifest 的默认权限保持为：

- `storage`：加密凭证保险库写入 `chrome.storage.local`，诊断写入 `chrome.storage.session`；保险库口令不保存。
- `https://eco.taobao.com/*`：国际站正式 HTTPS 网关。

扩展不再申请 `cookies` 或必选 `<all_urls>`。自定义网关和外部图片 URL 使用
`optional_host_permissions` 声明的 HTTP(S) 范围，并在用户保存网关或执行 URL 转存时按目标主机请求授权；拒绝授权不会继续请求。

## 脱敏诊断

设置页可刷新、导出和清空最近 100 条 service worker 诊断。每条记录只包含：

- 操作名、对应 API 方法、成功/失败和耗时；
- 错误码、截断并脱敏后的错误信息；
- 可用时的 `traceId`。

诊断不记录请求参数、App Secret、Access Token、响应正文或完整 URL。错误信息还会移除 URL、常见凭证赋值和长 token 形态。记录位于 `chrome.storage.session`：service worker 被 Chrome 回收后仍可恢复，浏览器会话结束后不作为长期日志保留。

导出的 JSON 使用 OpenAPI 中的 `DiagnosticsSnapshot` 契约。它适合提交问题时附带，但不能替代真实账号 smoke test，也不证明国际站服务端已接受请求。

## 构建体积预算

`pnpm build` 最后自动执行 `pnpm check:extension-bundle`，并检查：

- 后台入口不超过 1.8 MB；
- options/popup 页面入口 chunk 单个不超过 800 KB；
- options HTML 直接引用的 JavaScript 总量不超过 250 KB；
- 解压后的扩展总量不超过 3.2 MB，且不包含 source map；
- manifest 不重新引入 `cookies` 或必选 `<all_urls>`；
- 正式网关权限没有被误删。

各工作区页面使用异步组件独立拆包。AJV standalone validators 已拆成核心、商品、RFQ、交易、物流、洞察、图库和平台八个模块；Web 按领域加载，扩展页面把校验交给 service worker。WXT 仍会把后台依赖合并为单一 service worker 文件，因此后台继续使用独立的 1.8 MB 预算约束。

## 发布前检查

所有命令在 Windows Node/pnpm 环境执行：

```bash
pnpm check
pnpm test:e2e
pnpm zip:extension
```

无账号自动化覆盖权限清单、凭证密文、service worker 重启后自动锁定、口令轮换、旧设置迁移、会话诊断、诊断导出/清空、写能力门禁和完整 Web Mock。发布真实写能力前，仍需逐方法完成账号权限、签名、限流、错误映射与回滚 smoke test。
