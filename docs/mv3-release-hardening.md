# MV3 发布与可观测性加固

## 权限边界

生产 manifest 的默认权限保持为：

- `storage`：凭证写入 `chrome.storage.local`，诊断写入 `chrome.storage.session`。
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
- options HTML 直接引用的 JavaScript 总量不超过 1.9 MB；
- manifest 不重新引入 `cookies` 或必选 `<all_urls>`；
- 正式网关权限没有被误删。

各工作区页面使用异步组件独立拆包。目前 AJV standalone validators 仍形成约 1.5 MB 的共享生成 chunk，后台也需要整套能力校验器；当前预算会阻止继续膨胀，但后续仍可按领域拆分 validator 注册表进一步降低首载与后台体积。

## 发布前检查

所有命令在 Windows Node/pnpm 环境执行：

```bash
pnpm check
pnpm test:e2e
pnpm zip:extension
```

无账号自动化覆盖权限清单、service worker 重启后的会话诊断、诊断导出/清空、写能力门禁和完整 Web Mock。发布真实写能力前，仍需逐方法完成账号权限、签名、限流、错误映射与回滚 smoke test。
