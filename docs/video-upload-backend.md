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
- 完成分片后通过 HEAD + 分段 GET 验证大小与完整 SHA-256。提交平台前检查匿名预签名 GET 与 MP4 文件头。
- 平台 `msg_code=200` 仅代表已受理；通过唯一标题标记与查询基线确认新增视频。五分钟内未确认则保持需核对，不能重复上传。

当前尚无运行时完成本轮真实上传验收，固定已验收运行时列表为空。`staging`、`production` 始终禁用；Cloudflare self-hosted 和正式插件目前也不会自动开放上传。只有 `local-node` 的单方法验收配置允许受控测试。部署 migration 并不表示真实上传已验收。

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

## 待真实验收

2026-09-23 现场记录：隔离 Node BFF 已执行一次公网 S3 multipart 初始化，返回通用 `VIDEO_UPLOAD_FAILED`，任务保持“需处理”。未发送分片、未完成对象，也未提交 Alibaba。随后只读查询该任务精确 key：HTTP 200、未截断、没有 multipart；原始 S3 错误已被通用错误映射覆盖，无法据此断言底层原因。没有自动重试或清理远端对象。脱敏记录位于 `artifacts/video-upload-validation/33a00d65-s3-readonly-diagnosis-20260923.md`，仍需补充安全错误分类后完成受控验收；相关运行时白名单保持关闭。

- 公网/内网 S3 的 multipart、匿名预签名 GET、分片核对与恢复。
- Alibaba 实际拉取、返回已受理、唯一标记视频回读。
- 正式插件重启、域名权限、恢复流程，以及各运行时性能边界。
- Worker 的 CPU/部署环境限制需要单独验收，本轮没有部署或放开线上写能力。

通过后由主任务根据脱敏回执更新对应固定运行时白名单；仅单测通过不能代替真实验收。
