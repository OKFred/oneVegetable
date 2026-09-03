# Alibaba OpenAPI 本地授权

该工具只用于 Windows 本地开发，以有头 Chrome 引导开发者注册前置步骤，并在条件具备后获取已有 Alibaba.com OpenAPI 应用的授权包。它不会填写或提交企业资料、勾选协议、创建/删除应用、申请权限、下线或重置应用，也不会启用任何真实写能力。

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

## Chrome 插件授权向导

正式插件首次打开工作台时会展示带四张插图的“开发者注册 → 平台审核 → 创建应用 → OAuth 授权”引导。用户确认数据与权限边界后，点击“开始授权向导”会直接打开“获取开放平台凭证”，不需要先猜测入口位于设置页；选择“稍后，仅浏览”仍可在设置页重新打开。授权助手：

- 复用当前 Chrome 中的 Alibaba 登录态，不接收或保存网站账号密码；
- 按“开发者注册 → 平台审核 → 创建应用 → OAuth 授权”展示进度；
- 注册页面只检测稳定字段是否完成及页面状态，不读取、传输或保存公司名称、注册号、地址、文件名或证件内容；
- 审核中、被退回、无应用或应用未就绪会返回明确的 `prerequisite-required` 状态并停止轮询；
- 用户可在插件中“定位下一项”，也可在 Alibaba 页面右下角的 Shadow DOM 提示层中查看清单、重新检查并返回 oneVegetable；定位不会自动填写，向导不会提交表单或接受协议；
- 条件具备后只处理已有应用，不自动创建应用或申请 API 包；
- 多应用时只展示应用名称、状态和 AppKey 尾号，由用户选择；
- Callback 留空时保留现值，显式修改时先展示新旧地址并确认；
- 仅在用户继续操作时为应用中心、OAuth 和实际 Callback 域名请求精确站点权限；
- 滑块、验证码、MFA 和密钥查看确认由用户在打开的 Alibaba 标签页中完成；
- OAuth code 只在内存中完成 state 校验和 Token 交换，不写入存储或诊断；
- 完成后可直接加密保存到插件保险库，也可在确认明文风险后导出 `credentialInfo.json` 供自托管后端导入。

扩展后台被 Chrome 回收会清除正在进行的任务及明文内存，用户需重新启动向导。非敏感的当前前置阶段与最后检查时间保存在 `chrome.storage.local`，重新打开设置页仍可看到；完成授权或彻底清除本地数据时删除。任务最长保留 10 分钟。

## 开发者注册与应用前置状态

Alibaba 注册页面由用户本人完成。oneVegetable 只识别以下稳定状态：需要注册、审核中、审核退回、需要创建应用、应用未就绪。注册清单包括国家/地区、法定公司名称、企业注册号、注册地址、城市、省份、邮编、证明材料及三份平台协议；填写内容必须与证明材料一致。

审核中状态会立即停止自动轮询。当前 Alibaba 页面提示约需 2–5 个工作日，实际结果和时长以平台页面为准。审核通过但没有应用时，用户仍需自行完成应用基础信息、公共 HTTPS Callback、所需 API 权限及应用状态准备；插件不会创建应用、上传材料、勾选协议或提交任何注册/应用 mutation。

## Cloudflare 自托管一键连接

自托管站点的首位管理员完成初始化或首次登录后，会看到相同的图文四步引导；普通用户不会被要求配置管理员凭证。点击“开始授权向导”会直接打开“一键连接 Alibaba”，以后也可从管理员页面重新进入。该状态按浏览器与站点 Origin 本地保存，不包含账号或凭据。管理员可选择两条路径：

- “云端自动获取”使用绑定到当前 Worker 的 Cloudflare Browser Run；账号、密码只存在于当前 HTTPS 请求和临时浏览器内存，不写入 D1、日志、审计、截图或 Session Recording。
- “使用本机插件”直接打开正式扩展方案，不提交 Alibaba 网站密码，也不占用 Browser Run 额度。

云端流程同样先只读检查开发者与应用前置状态，不创建应用、不申请 API 权限、不填写开发者表单，也不代替用户接受协议。检测到注册、审核或应用前置状态后立即关闭 Browser Run 会话并返回稳定原因码，不再持续消耗额度；用户应转到本机 Alibaba 页面或插件处理。多个应用会停在选择步骤；Callback 留空时保留现值，显式填写时必须再次确认新旧地址。OAuth state 与实际 Callback 校验通过后，授权码立即交换 Token，完整凭据直接用现有 AES-256-GCM 保险库加密，页面只返回应用名称、AppKey 尾号、权限摘要和到期时间。

Browser Run 会被网站标记为自动化浏览器，免费套餐额度也有限。开发和 CI 只运行本地状态机、模拟数据、Windows 有头 Playwright 以及 `wrangler deploy --dry-run`；dry-run 不创建 Browser Run 会话，也不消耗浏览器分钟数。仅在发布候选完成后做一次受控云端验收。遇到滑块、CAPTCHA、MFA、密钥安全确认、机器人拒绝或额度不足时，Worker 立即结束临时任务并返回稳定原因码，界面引导改用本机插件，不尝试绕过验证。

云端任务最多保留 10 分钟，全局同时只允许一个活动任务，同一管理员 30 分钟最多启动 3 次。任务表只保存公开状态、浏览器会话 ID、已选应用标识和 Callback 地址；密码、AppSecret、OAuth code 和 Token 不进入任务表。

本地优先验证顺序：

1. 使用 `mock/data/alibaba-auth` 和单元测试覆盖单应用、多应用、Callback 确认与全部插件兜底原因。
2. 在 Windows 运行 `pnpm openapi:auth`，用 `.env` 验证已有应用和 OAuth。
3. 显式运行 `pnpm openapi:auth:free`，用 `.env.free` 验证无应用和人机挑战；该账号不会触发应用创建或权限申请。
4. 运行 Cloudflare 构建和 Wrangler dry-run，确认 Browser binding、Worker 包与路由。
5. 最后才在自托管 Worker 中做一次真实 Browser Run 验收。

截至 2026-09-04，脱敏页面样本、Windows 自动化测试和扩展构建已覆盖上述前置状态；当前测试账号在 Alibaba 页面显示 `Under Review`。这只能验证审核状态识别，不代表开发者审核、应用创建、OAuth 或 Cloud Browser Run 全链路已经通过。审核状态变化后先用本机插件或 `pnpm openapi:auth` 重新检查，最后再执行一次受控云端验收。

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
