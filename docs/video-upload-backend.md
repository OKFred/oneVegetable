# 视频上传后端与受控验收

## 当前交付边界

- Web/BFF 与独立插件复用 `VideoUploadService`，UI 使用 `VideoUploadControl.videoUpload(command, context, requestId?)`。
- BFF：`POST {prefix}/video-uploads/call`，JSON Body、UUID v4 requestId、管理员会话及 CSRF；插件只接受受信工作台消息。
- Node SQLite / Worker D1 使用 migration `0014_video_upload_tasks.sql`；插件使用独立 IndexedDB。只保存任务回执与恢复信息，不保存文件、Base64、签名 URL 或凭据。
- 本地 MP4 最大 50 MiB，每片 5 MiB（最后一片可更小）。发送前持久化意图，按 revision 比较更新；不自动重试写操作。
- 同时支持公网 HTTPS URL；URL 仅在创建/提交请求内存中使用，任务只保存其 SHA-256。刷新后需重新提供同一 URL。
- S3 对象路径相对于配置的 rootPrefix；创建、核对和中止均使用同一配置。禁止替换预签名 URL 的域名；中止只作用于本任务未完成的 multipart，不删除完成对象或平台视频。
- CAS 成功后才推进本地 revision；冲突立即停止，不再保存旧快照。ListParts 必须校验 XML 根节点、Bucket/Key/UploadId 和完整分页信息；无效响应不能把未知分片改为待上传。
- Abort 成功不等于取消已确认。任务先保存取消意图，再通过 ListParts 的明确 `NoSuchUpload` 确认；超时、普通 404 或仍存在的空列表都保持“需处理”。手工核对只读，不自动再次 Abort；等待取消期间不能继续上传或提交。
- 完成分片后通过单字节 Range GET + 分段 GET 验证大小与完整 SHA-256。提交平台前检查匿名预签名 GET 与 MP4 文件头。
- 平台 `msg_code=200` 仅代表已受理；通过唯一标题标记与查询基线确认新增视频。五分钟内未确认则保持需核对，不能重复上传。

Node `local-node` 与正式 MV3 已通过本轮真实上传和回读，固定白名单开放这两个运行环境；权限、身份、CSRF、上下文和二次确认仍生效。`staging`、`production`、Cloudflare `self-hosted` 保持关闭，不能以隔离回放替代线上验收。部署 migration 并不表示真实上传已验收。

## 控制接口

请求：`{ requestId, context: { identity, gateway, storage }, command }`。上下文来自现有 `gallery-transfers/context/get` 或插件受信查询；后端重新读取实际配置并执行比较，不能用 `storage: null` 绕过检查。

| command.action | 行为                                         |
| -------------- | -------------------------------------------- |
| `create`       | 冻结标题、文件指纹或 URL 指纹；无远端上传    |
| `list` / `get` | 查询本身份的任务                             |
| `initiate`     | 创建本任务 multipart                         |
| `part`         | 发送一片；仅接受待发送状态与匹配指纹         |
| `reconcile`    | 手工核对未知分片或完成对象，不重发未知写请求 |
| `complete`     | 一次性完成分片，然后回读校验                 |
| `submit`       | `confirmed: true` 后仅提交平台一次           |
| `verify`       | 只读查询平台新增视频；不重复提交             |
| `cancel`       | 中止本任务未完成 multipart；保留已完成对象   |

结果为 `{ tasks, uploadEnabled }`。`accepted` 与 `confirmed` 必须分开展示；未知结果不能显示成功。每个变更命令传最新 revision。刷新后没有后台调度，需用户手工选择任务和原文件；重新选择会核对完整指纹。

## Windows 本地受控脚本

脚本：`scripts/smoke-video-upload-task-real.ts`。以下为受控验收步骤，不能把本地自动测试当成真实上传通过。

1. 在本机工作台配置已有 Alibaba 凭据和测试 S3；不要使用生产配置。
2. 启动本机 BFF 时只启用单个方法（显式值会替换本机默认写白名单）：

   ```powershell
   $env:ONE_VEGETABLE_MUTATION_FLAGS = 'method:alibaba.icbu.video.upload'
   pnpm dev:api:real
   ```

3. 在另一个 PowerShell 窗口按需设置 `VIDEO_SMOKE_BFF_URL`（默认 `http://localhost:8787`）、`VIDEO_SMOKE_WEB_ORIGIN`（默认 `http://localhost:5173`）、`VIDEO_SMOKE_LOGIN_FILE`（已忽略的本机 JSON，仅含工作台 `username/password`）。默认登录文件位置沿用 `artifacts/gallery-transfer-2.6/local/local-auth.json`；脚本不打印内容，也不替换任何配置。
4. 先执行不上传的预检查：

   ```powershell
   pnpm exec tsx scripts/smoke-video-upload-task-real.ts --preflight
   ```

5. 明确开启脚本写入并暂存少量无敏感 MP4；安装 ffmpeg 时可用 `--generate` 替代 `--file`，生成约 6 MiB 的合成视频以覆盖多分片：

   ```powershell
   $env:ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE = '1'
   pnpm exec tsx scripts/smoke-video-upload-task-real.ts --stage --file=artifacts/test-video.mp4
   ```

6. 检查脱敏报告中的任务 ID。平台提交与 S3 暂存分开执行：

   ```powershell
   pnpm exec tsx scripts/smoke-video-upload-task-real.ts --submit --task=<uuid>
   ```

7. 其他明确动作：`--verify --task=<uuid>`、`--reconcile --task=<uuid>`、`--stage --resume --task=<uuid> --file=<原文件>`、`--abort --task=<uuid>`。未知分片先核对；不会自动重发。`--submit` 后只读核对最多五分钟。

测试存储必须是 `https://oss-s3.this-time.com` 或 `https://oss-s3.app.fred.wiki`，Bucket `dev`，rootPrefix 为空，使最终对象严格位于 `onevegetable/video-staging/<taskId>/`。内网任务仅验证暂存；平台提交要求公网 Endpoint。两个配置使用不同任务，不能换域名继续原任务。

报告位于已忽略的 `artifacts/video-upload-validation/`，记录 requestId、阶段、任务回执和稳定错误码，不记录签名 URL、密码、Token 或完整平台响应。结束后移除本机单方法验收配置并重启 BFF，不据此开放其他运行时。

## 初次现场与后续整改

2026-09-23 现场记录：隔离 Node BFF 已执行一次公网 S3 multipart 初始化，返回通用 `VIDEO_UPLOAD_FAILED`，任务保持“需处理”。未发送分片、未完成对象，也未提交 Alibaba。随后只读查询该任务精确 key：HTTP 200、未截断、没有 multipart；原始 S3 错误已被通用错误映射覆盖，无法据此断言底层原因。没有自动重试或清理远端对象。脱敏记录位于 `artifacts/video-upload-validation/33a00d65-s3-readonly-diagnosis-20260923.md`，仍需补充安全错误分类后完成受控验收；相关运行时白名单保持关闭。

- 公网/内网 S3 的 multipart、匿名预签名 GET、分片核对与恢复。
- Alibaba 实际拉取、返回已受理、唯一标记视频回读。
- 正式插件重启、域名权限、恢复流程，以及各运行时性能边界。
- Worker 的 CPU/部署环境限制需要单独验收，本轮没有部署或放开线上写能力。

该节保留初次失败证据；最新结论见下方收尾记录。仅单测通过不能代替真实验收。

## 2026-09-23 补充验证

- 修复 S3 HTTP 错误被通用错误覆盖的问题。只保留 HTTP 状态及固定白名单中的 S3 Code，不保留 Message、XML、签名 URL 或密钥；插件消息边界和上传弹窗也采用相同脱敏规则。411 MissingContentLength 提供中英文代理配置提示，不自动重试。
- 内网 `https://oss-s3.app.fred.wiki` / `dev` 已完成一个 7,203,235 字节合成 MP4 的真实两片上传、合并、HEAD 和完整 SHA-256 分段回读。中途停止后显式重新选择原文件继续，沿用同一个任务及 key；没有重复 initiate、没有删除对象，没有提交 Alibaba。
- 公网 `https://oss-s3.this-time.com` 对同一协议的初始化返回 `HTTP_411:MissingContentLength`。Windows 原生 Fetch 的本地线缆检查确认发送 `Content-Length: 0`；内网对照成功，因此问题位于公网转发路径，尚未定位具体代理跳点。未修改 Tunnel、DNS、反向代理或桶策略。参见 [RustFS 反向代理要求](https://github.com/rustfs/rustfs/blob/main/docs/operations/reverse-proxy.md)。
- 脱敏证据：内网暂存 `artifacts/video-upload-validation/74bfa93b-76b5-460b-b95f-6e9e3cf6217c.json`；公网错误 `artifacts/video-upload-validation/00e6a1e8-d5a2-42a2-be02-bd7b77ed5d6a.json`。这些失败任务仍保留“需处理”，不会悄悄重发。
- 正式 MV3 构建真实只读验收已读取 20 条视频、打开任务界面，并通过停止/唤醒后台及 timeOrigin 变化验证上下文保留。没有 S3 写入或 Alibaba 上传命令。证据：`artifacts/extension-video-upload-validation/38f903d6-c95a-478e-9b16-e9b5198633eb/43205df3-8762-4571-903e-dc19d6be190c.json`。
- workerd/D1 增加分片、任务重启、上下文、revision、未知结果和敏感数据隔离测试。时间测量只是本机诊断，不代表 Cloudflare CPU 配额验收；没有部署 Worker。
- 公网签名 GET 已匿名读取同一合成 MP4 的全部 7,203,235 字节，完整 SHA-256 一致。URL 上传单独使用正常 BFF 登录、CSRF、上下文和一次性任务，不绕过写白名单；这不替代公网 multipart 验收。
- 首次 URL 上传在平台提交前的查询基线阶段停止：真实 API 在零结果时省略 `list`。SQLite 回执确认 `submitAttempted=false`，没有发送 Alibaba 上传；只读再次查询确认 `current_page=1/page_size=20/total_count=0`。适配器现仅在明确零结果及分页匹配时兼容省略列表，缺失总数、非零总数或畸形列表仍失败。证据：`artifacts/video-upload-url-validation/d4c44f89-60ba-438b-81f2-2e9f96154688/`，脱敏查询 requestId `82650aea-304e-4c7f-b359-685d57e6e6fe`。

隔离 Node 工具 `scripts/prepare-video-upload-real-smoke.ts` 支持 `VIDEO_SMOKE_STORAGE_ENDPOINT`（仅上述两个地址），及 `VIDEO_SMOKE_RESUME_DIR`（仅本工具已创建的忽略目录名称）。恢复不会替换原配置、管理员或任务；端点不一致会拒绝。正式插件逐步验收说明见 [Windows runbook](../scripts/lib/extension-video-upload-real.md)。

## 2026-09-23 真实链路收尾

- 经用户明确批准，仅将 `oss-s3.this-time.com` 对应 Tunnel 路由的 `disableChunkedEncoding` 从 false 改为 true。原回源、其他域名、DNS、桶权限及安全规则均未改。初始化 411 已消失，两个公网分片均成功。
- 公网合并命令随后返回 403，实际失败位于合并后的 HEAD 核对；Cloudflare 事件为 HEAD、无边缘拦截。其[公开缓存说明](https://developers.cloudflare.com/cache/concepts/cache-behavior/)指出可缓存 HEAD 可能回源为 GET，影响方法参与计算的 S3 签名。
- 视频元数据改用签名 GET `Range: bytes=0-0`，严格要求 206、准确的 Content-Range 和单字节响应，响应上限 64 KiB；普通图片 5 MiB 限制不变。整文件 SHA-256 核对仍不可省略。未改变安全策略或绕过身份验证。
- 仅执行只读 `reconcile` 后，既有公网任务恢复为 staged；没有再次 initiate、上传分片或 complete。证据 `artifacts/video-upload-validation/008327f3-fb4a-4035-9f6b-c01af6f17847.json`。
- Node 本地 MP4 上传已完成一次 Alibaba 提交及唯一标题回读，状态 confirmed。证据 `artifacts/video-upload-validation/40a67c1c-4f5e-4e2f-9906-58fbaa67e523.json`。
- Node 公网 URL 上传单独通过匿名分段 GET 和 SHA-256 校验，再提交一次并回读 confirmed。证据 `artifacts/video-upload-url-validation/3cee07a6-41ca-48cf-98e3-400a92b3224e/report.json`。签名 URL 未保存到回执。
- 本轮合成视频与完成的 S3 对象保留，不关联商品，不改商品或库存，不自动清理远端结果。历史失败任务仍保留准确状态，不能据此重发。
- Windows 原子回执的临时 EPERM/EBUSY 仅重试同一次本地 rename；不重试网络调用。故障仍会在发送请求前停止，不能无记录上传。
- Cloudflare Worker 仅完成隔离回放和构建，未部署，真实上传运行时保持关闭。
- 正式 MV3 使用独立 Profile、原生用户域名授权和加密配置，完成第一片上传后暂停，重启 service worker，再手工恢复，仅补发第二片，合并及全量哈希确认通过。只提交一次 Alibaba 上传，随后再次重启并回读 confirmed。证据目录 `artifacts/extension-video-upload-validation/cda37f7b-1ef5-4d97-8cfd-dbf1bbd81ff4/`，最终回执 `f936eea0-80d9-4ec3-87b9-8a5fe291115d.json`。真实写验收走工作台同一受信消息入口；上传弹窗交互由离线 E2E 覆盖，二者不混称为真实 UI 全链路自动操作。
- 用户原生授权保留在当前插件/Profile；同一域名的后续分片、恢复、提交无需再次确认。测试期间新建 Profile 后再次授权不代表每次同步都会弹窗。
