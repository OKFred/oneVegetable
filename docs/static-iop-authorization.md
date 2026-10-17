# 静态 Pages + Chrome 插件授权

公共站点只提供指引与回调，不需要 Worker、数据库、账号登录或服务端 Secret。商家使用自己的新版 IOP 应用，在插件内授权、续期和导出 `credentialInfo.json`。

## 插件内一键读取（无需本机 Node 服务）

### 给首次使用者

1. 在设置点击“连接 Alibaba 账号”。首次先准备可选的本机保护口令（可留空），已解锁时不再重复询问。接着选择“导入已有授权文件”或“在线获取新授权”，不会默认打开线上流程。
   - 已有文件：选择完整授权 JSON，预览文件名、应用名及自动识别的 TOP/IOP；点击“导入并保存”才替换对应档案，另一份保持不变。无需打开平台；确认导入 IOP 时仅申请新版业务网关 openapi-api.alibaba.com 的访问权限，拒绝时不保存，保留文件预览以便重试。文件格式通过不等于平台权限或有效期通过，首次只读调用仍可能要求重新授权。文件限 256 KiB，历史未声明 protocol 的文件按 TOP 处理。到此已完成，不必执行下面的在线获取步骤。
   - 在线获取：首次优先选“连接新版应用”；以前使用旧应用的用户选“连接已有旧版应用”。两者不混用，不需要一开始就配齐两份。
2. 点击“前往 Alibaba 连接”，按官网提示登录或完成验证。应用资料会尝试自动读取；需要手动填写时再展开表单。不要把 Alibaba 登录密码填作本机保护口令。
3. 在 Alibaba 页面自行核对账号、权限并确认授权，保持工具页打开。
4. 工具显示“授权文件已安全保存”后，点击“下载授权文件”，返回工作台设置导入并保存。**下载成功不代表工作台配置已经改变。** 导出的文件包含明文密钥，不要发到群聊或公开仓库。

工具只突出当前步骤：未连接时连接、锁定时解锁、等待时提示官网确认、成功时下载并引导导入。手动填写与文件导入保留显式入口；协议切换、详情管理及 JSON 编辑默认折叠。续期是一次尝试，不保证平台允许；失败不反复重试，可使用原应用重新授权。读取本机状态失败时可点“重新检查”。

Choose **Connect Alibaba account**, select a new or existing legacy app, then follow the next action shown. Sign in and approve on Alibaba itself. Once the file is saved, download it and import it into the matching workbench profile. Downloading does not apply the connection. Manual entry and file import remain available; technical details and JSON editing are collapsed. Renewal is only an attempt, never a guarantee or an automatic retry.

**Existing file:** after optional local protection, choose **Import an existing authorization file**. Preview the detected TOP/IOP profile, then **Import and save**. Only that profile is replaced; no provider page or token exchange is opened. IOP confirmation requests only openapi-api.alibaba.com access; denial preserves the old profile and allows retry. Legacy files without a protocol remain TOP. Local validation cannot prove provider permissions or token validity. The online instructions above apply only when explicitly choosing **Get a new authorization online**.

### 自动读取与安全边界

- 选择新版 IOP 或旧版 TOP 后，允许访问本次所需的精确 Alibaba 域名。IOP 工具会复用唯一的已打开应用中心，页面加载可用时立即展示向导，自动进入“应用中心”，读取当前应用的 App Name、AppKey、App Secret 和已登记 Callback，并填写到 `authorization.html`。多个应用中心标签页时不会猜选。
- 页面上会显示蓝色指针移动、目标高亮和实际点击。只允许点击“应用中心”和“View/查看密钥”；绝不点击 Reset、不更改 Callback，也不自动接受 OAuth 协议。减少动态效果偏好会省略指针移动。
- 首次使用可设置至少 6 个字符的本机保护口令，也可留空使用随机本机密钥；之后仍需显式选择在线获取，才会打开 Alibaba。此口令不是 Alibaba 网站密码。已解锁的独立授权包可以复用加密密钥。已有锁定包可先解锁，再重新读取。
- 登录失效、验证码、密钥安全验证、缺少应用/Callback 或 30 秒内读取不完整时明确停止并提示检查；不绕过验证、不打开失效的旧 TOP 地址。只读取当前选中的新版应用；需要其他应用请先在平台切换。
- Alibaba 授权协议仍由用户确认。已登记的 Callback 不需要改成 example.com，也不依赖临时 localhost 授权服务。普通 HTTPS Callback 的同一授权标签页由插件监听；公共 Pages 只是可选的静态回调辅助。
- TOP 与 IOP 在同一个工具分别保存。TOP 尝试从仍可用、已打开的旧应用页读取；没有可用页面、旧入口 404、多个应用或 Callback 缺失时明确提示，不反复打开失效入口。也可手工填写旧应用，或导入原 TOP JSON 后解锁并点击“重新授权”。不会把新版应用的 Key 发送到 TOP。
- 高级模式支持粘贴完整授权 JSON，两类协议各有格式示例，默认选中示例便于替换，并提供本地语法高亮。占位值、协议不符、字段不完整或超过 64 KiB 时不导入；确认后才加密保存，成功后清空粘贴内容。不读取剪贴板、不持久保存编辑文本、不执行 JSON 中的代码。
- 进度和错误通过临时通知展示，4 秒/6 秒自动消失，同一后台错误不因轮询重复弹出。Alibaba 侧向导限制在视口内，内容内部滚动；它的阶段状态不包含密钥。
- 导出文件始终为 `credentialInfo.json`，包含明文密钥。请返回设置，选择匹配的 TOP/IOP 档案导入。两份工作台配置齐全后默认按能力路由；系统不验证两份授权是否属于同一商家，用户须自行核实。
- App Secret、Token、口令及 OAuth code 不写入诊断、控制台或引导截图。完整包仅按用户选择加密保存到受信扩展存储，或明确导出到本机。

This extension-only flow needs no additional Node, Worker or Pages deployment. It reuses the current Alibaba tab, visually clicks only Application center and View, and reads the current app into the local tool. Optionally set a local protection passphrase before choosing TOP/IOP, then personally approve OAuth on Alibaba. Leave it blank for device protection; Settings reuses the same protection. Existing registered Callbacks are preserved. TOP and IOP remain separate; configure both for automatic capability routing, only when they belong to the same merchant. No automatic agreement acceptance, secret reset, credential logging or CAPTCHA bypass. Not affiliated with alibaba.com; read platform rules before use.

## 使用方式

1. 在 Alibaba 应用中心完成开发者注册，准备自己的 IOP 应用及所需权限。旧 TOP 与新版 IOP 不可混用。
2. 将 `https://one-vegetable-auth.pages.dev/callback` 登记到应用 Callback。必须先部署静态站点；这是预定正式域名，不表示已上线。已有 Callback 也可保留，在插件工具填写其精确地址。
3. 加载包含此功能的新版插件，在设置页点击“连接 Alibaba 账号”并选择新版应用，或从公共站点点击打开工具。旧商店版没有此功能时会提示更新，不尝试读取旧插件凭据。
4. 工具尝试自动读取应用信息；需要手动处理时，点击“手动填写”，**仅在 `chrome-extension://…/authorization.html` 中**填写应用信息与本机口令。公共网页不接收这些数据。
5. 允许所需精确域名权限，在 Alibaba 标签页亲自确认授权。注册、创建应用和接受平台协议均由商家完成；遇滑块等验证不绕过。
6. 插件绑定本次 state、已知标签页和精确 Callback，收到 code 后立即交换 Token。代码不写入存储；任务 10 分钟后过期。
7. 工具显示平台实际返回的 Access Token 到期及可续期截止时间；未返回时显示“平台未返回”，不猜固定授权天数。
8. 有可用续期凭据时，点击“尝试延长有效期”并确认后只发送一次请求，成功保存后再下载并导入新文件。失败不自动重试。文件包含明文密钥，只应在自己的服务中使用，不要公开、截图或提交 Git。

已有 Callback 无法自动接收时，可在工具页粘贴完整回调地址；仍检查原任务 state 和精确 origin/path，不修改应用 Callback，也不重用过去的授权码。

## 存储与协议边界

- `protocol: "iop"` 明确标识导出包。没有标识的历史包仍按 TOP 兼容，不能仅凭 AppKey 或 Token 推断 IOP。
- TOP/IOP 授权包分别加密保存在受信扩展本地存储，与工作台复用本机保护。先可选设置口令，再选择新版/旧版；留空使用随机本机密钥。解锁后保存本机恢复材料，浏览器重启无需重复输入。手动锁定仍需显式解锁；复制完整浏览器配置可能读取凭据。旧独立保险库不被覆盖，原口令保持兼容。
- 工作台新增双协议兼容：历史包及未指定协议的设置仍使用 TOP；新版 IOP 包可以显式导入，但不会自动替换旧用户配置。两种应用的 AppKey、Secret、Token 不可混用。当前 IOP 仅开放已适配的商品、分组、Schema 渲染和指定图片分组查询；其他能力及真实写入明确禁用，详见 [双协议兼容](alibaba-gateway-protocols.md)。
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

本轮结果：291 个测试文件、1,971 项单测通过；授权离线 E2E、正式 MV3 回归和 Worker 隔离回放通过。正式插件的独立候选 IOP 包完成一次真实续期、导出及新 Token 商品列表只读查询，未替换原 TOP 工作台配置。候选 ZIP 为 1,186,186 字节，解包为 4,088,053 字节，均通过原有包体和商店合规门禁。公共 Pages 尚未部署，公共 Callback 首次真实授权仍待验收；代码通过不代表商店已经发布。

## English quick guide

This is a static callback and an independent extension tool, not a server-side credential service. Prepare your own IOP application, register the exact callback, then enter its application details **inside the extension**, approve on Alibaba and export `credentialInfo.json`. Renew in the same tool. Expiry dates come from actual platform responses; missing values remain unknown.

The file contains plaintext secrets. Keep it private. IOP and legacy TOP are separate protocols. Existing settings and unmarked historical bundles still default to TOP. Explicit IOP imports enable only supported read operations; unmapped operations and unverified writes remain unavailable, without falling back to TOP. An uncertain renewal is never resent automatically; reauthorize instead. A local-save retry does not call Alibaba again.

The static Pages deployment and Store rollout are separate from code verification. Production builds contain no simulation, website password collection, remote executable code or public credential-export API. Not affiliated with alibaba.com; read platform rules before use.
