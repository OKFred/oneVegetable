# 静态 Pages + Chrome 插件授权

公共站点只提供指引与回调，不需要 Worker、数据库、账号登录或服务端 Secret。商家使用自己的新版 IOP 应用，在插件内授权、续期和导出 `credentialInfo.json`。

## 使用方式

1. 在 Alibaba 应用中心完成开发者注册，准备自己的 IOP 应用及所需权限。旧 TOP 与新版 IOP 不可混用。
2. 将 `https://one-vegetable-auth.pages.dev/callback` 登记到应用 Callback。必须先部署静态站点；这是预定正式域名，不表示已上线。已有 Callback 也可保留，在插件工具填写其精确地址。
3. 加载包含此功能的新版插件，在设置页点击“新版 IOP 授权 / 续期工具”，或从公共站点点击打开工具。旧商店版没有此功能时会提示更新，不尝试读取旧插件凭据。
4. **在 `chrome-extension://…/authorization.html` 中**填写自己的 App Name、App Key、App Secret、已登记 Callback 和本机口令。网页不接收这些数据。
5. 允许所需精确域名权限，在 Alibaba 标签页亲自确认授权。注册、创建应用和接受平台协议均由商家完成；遇滑块等验证不绕过。
6. 插件绑定本次 state、已知标签页和精确 Callback，收到 code 后立即交换 Token。代码不写入存储；任务 10 分钟后过期。
7. 工具显示平台实际返回的 Access Token 到期及可续期截止时间；未返回时显示“平台未返回”，不猜固定授权天数。
8. 点击“授权续期”并确认后只发送一次请求，成功保存后再导出 JSON。文件包含明文密钥，只应在自己的服务中使用，不要公开、截图或提交 Git。

已有 Callback 无法自动接收时，可在工具页粘贴完整回调地址；仍检查原任务 state 和精确 origin/path，不修改应用 Callback，也不重用过去的授权码。

## 存储与协议边界

- `protocol: "iop"` 明确标识导出包。没有标识的历史包仍按 TOP 兼容，不能仅凭 AppKey 或 Token 推断 IOP。
- 独立 IOP 授权包使用 PBKDF2 + AES-256-GCM 保存在受信扩展本地存储；口令和解密密钥不持久化，后台重启后需要解锁该工具。它与工作台的 TOP 保险库无关。
- 本轮**只实现 IOP 授权工具**，不是 TOP 业务网关迁移。IOP 文件不能导入现有 TOP 商品工作台；服务端和设置页均明确拒绝，不能覆盖当前业务凭据。
- Token 续期可能轮换 Refresh Token，需同步替换其他使用该授权包的服务。后台不静默续期、重试或重放商品任务。
- 发出交换/续期前先保存脱敏执行意图。结果不明时禁止再次续期和导出旧包；重新授权。仅本机保存失败且新凭据仍在内存时，可“再次保存”，不会再调用平台。
- 清除本机授权包不等于撤销 Alibaba 平台授权。
- 本服务与 alibaba.com 无官方关联，使用前请阅读平台规则。

## 静态部署

Windows 环境：

```text
pnpm dev:auth
pnpm build:auth
pnpm check:auth-pages
pnpm exec wrangler pages project create one-vegetable-auth --cwd=apps/auth-pages --production-branch master
pnpm deploy:auth
```

配置为 `apps/auth-pages/wrangler.jsonc`，在该独立目录运行 Wrangler，输出 `apps/auth-pages/dist`；无 Functions、Worker、绑定或 Secret。Pages 不支持自定义 `--config` 路径，不能引用仓库根目录的业务 Worker 配置。`_headers` 禁止网络 API、远程脚本、iframe 嵌入及 Referrer，并禁用缓存。Callback 使用 `/callback`，不使用会被 Pages 重定向的 `.html` 地址；`404.html` 禁止未知路径回退首页。

若该 Pages 项目名不可用，必须同时修改 core 中的公共 Origin、Manifest 的精确 `externally_connectable.matches`、安全检查和部署配置，再重新构建插件。不能将所有 `pages.dev` 或用户任意网页加入可信来源。自定义 Callback 可以监听或手工粘贴，但不能读取授权包。

公共回调请求中的 code/state 会经过静态托管设施，页面加载后立即清除 URL 查询，不使用分析脚本、不输出 code。不能承诺托管提供方完全不记录访问 URL。

## 验证

- `pnpm test:e2e:authorization`：隔离 Chromium，模拟数据位于 `mock/data/alibaba-auth`。使用一次性测试扩展副本预授精确权限、映射商店 ID，并将 OAuth 换成扩展内离线审批页、Token 请求换成隔离回放；正式包不含这些替换。Chrome 新建标签页的首次请求可能早于 Playwright 拦截，因此不依赖普通路由阻断来防止样本访问平台。
- 真实独立 IOP 续期：`pnpm exec tsx scripts/smoke-iop-extension-real.ts --credential=<本机忽略文件> --confirm-renewal`。脚本只续期一次，导出后查询一个商品摘要，不修改工作台或商品；真实回执、授权文件和 Profile 仅在忽略目录中。
- 仅当来源已证明为旧版诊断工具生成的 IOP 文件时，才额外使用 `--confirmed-legacy-iop-marker`；不能用于 TOP 包。
- 相同输入 Refresh Token 的脚本由本地独占回执阻止再次调用。出现未确认结果需人工核对，不删除回执后盲目重试。
- 自动权限预授测试不代表 Chrome 原生权限弹窗验收；公共站点上线、商家登记新 Callback、新版插件上架后的实际授权需单独验收。

本轮结果：全量单测 1,970 项通过；授权离线 E2E、正式 MV3 回归和 Worker 隔离回放通过。正式插件的独立候选 IOP 包完成一次真实续期、导出及新 Token 商品列表只读查询，未替换原 TOP 工作台配置。候选 ZIP 约 1.19 MB，解包约 4.09 MB，均通过原有包体和商店合规门禁。公共 Pages 尚未部署，公共 Callback 首次真实授权仍待验收；代码通过不代表商店已经发布。

## English quick guide

This is a static callback and an independent extension tool, not a server-side credential service. Prepare your own IOP application, register the exact callback, then enter its application details **inside the extension**, approve on Alibaba and export `credentialInfo.json`. Renew in the same tool. Expiry dates come from actual platform responses; missing values remain unknown.

The file contains plaintext secrets. Keep it private. IOP and legacy TOP are separate protocols: this iteration does not migrate the existing TOP business gateway, and importing IOP into that gateway is rejected. An uncertain renewal is never resent automatically; reauthorize instead. A local-save retry does not call Alibaba again.

The static Pages deployment and Store rollout are separate from code verification. Production builds contain no simulation, website password collection, remote executable code or public credential-export API. Not affiliated with alibaba.com; read platform rules before use.
