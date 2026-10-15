# 2.16.0 发布准备

记录日期：2026-10-15。候选范围为模板变量、顺序组合、携图 ZIP/S3 交换，以及独立 TOP/IOP 配置提示。发布准备不代表已经合入 master、创建正式 Tag、部署网站或提交 Chrome 商店。

## 范围与兼容

- 七个 workspace 包与商店材料使用 2.16.0；不复用或替换已经发布的 2.15.1 资产。
- 文本变量不执行代码、不自动代填商家身份；最多组合十个模板，插入后才成为商品编辑数据，不自动发布或更新。
- JSON 模式继续兼容。携图 ZIP 使用 `assets` 内容哈希路径；S3 逐对象写入并精确回读，清单最后写入。原 URL/fileId、图片账号属性和凭据不进入包。
- 图片导入复用持久传输回执：默认保存前核对返回 fileId 及目标分组；显式同意复用已有图片时核对实际分组和文件哈希，不自动移动。结果不明仅核对，不自动重传。ZIP 50 MiB、解压 100 MiB、500 个素材、S3 单对象 5 MiB 限制不变。
- “配置 TOP / IOP”的消息只说明选择编辑对象，不代表已保存或已验证；取消离开确认或读取失败时不显示成功切换。
- 本地重新授权工具明确保存协议。历史未标记包仍按 TOP 处理；显式协议冲突在出网前拒绝，不根据 AppKey 猜测。
- TOP 默认及两份独立配置保持兼容，没有新增永久扩展权限、Alibaba 方法或真实写白名单。

## 真实只读核对

本轮新 TOP 授权已完成 Callback/state 校验、原子保存和本地加密导入，工作台商品列表连接测试通过。TOP 实际响应未返回有效期，不补造倒计时。

已有 IOP 续期包仍有效：以此前 `/auth/token/refresh` 成功回执核对协议及完整包，不按 AppKey 推断；复用后商品、分组、图片、库存、Schema、评分、订单与物流只读检查通过，并导入本地独立 IOP 档案。该包记录 Access Token 到期时间为 `2027-01-07T03:14:50.995Z`，不代表所有商家的通用授权时长。本轮未再次接受授权协议、刷新 Token、修改商品或自动恢复写任务。

TOP/IOP 两份授权的两个商品样本匹配，但这不是平台身份认证。隔离的双协议选路验收发送四个只读请求：商品走 IOP、全部图片走 TOP、图片分组及指定分组图片走 IOP，均通过。验证不改变当前工作台的同商家确认状态，默认仍为 TOP。

扩展 IOP 检查中的商品 ID 加密接口返回平台 `InternalError`；保留失败回执，不把该项称为通过，也不全局删除接口或悄悄换协议重试。此问题与商品/图片基本连接是否有效分开记录。

敏感授权包、原始商品内容和浏览器 Profile 只在本机忽略目录；发布包、公开日志及截图不包含这些数据。

## 发布门禁

完整 Windows 检查和固定构建回归已通过。首轮 Redocly 进程非零退出，尽管报告为零错误/警告，仍按失败阻断；保留初始日志，补充安全退出码诊断后重跑，不增加自动重试或忽略错误。

第二轮发现新增版本历史使 Web i18n 分块达到 500,441 字节，超过原有 500,000 字节门槛。将完整版本历史独立为懒加载页面使用的分块后降到 447,716 字节；没有删除历史记录、缩减双语内容或放宽预算。修复后的完整检查成功，之前的失败日志保留。

| 检查                     | 结果                                                                                   | 忽略目录中的本机日志                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 完整 `pnpm check`        | 修复后 313 个文件 / 2,516 项单测；格式、类型、i18n、契约及生成漂移、三端构建和合规通过 | `artifacts/template-dedup-full-check-accepted.log`                                    |
| 隔离 Worker / D1         | 修复后 9 个文件 / 24 项                                                                | `artifacts/template-dedup-worker.log`                                                 |
| Web / 正式 MV3 E2E       | 修复后 108 / 108                                                                       | `artifacts/template-dedup-web-mv3.log`                                                |
| 静态授权与 TOP / IOP MV3 | 修复后固定构建 9 / 9                                                                   | `artifacts/template-dedup-authorization-fixed.log`                                    |
| Node 凭据与双语交互      | 修复后 4 / 4                                                                           | `artifacts/template-dedup-node-credentials-fixed.log`                                 |
| BFF / D1 回放            | 修复后 2 / 2                                                                           | `artifacts/template-dedup-bff-replay.log`                                             |
| 2.15.1 → 2.16.0 升级     | 修复后 20 项；另补 2.5.0/2.6.0 共 37 项                                                | `artifacts/template-dedup-upgrade-2.15.1.log`、`artifacts/template-dedup-upgrade.log` |
| Cloudflare 生产模式构建  | 类型、隔离测试、同源 Web 及 Worker 干跑通过；不含 localhost API 地址，未部署           | `artifacts/release-2.16.0-cloudflare-build.log`                                       |

Lint 为 0 error，保留 30 项既有 warning；未提高测试超时或放宽权限、包体门禁。中英文配置选择提示已在 Node E2E 中覆盖，不会因选择授权而保存、测试或刷新凭据。

携图修复补验时，首次授权回归与构建同时运行，遇到构建文件被替换的 `ENOENT`；设置页首次回归亦遇到按钮被卸载后超时。保留两份失败日志，完成构建后对固定产物重新运行，两套回归分别 9/9、4/4 通过，没有忽略错误或提高超时。

携图修复后的固定构建候选 `artifacts/one-vegetable-v2.16.0-chrome-mv3.zip`：213 个文件，ZIP 1,232,971 字节，解包 4,234,511 字节，分别低于 2,000,000 / 5,470,000 字节门槛。SHA-256：`6aeea330006e9c92a499dcb56853e634e0e74fbadfb47e6db67620951cf21056`。先前候选包的旧哈希不适用于此修复包。

包内容与经过测试的固定构建逐文件一致，权限及外部连接声明与正式 2.15.1 相同；没有环境文件、授权包、浏览器 Profile 或 Mock 文件目录。扫描本机当前两份 AppKey/AppSecret/Token、网站测试账密及环境敏感值，没有发现混入。审计回执为 `artifacts/release-2.16.0-package-audit.json`。候选包不等于正式 GitHub Release 资产；正式发布后仍需下载不可变资产，独立核对其 SHA-256、manifest 和权限。

模板变量及图片迁移已有离线 Web/MV3、隔离 Worker 与契约测试；不能用真实授权只读、此前 JSON-only S3 验收或 Mock 回读代替真实携图验收。

## 2026-10-15 受控携图验收补充

用户已批准少量真实图片/模板/S3 验收，以及通过后推进主线和 GitHub Release。测试使用独立 SQLite、浏览器上下文和 RustFS `dev` 下的 2.16.0 唯一前缀，不更换现有工作台凭据，不修改商品、桶权限或删除远端数据。

- **通过：真实 ZIP 导出。** 从测试账号读取一张现有图片，在实际模板页面导出 ZIP；校验图片字节、内容哈希和相对路径，包中不保留原图片 URL/fileId。
- **通过：RustFS 携图备份与读取。** 实际页面将一张图片及清单写入独立前缀，逐对象 GET 确认，清单最后写入；共享 S3 读取器再次校验图片 SHA-256 和模板内容。该次测试没有 Alibaba 写请求。
- **原始失败保留：Alibaba 携图导入。** 初次独立测试分组仅发送一次图片上传；BFF 记录成功响应，但随后公开 API 和官网均显示目标分组为空。持久任务未通过目标分组/fileId 核对，因此模板没有被保存为迁移成功，也没有自动重复上传、移动或删除图片。当时尚不能确认根因；该失败记录不改写为通过。
- 分页读取已确认不同页面确实返回不同素材；没有通过扫描整店或仅凭同名素材来判定上传成功。官网显示该账号存在大量图片，不扩大扫描范围。
- 上传请求及失败阶段的脱敏记录保存在 `artifacts/template-materials-real/dcdecaf5-01cf-478a-9717-79834508dcae/report.json`；独立 S3 成功记录为同目录下 `ae7929c2-d2d8-44f7-989d-e11365de3fbc/report.json`。这些目录均被 Git 忽略。
- 远端测试分组和两个 S3 备份对象保留；没有改商品、重新上传失败项或重放旧任务。S3 成功不代表整个 Alibaba 导入链路已通过。

### 去重根因与修复后验收

使用一张自行生成、无敏感内容的 PNG，先确认唯一图片上传和指定分组回读正常；再另行确认向第二个测试分组上传同一文件。Alibaba 两次返回同一个 fileId，第二个分组仍为空，图片保留在第一个分组。该受控对照确认平台内容去重及原分组保留行为，不是仅凭同名或查询延迟推测。测试没有移动素材，也没有调用官网私有接口。

初次失败现场未保存上传 fileId，不能据新对照替它补造确认回执；原任务保持未确认，不重新发送其图片。后续验收在收到响应时立即保留 fileId，核对失败也不会丢失该回执。

默认校验仍严格：分组不符就停止并明确说明原因。新增默认关闭的“复用已存在图片（保留原分组）”；同意后在有界第一页中匹配返回的确切 fileId，核对字节数和 SHA-256，再记录实际分组。未找到、哈希不符、配置变化或权限拒绝仍然阻断，不扫描整店或猜测成功。插件在最终确认手势中申请精确图片域名权限，拒绝就不发起本次写入，没有新增永久 Manifest 权限。

修复后的真实 Web/Node BFF 验收通过七项检查：ZIP 导出及脱敏、默认严格拒绝、开启复用后的同任务只读核对、再次导入不重复上传、S3 图片与清单备份回读，以及从 S3 导入保存模板。ZIP 流程第二次确认只核对原回执，没有第二次上传；S3 导入为单独确认的传输任务。总计两次图片上传请求、零次分组创建、零次商品/库存修改及远端删除。测试图片、分组和 S3 对象均保留。

成功回执保存在 `artifacts/template-materials-real/3db3a5ce-58c6-4710-ae08-3ecf6f0e17de/`，包含 `report.json`、逐次脱敏上传回执和关键截图。独立对照实验、失败回执及授权包均保留在本机忽略目录，不进入仓库或发布包。

正式独立 MV3 的真实 ZIP 携图导入补验已通过三项检查：最终确认中的精确图片域名权限检查、真实上传后的确切 fileId/实际分组/SHA-256 回读；同包再次导入复用同一任务和 requestId；停止 service worker 并刷新后模板与回执仍保留。总计仅一次图片上传请求，第二次导入只核对、不重传，没有商品修改、分组移动或远端删除。该项使用独立 Profile，不改变用户当前插件或工作台配置；它不等于插件 S3 携图流程也已单独真实验收。

本次成功报告、脱敏回执和截图在 `artifacts/template-materials-extension-real/64fe4c40-c89d-46d9-aa9e-c8d34a2aa80c/`。此前权限等待超时的记录保留在同级 `e822af08-f7b5-448e-8cd4-7a73cc49b875/`，该次没有任务或上传回执，不补造为成功。成功验收使用同一固定构建，未改源码或重新打包，候选 ZIP 哈希不变。

**发布决策：** 用户已明确选择“暂停正式发布，先处理携图导入”。修复及验收不会自动撤销该决定；本轮仅提交、推送开发分支和准备候选包，不合并主线、不创建正式 Tag/Release、不部署或提交商店。

### Live acceptance summary

A controlled original-image test confirmed that Alibaba deduplicates identical uploads, returning the existing file ID without moving its gallery group. Strict verification remains the default. Explicit reuse verifies the exact ID and image hash, records the actual group and reconciles the same durable receipt without another upload. Real Web/Node ZIP and image-inclusive RustFS import/export passed. The formal standalone MV3 ZIP import also passed exact-host permission checks, hash readback, repeat-import receipt reuse and worker restart; this does not claim a separate real extension S3 image-inclusive acceptance. Original failures remain recorded. Formal publication is still paused at the user's request. No product/inventory mutation or remote deletion was performed.

## 发布操作边界

候选代码与检查说明推送后，须等待同一候选的远端 CI 成功；以当前提交的 Actions 结果为准，不以旧提交通过替代。主线合并、不可变 Tag/GitHub Release、现有网站部署及商店提交分别确认；不移动旧 Tag，不覆盖旧 Release，不自动提交商店。
