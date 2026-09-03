# MV3 发布与可观测性加固

## 权限边界

生产 manifest 的默认权限保持为：

- `storage`：加密凭证保险库写入 `chrome.storage.local`，当前 Chrome 会话的派生解锁材料和诊断写入内存型 `chrome.storage.session`；两者均限制为 `TRUSTED_CONTEXTS`，内容脚本不能访问，保险库口令不保存。
- `scripting`：仅在用户主动启动“获取开放平台凭证”向导后，向本次已知 Alibaba 开发者注册、应用中心和 OAuth 标签页注入扩展包内固定代码；注册检测只返回状态和缺失字段 ID，不返回资料值，不执行远程代码或后台网页抓取。
- `https://eco.taobao.com/*`：国际站正式 HTTPS 网关。

扩展不再申请 `cookies` 或必选 `<all_urls>`。自定义网关和外部图片 URL 使用
`optional_host_permissions` 声明的 HTTP(S) 范围，并在用户启动授权向导、确认实际 OAuth Callback、保存网关或执行 URL 转存时按目标主机请求授权；拒绝授权不会继续请求。授权向导只处理用户选定的已知标签页，不申请 `tabs`、`webNavigation`、`cookies` 或浏览历史权限。

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
- 解压后的扩展总量不超过 3.25 MB，且不包含 source map；该预算包含商品写操作的构建期 AJV standalone validators。
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

无账号自动化覆盖权限清单、内容脚本存储隔离、凭证密文、会话解锁材料脱敏、空闲自动锁定策略、service worker 重启后恢复当前 Chrome 会话、主动锁定、口令轮换、旧设置迁移、会话诊断、诊断导出/清空、写能力门禁和完整 Web Mock。发布真实写能力前，仍需逐方法完成账号权限、签名、限流、错误映射与回滚 smoke test。
