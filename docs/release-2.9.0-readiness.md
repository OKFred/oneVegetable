# 2.9.0 视频素材只读管理发布记录

## 范围与发布边界

- 基于已通过 CI 的 `codex/video-library-readonly`（`6011701`）；先快进到 staging，再从 `codex/release-2.9.0-readiness` 完成版本检查，最终快进到 staging/master。
- 版本统一为 `2.9.0`；中英文版本说明及商店描述同步更新。正式 GitHub Release 使用 annotated tag `v2.9.0`，与旧标签和旧附件隔离。
- 图库的视频工作区支持只读搜索、分页、预览与两类关联商品。没有视频上传、关联修改、删除、新增永久权限或放宽安全门槛。
- Worker 部署、Chrome Web Store 上传、送审和发布均未包含在本轮推进中；GitHub Release 不代表商店已上架。

## 功能验收基线

- [视频功能说明及官方页面交叉验收](video-library-readonly.md)记录了三个同账号样本：主图关联、详情关联及无关联。
- 官方页面、真实 Node BFF Web 和正式 MV3 构建均实际播放了已有第二个样本；原生时长为 14.36 秒，API 原值 14。其他样本的播放异常、文件大小差异及缺失成功码仍单独保留，不宣称全量一致。
- 功能分支 CI：[34750808681](https://github.com/OKFred/oneVegetable/actions/runs/34750808681) 对提交 `6011701b728b6390a74426bb36507280ed6f290d` 通过。
- 真实证据只保存在忽略目录 `artifacts/video-read-validation/`。本轮版本准备不重复执行真实平台请求，也不修改任何商品或视频。

## 发布复验

Windows 复验记录：

- `pnpm check` 通过：格式、Lint（0 error / 23 项既有 warning）、双语文案、OpenAPI/生成漂移、97 项文档审计、类型检查、1008 项单测 / 221 个测试文件及三端构建。
- workerd：5 项；BFF replay：2 项；Node 凭据中英文 E2E：2 项，均通过。
- 最终 Web/MV3 E2E：`pnpm exec playwright test --workers=1` 共 45 项通过（3.1 分钟），与 CI 的单 worker 配置一致。日志：`artifacts/release-2.9-e2e-accepted.log`。正式 tag 流水线会基于不可变提交再次执行完整门禁。
- 2.8.0 正式包升级到 2.9.0：15 项通过，保留凭据密文、S3 设备密钥/配置、XML 草稿、语言/主题、列偏好，未完成传输保持结果不明并要求手工核对。报告：`artifacts/extension-upgrade/f37dbf9a-4823-4354-873b-c92a02079f49/report.json`。

### 测试时序整改

最初本机 8 worker 并发回归出现图库锁释放和后台停止中间态超时，失败日志保留于 `artifacts/release-2.9-e2e*.log`，不是通过记录。测试现在明确等待 Web Lock 取得/释放，并在手工刷新前再次断言没有自动恢复；两项图库测试重复五轮，共 10 项通过。后台测试先关闭可能唤醒 worker 的工作台，确认停止后重新打开，再验证新的 `performance.timeOrigin` 和实际接口校验；连续三次通过。未放宽生产恢复策略、未禁用用例，也没有增加自动重试。

升级脚本对 2.6.0 及后续版本都检查列偏好和未完成传输任务，不再仅匹配 2.6.0。基线使用已下载且校验 SHA-256 的正式 2.8.0 ZIP；使用隔离 Profile 和测试配置，拦截所有 HTTP 请求，不读取用户真实凭据。

包体门槛不变：Store ZIP ≤ **1,500,000 字节**；解包 ≤ 4,100,000；后台入口 ≤ 100,000；工作台首屏 JS ≤ 250,000；公共双语块 ≤ 310,000。正式发布后以 tag 流水线附件为准，下载并复核 ZIP / `.sha256` / `release.json`；本机候选包不替代正式附件。

本机构建产物：`artifacts/one-vegetable-v2.9.0-chrome-mv3.zip`，1,021,153 字节 / 145 个文件；解包 4,073,685 字节、后台 97,545 字节、首屏 JS 127,050 字节、公共双语块 309,933 字节。ZIP SHA-256：`838189b6e18b93eee99519b04c260f21eb820df6f4181fdbaf5c6ed9f4e4d94a`。全部包体和商店合规门禁通过。正式 Linux 流水线附件仍需独立核验，不预设跨平台二进制相同。
