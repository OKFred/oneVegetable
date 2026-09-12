# 2.6.0 发版验收与审核状态

状态更新（2026-09-12）：项目所有者已确认 **2.6.0 提交 Chrome Web Store 审核**，尚未确认审核通过或上架。2.5.0 仍为已确认上架的版本。仓库发布记录见 [v2.6.0](releases/v2.6.0.md)，商店状态来源为用户确认，不是自动化后台查询。

送审交接源码固定为 `adb1b1349f5dc3644423e57c9f41d8f1a21be007`，已合入 `staging`、`master`；运行内容基线为 `013db1c`，之后仅有测试时序修正和验收文档。主线 [CI 34670896436](https://github.com/OKFred/oneVegetable/actions/runs/34670896436) 全部通过，Windows 与 CI 生成的 ZIP SHA-256 一致。版本标签 `v2.6.0` 锁定送审交接提交，后续仅更新仓库审核记录，不修改送审包或移动标签。

**包内候选文案保持原样**：用户已提交审核后，不为更新版本历史文案重建一个内容不同的同版本包。最新审核状态以本文件和 GitHub Release 说明为准；包内文案留到下一版本调整。本次没有重新上传商店或代替提交审核；Worker 在用户单独确认后部署，见下节。

## 正式发布与 Cloudflare 部署（2026-09-12）

- 正式 [Release workflow 34691898453](https://github.com/OKFred/oneVegetable/actions/runs/34691898453) 全部通过，已生成 [GitHub Release v2.6.0](https://github.com/OKFred/oneVegetable/releases/tag/v2.6.0)。实际下载的 Release ZIP 与 Windows、主线 CI 及送审包 SHA-256 完全一致；仅更新 Release 说明，不替换附件或移动标签。
- 用户明确要求同步部署现有 [Cloudflare 网站](https://one-vegetable.this-time.workers.dev)。从干净的 `v2.6.0` 标签运行 `pnpm cloudflare:build`，完成契约、类型、Worker 测试、同源 Web 构建及 Worker dry-run；构建后 tracked 文件未改变。
- 部署前备份 D1 至本机忽略文件 `artifacts/release-2.6.0-d1-before.sql`（315,545 字节，SHA-256 `3f2e7fb451b4aa3f06994bbd6f0e98273d045423a168890785f3d96748ffbc4c`）。备份包含敏感数据库内容，不提交、不上传到 Release；原加密密钥保持不变。
- 应用 `0011_product_creation_mutation_jobs.sql`、`0012_s3_storage_configuration.sql`、`0013_node_gateway_credentials.sql`，D1 schema v10 → v13。前后只读聚合核对：用户 1、凭据记录 1、凭据 revision 1、密文长度 854、创建商品任务 0，均一致。该检查不等同于逐字节比较整个数据库；凭据复制及 AAD 保留另有迁移单测覆盖。
- 2026-09-12 11:55:05 UTC 部署成功，100% 流量使用 Worker version `c1c4ff32-1985-4199-a35a-5beee6ebf43f`，deployment `692dcf86-910d-43ee-8120-b2bbc847b408`。前一版本 `560ca9ea-2537-4040-bea7-a17ad7924d27` 仅作为回退参照；没有执行回退。11 个资源/变量绑定一致，沿用原 D1、R2、Browser、Secret 名称和七项 mutation 白名单，没有新建或删除资源。
- 线上 `/api/v1/healthz`、`/api/v1/readyz` 均 200；响应 Body 与 `X-Request-ID` 对应，分别为 `dc0e5276-2d58-44e0-9f62-735ca9b72452`、`6e83bbd1-bbe4-463f-8ff0-27afdbfa9485`。`POST /api/v1/meta/get`（`932902d3-a4cd-4038-b866-a1fd06651f66`）确认 `version=2.6.0`、`runtime=cloudflare`、`database=d1`、`environment=self-hosted`、`gatewayMode=real`。
- 线上首页和入口脚本 `/assets/index-CTPE7S4I.js` 与标签构建的本地文件哈希一致。实际 Chrome 刷新后显示 2.6.0，已有管理员会话保留；真实图库正常加载，手工点击“刷新”后完成并恢复可点击状态。
- 本轮没有执行 Alibaba 商品、图库或 S3 业务写入，不将健康探针或离线回归当成新的真实写验收。商店仍为“已提交审核”，等待通过/上架确认。
- 本机证据：`artifacts/release-2.6.0-{cloudflare-build,worker-deploy,d1-backup}.log`、`artifacts/release-2.6.0-d1-integrity-{before,after}.json`、`artifacts/release-2.6.0-worker-{before,after}.json`、`artifacts/release-2.6.0-worker-version-{before,after}.json`；文件均留在忽略目录。

## 最终准备复验（2026-09-12）

- 图库增加刷新按钮，同时重查当前素材、根分组和已展开的子分组；保留筛选、页码、已选素材、卡片/列表模式及侧栏展开状态。提供加载、防重复点击和失败提示。
- 按用户要求将未跟踪的 `docs/gpt-6-astra-integration-plan.md` 单独贮藏，stash 提交为 `de69ba2ff34cdc2213a1a81ac5a707d222426947`，未包含在发布提交或产物中。没有恢复或删除这份文档。
- 本次直接执行 `pnpm check` 全部通过，不再排除任何文件：格式、Lint（0 error / 23 warning）、i18n、6 个 workspace 版本、93 项离线目录、42/42 replay、OpenAPI/生成物漂移、类型、**208 个文件 / 946 项单测**、Web/MV3/Worker dry-run 构建、包体预算及商店合规。
- Web/正式 MV3 E2E **38 项**、Worker/D1 单测 **3 项**、BFF replay E2E **2 项**、Node 凭据中英文 E2E **2 项**、旧扩展升级检查 **28 项**通过。BFF 首次回归发现测试在点击刷新前清除 Cookie，后台查询提前弹出过期提示而拦截点击；改为在刷新请求发出后清除 Cookie，再验证实际 Worker 401、重新登录弹窗及路由恢复，没有改生产认证逻辑或放宽断言。
- 升级报告：`artifacts/release-2.6-upgrade/5fcbe2cc-dd3b-4a5b-84a3-dbe0f3608244/report.json`。复验日志：`artifacts/release-2.6.0-final-{check,worker,e2e,bff,node-credentials,upgrade,screenshots}.log`。
- 已从本次正式 MV3 构建重新拍摄中英文各 4 张截图，并逐张检查；使用空白隔离 Profile，不包含真实凭据、测试账号或虚构业务数据。
- 当前唯一交付 ZIP：`artifacts/one-vegetable-v2.6.0-chrome-mv3.zip`，**986,893 字节 / 137 文件**；SHA-256：`3acd177478d685578faef9fd8a44a43b38cf8ff808d3f8100f57d17d8e9cc72c`。已核对独立文件哈希、完整归档列表及重复压缩结果。
- 解包 **4,085,410 字节**，Options 首次 JS **127,565 字节**；总量门槛余 **14,590 字节**，i18n chunk 余 **67 字节**。权限不变，产物不含本地 `.env`、授权包、S3 密钥和 Mock 响应。
- 本节准备复验阶段只执行隔离测试和本地构建，没有 Alibaba/S3 真实写操作、远端 migration、Worker 部署、Store 上传或审核提交；其后经单独授权执行的远端 migration 和部署见顶部，不把自动回归当作新增真实平台验收。

## 最新候选补丁（2026-09-12）

- 修复图库导入/导出弹窗直接显示 `errors.codes.S3_STORAGE_NOT_CONFIGURED`：BFF 和插件两种缺少配置错误复用中英文提示，未知 S3 错误回退到安全说明，保留错误码和 requestId。
- 配置或域名权限相关问题提供 S3 设置入口；错误提示支持界面语言即时切换，并提高暗色文字对比度。没有更改用户 S3 配置或新增真实写能力。
- 后续补齐 `S3_LOCAL_HTTP_DISABLED` 的中英文解释和本地 Node 开关提示。示例环境默认关闭；当前用户授权的 RustFS 开关仅写入忽略的本机 `.env`，重启服务生效，不更改 Worker 或生产策略。
- 缺少配置补丁的定向单测 **18 项**、实际本地 BFF 中英文浏览器回归 **2 项**、workspace 类型、i18n、相关 Lint（0 error）、正式扩展构建、包体预算和商店合规通过。HTTP 提示补丁另外通过 **26 项** S3 配置、路由、客户端及 UI 定向测试，覆盖显式允许和默认拒绝。本地开发服务继续使用真实网关；回归使用独立测试库，没有访问远端 S3 或 Alibaba。
- 当时 ZIP 为 `artifacts/one-vegetable-v2.6.0-chrome-mv3.zip`，**986,558 字节**；SHA-256：`1c8a9541061b6a2999f13f06dda9039495a5b74001ba1e3b7bf2040571e64590`。现已由上节最终复验候选替换，不能混用校验值。
- 解包 **4,084,196 字节 / 137 文件**；Options 首次 JS **127,565 字节**，权限不变。总量门槛余 **15,804 字节**，i18n chunk 仍余 **67 字节**。
- 此处保留补丁当时的验收结果；覆盖本补丁与图库刷新的完整复验以上节为准。补丁日志：`artifacts/gallery-s3-error-{e2e,package,typecheck}.log`。

## 发布准备基线（2026-09-11）

- 包含图库传输任务中心、商品橱窗管理、三类列表自定义列、商品链接按钮、紧凑产品分/分组/状态列和扩展 API 目录。
- Node 管理员现在可以在设置页导入授权 JSON 或手动填写凭据，查看状态、测试连接、更换及清除；数据库加密保存，清除后不静默回退启动凭据。详见 [Node 凭据配置](node-credential-management.md)。
- 同步中英文版本说明、商店说明及橱窗写能力披露。正式扩展新 Profile 拍摄的中英文各 4 张截图已刷新，并逐张核对；不使用测试账号或虚构商品数据。
- Windows 完成 `pnpm check` 的全部阶段：格式、Lint（0 error / 23 warning）、i18n、6 个 workspace 版本、93 项离线目录、42/42 replay、OpenAPI/生成物漂移、类型、**208 个文件 / 937 项单测**、Web/MV3/Worker dry-run 构建和商店合规。
  - 格式阶段唯一例外：工作区另有不属于本轮的未跟踪文档 `docs/gpt-6-astra-integration-plan.md`，原样保留且不提交。直接执行 `pnpm check` 会被该文档格式阻止；本轮使用 `prettier --check . "!docs/gpt-6-astra-integration-plan.md"`，其余质量阶段逐项执行通过，未修改全局检查规则。
- Web/正式 MV3 E2E **38 项**、Worker/D1 单测 **3 项**、BFF replay E2E **2 项**、Node 凭据界面中英文 E2E **2 项**通过。隔离测试只使用合成凭据与离线响应，不是新增的真实平台写验收。
- 实际旧包升级验证 **28 项**通过，见下方升级边界。CI 和正式 Release workflow 已加入 `test:worker`。
- Options 首次加载 JS **127,565 字节**；解包 **4,083,384 字节 / 137 文件**。Manifest 权限与 2.5.0 相同；保持 4,100,000 字节总量门槛，不放宽预算。
- ZIP：`artifacts/one-vegetable-v2.6.0-chrome-mv3.zip`，**986,342 字节**。
- SHA-256：`e4fe497bd04d80fa687f49eec25d467e8890a46278b4f3a20cc6dc4987e2dd3d`。
- 运行内容基线为 `42545f2`（基于 `d67aa45` 更新版本说明）。之后的升级测试、截图工具、CI 和交接文档不改变运行内容；最终打包按完整文件列表核对并重复压缩验证一致。
- 打包扫描通过：没有生产 source map、测试账号变量/值或内部 Mock 样本；商店材料副本由当前仓库来源重建。

本机脱敏日志：`artifacts/release-2.6-{package,e2e,bff,node-credentials,worker,upgrade-final}.log`。最终升级报告：`artifacts/release-2.6-upgrade/afa1087f-69cf-4311-9ac0-67a9fcf42eb2/report.json`。

### 升级与回退边界

- 使用归档的 **2.5.0 正式 ZIP** 和 **早期 2.6.0 候选 ZIP**，先由旧运行时代码创建隔离测试数据，再在相同扩展安装路径、相同 Chromium Profile 中替换为新构建。
- Alibaba 密文、S3 加密配置及密钥、商品本地草稿、界面语言、接口语言和主题保留；2.6.0 基线的列偏好、IndexedDB 传输任务也保留。
- 浏览器重启/扩展更新后保险库重新锁定是预期安全行为；原口令仍可解密，不表示凭据丢失。已发出但没有回执的任务保持“结果不明”，只提供手工核对，不自动上传。
- 2.5.0 不包含后续列偏好和持久任务，这两类升级由早期 2.6.0 基线补充验证。此次使用隔离合成数据、不读取用户真实 Profile，所有 HTTP 请求被阻断；不等于 Chrome 商店自动更新已经验收。
- Node SQLite 和 workerd/D1 均覆盖 migration `0013_node_gateway_credentials.sql` 对原有加密凭据、AAD、审计字段及 revision 的保留；CI 不访问远端 D1。
- 部署 Node/Worker 前必须备份数据库并保留原加密密钥。旧版客户端未验证读取新版任务格式；不能把卸载扩展或降级数据库当作无损回退。迁移回退需使用匹配的代码、数据库备份和密钥。升级测试阶段没有执行远端迁移；后续已获授权的 Cloudflare 迁移记录见顶部。

重跑升级检查：

```powershell
pnpm verify:extension-upgrade
```

命令需要本机归档 ZIP 及 SHA-256 文件。早期 2.6.0 基线保存在 `artifacts/release-2.6-upgrade/baselines/`，不会被当前候选打包覆盖；缺失时明确失败，不下载未知旧包或使用当前构建冒充旧版。

### 后续发布边界

1. 发布准备分支已经快进至 `staging`、`master`，用户已自行提交商店审核；不要重复上传或撤回当前审核。
2. 固定 `v2.6.0` 对应的送审源码、ZIP 和 SHA-256；不再按此前候选阶段计划移除包内标记。仓库状态单独维护，未来运行内容变化必须使用新版本。
3. GitHub Release 与已获授权的 Worker 部署均完成；商店审核通过及上架仍待确认，不将其中一步当成全部完成。
4. 扩展总量仅余 **14,590 字节**，i18n chunk 仅余 **67 字节**；下一迭代优先拆分/去重，不直接放宽门槛。

## 先前橱窗候选（历史记录，不是当前包）

2026-09-11，`codex/product-showcase-management` 尚未推进主线时：

- 新增 [商品橱窗管理](product-showcase-management.md)：更多菜单入口、额度与可选状态列、批量加入/移出、确认与回读、本机未知结果保护。Node 本地和独立扩展可用；Cloudflare 写白名单本轮不变。
- 同时包含前序 [列表自定义列](list-column-preferences.md)、商品链接按钮、紧凑分组/状态列和此前 API 目录扩展，不再使用 2026-09-10 的早期候选。
- `pnpm check` 通过：0 Lint error / 23 warning、双语、93 项离线目录、42/42 replay 覆盖、OpenAPI/生成物漂移、类型、203 个文件的 919 项单测、Web/MV3/Worker dry-run 三端构建和商店合规。
- Web/正式扩展构建 E2E **38 项通过**；Worker 本地单测 **1 项通过**；Worker/D1/BFF replay E2E **2 项通过**。新增扩展测试经过真实 service worker 和 runtime messaging，但使用隔离的 TOP 响应，不宣称本轮重新执行了真实平台写入。
- 真实 Web/Node BFF 已读取橱窗额度 **2 / 2 / 0** 及两件商品和图片，操作权限生效。本轮没有再次变更线上橱窗；先前受控写入及恢复见 [真实验证记录](showcase-mutation-validation.md)。
- Options 首次加载 JS **127,283 字节**；解包 **4,064,503 字节 / 135 文件**。保持 4,100,000 字节总量门槛，不新增权限。仅将生成校验器中的说明性注解移除，OpenAPI 文档与所有校验规则保留。
- 当时 ZIP：**978,397 字节**，现已归档到 `artifacts/release-2.6-upgrade/baselines/one-vegetable-v2.6.0-chrome-mv3.zip`。
- SHA-256：`11a4c9f50c9328f124f0847f44e9db04fc856e9ebacf28b1acb3adfba7e04e90`。
- 运行代码基线：`28ba677`。之后的测试等待修正和验收文档不改变运行包。

更早的旧包另存 `artifacts/one-vegetable-v2.6.0-before-showcase.zip`，只供本地比较，不能当作本次候选上传。历史检查日志位于本机忽略目录 `artifacts/showcase-mutation-real/showcase-*.log`。

## 本次变化

- 图库 ZIP/S3 导入导出进入本机持久任务中心，关闭弹窗或切换工作台页面后继续。
- 刷新后手工恢复；ZIP 重新选择原包，S3 核对源版本和目标内容，成功项不重复上传。
- 逐文件请求回执、分组创建及最终清单均记录。结果不明或目标组未确认时停止，不伪装整批成功。
- Web/BFF 与插件共享规则和任务执行器；插件继续无需后端。
- 明确允许可信私网 RustFS 的 HTTP 连接，默认仍 HTTPS；Worker 不允许私网 HTTP。

## English candidate notes

- A local task center for gallery ZIP/S3 imports and exports continues across dialogs and workbench navigation.
- Resume explicitly after reload. ZIP recovery requires the original archive; S3 recovery verifies object versions and content without repeating confirmed uploads.
- Persist per-file receipts, folder creation and final manifest steps. Uncertain writes or unverified destination groups stop the batch rather than claiming success.
- Shared behavior across Web/BFF and the standalone extension, with explicit opt-in for trusted private-LAN HTTP S3 storage. HTTPS remains the default; Workers do not allow this HTTP exception.

## 真实验收与边界

详见 [任务中心与安全恢复](gallery-transfer-task-recovery.md)。Web/Node BFF 和正式构建插件已分别通过真实 ZIP/S3 导入导出、暂停和手工恢复。RustFS 主机授权由用户在原生 Chrome 权限弹窗中批准，没有修改 Manifest 预授权。

远端 OSS 使用重复图片验证了平台去重：返回已有 fileId 但不改变其原分组。保留需处理任务，第二张没有继续上传。这是安全保护验收，不宣称新分组导入全部成功。

本机忽略目录保留少量测试素材、目标分组和脱敏回执；没有删除远端文件，没有修改商品。密码、访问密钥、授权包和 Mock 响应不得进入候选包。

## 早期候选检查（历史记录，不是当前包）

2026-09-10，Windows 本地完成：

- `pnpm check` 完整通过：格式、Lint（0 error / 21 warning）、i18n、6 个 workspace 版本、OpenAPI/生成物漂移、84 项离线目录、35/35 replay、类型、817 项单测、Web/MV3/Worker dry-run 构建和商店合规。
- Web/扩展 Playwright 26 项通过；Worker 本地单测 1 项、Worker/D1/BFF replay E2E 2 项通过。模拟故障检查与真实图库验收分开记录。
- Options 首次加载 JS 126,371 字节；解包总量 4,099,974 字节，126 个文件。没有放宽现有启动/总量预算；总量接近 4.1 MB，后续新增功能需重新评估。
- 当时的候选 ZIP 为 974,522 字节；同名正式候选路径现已由上面的最新包替换。
- SHA-256：`8a3ff33ee345cea92f6b3f106c55f8a9a68a428299671c5dab134973f45a3763`。

打包器重复压缩确认可复现，并核对完整文件列表；商店材料副本从仓库来源重新生成。不包含本机授权包、S3 密钥或真实验收 Profile。

送审包的应用版本历史保留构建时的“候选、尚未上架”文案并链接到本文件；本文件顶部记录最新审核状态。后续版本再调整应用内文案，不替换已送审的 2.6.0 包。
