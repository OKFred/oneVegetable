# 授权组合回归验收（2026-10-26）

基线 2.18.1，分支 codex/authorization-mode-regression。远程 Windows 开发和验收，未改日常授权、默认协议或业务数据。

## 实际检查

Node BFF 使用内存 SQLite、真实会话和实际路由；正式 MV3 使用独立加密 Profile。候选副本移除 Refresh Token，网络层只允许固定公开只读方法；无业务写入、跨协议失败重试或 Mock 回退。

每个运行时共 138 项检查、418 次平台读取，最终网络越界数为 0。包括商品、Schema、类目/分组、评分、库存、图片、视频、橱窗、销售/采购订单、RFQ、物流模板、洞察和五项原生 IOP 查询。写操作仅做现有隔离测试。

正式插件还实际打开每种配置的 14 个工作台菜单，共 56 次页面检查：均加载到对应工作区、没有未捕获脚本错误，原授权及默认配置不变。只读 RPC 由页面实际触发，不把首次引导页面当作菜单验收；IOP 视频失败及图片范围保护仍单独记录。

## 修复

- 上下文接口保留稳定 GatewayException 错误码，不再统一变成 GALLERY_CONTEXT_UNAVAILABLE，不回显内部消息。仅 TOP 访问 IOP 原生能力准确提示 ALIBABA_IOP_AUTHORIZATION_REQUIRED，且不出网。
- 树读取失败时停止新子项、等待已发出请求结束，防止迟到请求。商品分组子项并发限制为 4。
- 补上下文端点、树生命周期和独立只读网络门回归；修正参考验收脚本的泛型收窄。

## 初轮 Node / MV3 相同的结果（修复前）

| 模式             | 通过 | 合法空 | 权限不足 | 协议限制 | 范围保护 | 平台失败 |
| ---------------- | ---: | -----: | -------: | -------: | -------: | -------: |
| TOP              |   19 |      5 |        4 |        5 |        0 |        2 |
| IOP              |   21 |      1 |        0 |        9 |        1 |        1 |
| 双授权，TOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |
| 双授权，IOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |

IOP 视频未得到合法结果，两个关联检查不计为通过，因此该组共 33 项，其余组各 35 项。

权限不足按用户要求保留：RFQ 搜索/推荐/权益、供应商排名返回 isv.permission-api-package-limit。

初轮未通过项，不伪装成功：

- TOP 产品分：15 / -1。后续确认是本项目错误地发送明文 ID，而非已证实的平台故障；修复及重新验收见下。
- TOP 供应商列表：15 / isp.top-remote-connection-error，远程服务不存在。
- IOP 视频：10000002，illegal param error；按公开文档核对分页参数，并独立测试 page_size=10，仍被拒绝。TOP、双授权视频正常。

保留 IOP 图片跨分组保护 ALIBABA_IOP_PHOTO_SCOPE_MISMATCH。双授权图片使用 TOP，不修改图片分组 ID，不套用商品加解密。

## 后续整改与定点真实回归

- 官方 TOP [产品分文档](https://developer.alibaba.com/docs/api.htm?apiId=47461)要求混淆商品 ID。工作台先精确查询同一商品的列表摘要，取得接口返回的混淆 ID，再调用评分接口；不猜测加解密。IOP 仍直接使用明文 ID，只读调用不增加查询。
- 两个真实 TOP 样本使用正确标识后取得 3.9、4.6。随后 Node BFF、正式 MV3 均对 TOP 单授权、IOP 单授权及两种默认双授权完成精确商品查询和产品分检查，八组运行全部通过；TOP 评分最多两次只读请求，IOP 及双授权为一次。
- 通用调试器继续遵循 TOP 原始评分参数语义；双授权时不凭数字外观把混淆 ID 当作 IOP 明文 ID。工作台专用操作保持独立、明确的参数转换。
- 评分缺失、非法或负数不再伪造 0 分；显式返回的 0 分仍有效。精确查询无法取得匹配标识时停止评分，显示可翻译的稳定错误码。
- 供应商接口仍在公开 ICBU 目录中，未找到公开替代方法；目前仅证实本账号调用出现上游远程服务解析错误，不推断接口全局停用。缺少成功依据、缺失总数不再视为空列表，查询中或失败显示“数量未知”，明确成功且总数为零才显示 0。
- IOP 视频分别核对官方分页名称、POST 表单、JSON POST、GET，以及从 TOP 返回的真实视频 ID，均收到 10000002。外层 code=0、内层 result.msg_code 拒绝准确归为业务拒绝并保留 traceId，不能将 HTTP/外层成功冒充视频成功；没有证据支持改用私有参数或扩大 ID 转换。

定点回执为 bff-score-fixed.json、mv3-score-fixed.json；视频对照和 supplier UI 后续回执保存在同一忽略目录。初轮完整矩阵与后续定点回归分别记录，不能把旧矩阵计数改写为全功能新一轮通过。

正式插件补做采购供应商页检查：四种配置各 14 个菜单全部进入工作区、只读 RPC 完成、未捕获脚本错误为 0，配置保持不变。查询失败或协议不支持时均显示“数量未知”，未显示虚假 0。回执分为 mv3-menus-supplier-followup.json（TOP/IOP 单授权）和 mv3-dual-menus-followup.json（两种双授权默认）。

首次整轮在双授权导航时出现一次 TimeoutError，该中断未计为通过；脚本改为等待 DOM 就绪，并增加脱敏页面/阶段诊断后重新完成双授权检查，不增加自动平台重试，也不改变产品加载代码。因为回执仍含真实上游失败，脚本退出码保持 1，不能把“菜单检查完成”解释为“所有接口成功”。

后续远程门禁：367 个测试文件、3659 项单测通过；全工作区类型检查、26 项 Worker 隔离回放、OpenAPI 生成漂移、i18n、格式和改动文件 Lint 通过；Web/正式 MV3 构建及 API dry-run 通过。插件解包 4,580,360 字节，预算及商店合规检查通过，未扩大权限或包体限制。

## 后续排障前置核对

供应商资格元数据只涉及 TOP 官方目录；IOP 没有已确认的替代方法，本地文档采集和能力展示不依赖任何 Alibaba 授权。此次仅补齐 applyScopes 中的权限组名称，经既有 CapabilityDefinition.permissionGroups 展示，不新增平台方法、请求、写权限或离线资格判定。文档前置条件不等于当前账号已经获授，历史目录 active 回退也不等于服务真实可用。

2026-10-26 [官方文档元数据](https://developer.alibaba.com/handler/document/getDocument.json?docType=2&docId=40747&isEn=false)将 supplier.list 关联到国际站企业集成基础权限包（15249）；已有授权包的 permissions 为空，只代表未采集到资格，不能据此确认缺权限。

- 视频新增两次 SDK Query/Form 拆分对照（分别保留及省略 simplify），仍均被业务层以 10000002 拒绝。第一次诊断因工作台只接受 20/50 分页而在本地阻止，出网数为 0，没有算作平台证据；随后用公开原生请求验证文档示例的 1/10 分页。
- 对[官方文档所链接的 Java SDK](https://icbu-open-platform-public.oss-us-east-1.aliyuncs.com/sdk/1.0.4-1690374097817bk5i.jar)只做 ZIP/字节码静态检查，没有运行下载代码或其日志实现：默认 execute 选择 GOP，时间戳以毫秒传递，默认 partner_id 为 iop-sdk-java-20181207。按这些默认公共参数再做一次视频只读对照，仍返回 10000002。不因 SDK 支持其他协议枚举就猜测改用 /rest/2.0。
- 供应商按官方 CURL 示例加入 partner_id=apidoc、去掉 simplify，并分别使用文档支持的 hmac-sha256 和 md5 做两次只读对照，均返回 15 / isp.top-remote-connection-error。MD5 仅为隔离诊断，不修改生产默认签名，不作为自动重试策略。
- 另做一次 current_page=0 的数字边界对照，仍返回 10000002；它不是文档示例的有效业务验收，不据此把生产分页改成从 0 开始。
- 本组共 6 次真实只读请求（4 视频、2 供应商），0 写入、0 Token 操作、0 配置替换；失败均保持失败。脱敏回执为 video-sdk-split-_.json、supplier-request-comparison-_.json，保存在 artifacts/authorization-mode-regression/。
- 提交 65805ce 的完整 CI 已通过；远程 Windows 补充 133 项 Web/MV3、47 项授权、2 项 BFF 回放及 17 项 Node 凭据 E2E 均通过。功能失败与代码/交互门禁结果分别记录，不以 CI 通过代替业务验收。
- 权限组展示补充的 40 项定向测试和工作区类型检查通过；覆盖文档权限组提取、生成契约与 Web/插件能力详情展示，打开详情不会自动调用平台接口。

## 官网登录后的交叉核对

2026-10-26 使用远程已登录的官方应用中心核对：开发者审核通过，新版应用在线，ICBU-PRODUCT 和 ICBU-VIDEO 权限组均为 Active；当前 IOP 验收包的应用标识与官网一致。授权包未采集权限列表，不再据此推断未申请权限。此处只证明应用页面状态，不能代替 Token 范围或业务调用验收，也不能据新版应用推断旧 TOP 应用的供应商资格。

官方视频库有真实记录，选取现有样本进入原生预览，确认播放进度前进、时长为 30 秒；随后关闭预览，不上传、不修改关联。官网可读、可播与公开 IOP 查询可用是两个独立结论。

在 Node BFF 和重新构建的正式 MV3 中分别复查视频与供应商，两个运行时结果一致：

| 授权组合         | 视频                  | 供应商                                          |
| ---------------- | --------------------- | ----------------------------------------------- |
| 仅 TOP           | TOP 返回 20 条        | TOP 上游报 15 / isp.top-remote-connection-error |
| 仅 IOP           | IOP 业务拒绝 10000002 | 无公开适配，出网前拒绝                          |
| 双授权、TOP 默认 | TOP 返回 20 条        | TOP 上游报 15 / isp.top-remote-connection-error |
| 双授权、IOP 默认 | TOP 返回 20 条        | TOP 上游报 15 / isp.top-remote-connection-error |

两端合计 14 次真实只读请求，0 写入、0 Token 操作、0 越界出网；验收副本的授权配置和默认协议保持不变，失败后没有跨协议重试。两个脚本均因真实业务失败保持退出码 1，不能记为整轮通过。脱敏回执为 bff-after-official-permission-_.json 和 mv3-after-official-permission-_.json，位于远程忽略目录 artifacts/authorization-mode-regression/。

提交 407e16e 的 CI、368 个文件的 3676 项单测均通过。此次正式插件重新构建、包体及商店合规检查通过，解包 4,580,529 字节。未修改源码选路来掩盖上游失败；图片跨分组保护继续保留，本次未重新调用图片接口，不将历史图片结论记为新一轮通过。开发分支保留，不合并、部署或发布。

## 单授权可用性提示与导入前置检查

本轮为共享 Web/BFF/MV3 界面收口，不新增平台方法、授权或真实写能力。按实际上下文使用已有可用性查询，不根据默认协议或历史账号结果猜测当前选路。

| 子能力                        | TOP                         | IOP                                  | 本轮边界                                                                                       |
| ----------------------------- | --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 图片选择、图片列表            | alibaba.icbu.photobank.list | /icbu/product/photobank/list         | 保留分组要求及跨组保护；失败提供配置与官网入口，不将异常页当空结果                             |
| 图片 ZIP/S3、模板携图导入     | 上传、目录及图片列表回读    | 公开上传已适配，分组列表范围尚未核实 | 预览和下一次写入前检查绑定上下文的 photo-group-scope-unverified 约束；不能在最后才暴露回读限制 |
| 视频列表及选择器              | alibaba.icbu.video.query    | /alibaba/icbu/video/query            | IOP 业务拒绝提供具体引导，不宣称缺权限，不在失败后切协议重试                                   |
| 纯模板 JSON、已有图片文件下载 | 本机或已确认来源            | 本机或已确认来源                     | 不因缺少 TOP 误拦截，不额外发出 Alibaba 请求                                                   |

这些界面提示不能证明平台接口已修复；原有供应商上游异常及 IOP 图片、视频未通过项继续保留。权限不足、授权失效、未知可用性与分组回读未核实分别处理，历史待核对任务仍可只读查看。

### 本轮验证记录

- 打开图片导入时先读取绑定 listPhotos 上下文的可用性；模板携图导入同样核对上传及回读两项依赖。界面只提供授权设置和官方入口，不自动切换协议或重放请求。视频选择器与视频列表统一：IOP 标题仅筛选当前页，不再把未支持的标题参数发送给平台。
- 导入预览、准备和真正发送前均检查回读约束；旧任务在未发出下一次写入时明确记为失败，未知和已受理任务仍只读核对。纯模板 JSON、导出和独立图片上传不受此导入约束误伤。
- 151 项界面与执行器定向测试通过；134 项 Web/正式 MV3 E2E 通过，最后对任务错误文案补充 5 项相关 E2E 回归通过。Web/正式插件构建、i18n、契约生成检查及包体/商店合规通过，最终解包 4,590,136 字节；没有新增权限或依赖。
- Node BFF 四种授权组合定点共 12 次真实只读请求：TOP 和双授权的视频正常，选定图片组为合法空组；仅 IOP 的图片仍触发范围保护、视频仍被业务拒绝。这些失败没有改记为通过。
- 正式 MV3 四种配置分别打开 14 个菜单；8 项导入/视频引导检查均符合预期，未捕获脚本错误为 0。只打开导入预览，不选择文件、不确认上传；授权配置和默认协议均保持不变。供应商和 IOP 视频真实失败继续保留，脚本退出码仍为 1。
- 初轮 dual-top 总览出现一次 READ_GUARD_DENIED，原回执未保存具体拦截明细，不推测为已证实的选路或平台故障，也不把该项记为通过。随后增加只记录方法/原因的 wireDenials；重复请求及请求数量上限仍严格拒绝，未知方法脱敏，不增加重试。独立复查该配置 14 个菜单及 2 项引导均完成，未再出现保护拦截，但不能倒推初轮失败已获解释。
- 回执为远程忽略目录中的 bff-media-guidance-_.json、mv3-media-guidance-menus-_.json 和 mv3-media-guidance-dual-top-diagnostics-*.json。两轮菜单检查与单项复查分别保留，不合并成“所有接口成功”；没有真实写入、Token 操作或现有配置替换。

## 重跑

输入、输出均必须位于远程忽略目录。以下占位符换成实际值：

```powershell
pnpm exec tsx scripts/smoke-authorization-modes-real.ts --top=artifacts/local-dual-authorization/top-credentials.json --iop=artifacts/local-dual-authorization/iop-credentials.json --product-id=<ID> "--prediction-title=<unbranded description>" --output=artifacts/authorization-mode-regression/<new-receipt>.json --confirm-read-only --confirm-same-merchant
```

正式插件使用 smoke-authorization-modes-extension-real.ts，同参数。加 --ui-only 逐菜单检查；仅副本预授权网关域名，不改生产 Manifest，不宣称覆盖原生权限弹窗。

可用 "--modes=top-only,iop-only"、"--probes=products-exact,product-score,videos,suppliers" 明确复查；PowerShell 含逗号参数须加引号。失败仍返回非零退出码，不通过更换分类隐藏问题。

```powershell
pnpm exec tsc --noEmit -p scripts/test/tsconfig.authorization-mode-regression.json
pnpm exec vitest run scripts/authorization-mode-regression.test.ts packages/core/test/product-tree-read-lifecycle.test.ts apps/api/test/dual-authorization.test.ts
```

回执在远程 artifacts/authorization-mode-regression/，不提交 Git。无密钥或完整业务响应，只有检查状态、requestId、方法/协议、计数和脱敏错误。测试 Profile 不管理用户日常浏览器页面。
