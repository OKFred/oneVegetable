# 2.7.0 候选验收

检查日期：2026-09-12。候选分支 `codex/release-2.7.0-readiness`，从已集成橱窗与 MV3 修复的 `staging` 创建。

## 状态与边界

- 本轮准备候选并推进 `staging`，不合入 `master`，不创建 Tag/GitHub Release，不部署 Worker，不上传或提交商店审核。
- 2.6.0 已由所有者提交商店审核；尚未确认审核通过。保留原 ZIP 和不可变 `v2.6.0` Tag。
- 2.7.0 增加橱窗排序/替换、类目发品类型引导，以及七领域 MV3 静态校验和后台重启恢复。
- 不增加扩展权限，不扩大 Cloudflare 写入白名单。本轮不再执行 Alibaba mutation。
- 既有真实 Node 橱窗调整及恢复证据见 [橱窗验收](showcase-order-product-type-validation.md)；正式 MV3 隔离回归不冒充真实平台验收，见 [静态校验说明](mv3-capability-validation.md)。

## 候选检查

Windows / Node 24.16.0 / pnpm 11.20.0；运行时代码构建基线 `9b569e8`，商店资料同步 `4fb5e0a`。构建和测试期间固定分支，不同时切换工作树。

- 全量单测：213 文件 / 978 项通过；类型检查全部通过。
- 格式、Lint（0 error / 23 条既有 warning）、双语键、OpenAPI/生成漂移、95 项离线审计、42/42 replay 覆盖通过。
- Web、Worker dry-run、正式 MV3 构建通过；Worker 本地测试 3 项、Worker/D1/BFF replay E2E 2 项、Node 凭据设置中英文 E2E 2 项通过。
- Web/正式扩展 Playwright：39/39 通过（4.9 分钟），覆盖中英文、无障碍、暗色、图库传输恢复、商品 JSON/ZIP 与批量队列。正式 service worker 验证 42 项可调用只读示例及重启后的能力校验、橱窗、S3、列设置；均使用隔离响应，不执行真实写入。
- 首次 `pnpm check` 在最后的商店版本一致性门槛发现 `listing.json` 仍为 2.6.0；已同步为 2.7.0 并重新执行合规检查。不是跳过门槛，亦不将该次完整命令的非零退出记录为成功。
- 从原 2.5.0 和正式 2.6.0 ZIP 升级到此候选：28 项通过。凭据可解密且密文未变、S3 配置、语言/主题、XML 草稿、列偏好保留；执行中传输任务进入人工核对，不自动重传。隔离 Profile 不使用真实账号。
- 升级报告：`artifacts/extension-upgrade/5b6f2ed4-3b98-418a-ab95-ba4ebd2b29dd/report.json`。质量日志：`artifacts/release-2.7-*.log`；忽略目录不提交。
- 中英文各 4 张 1280 × 800 正式扩展截图已更新并逐张检查；未创建凭据，未包含账号、Token 或业务测试样本。

## 候选包

- ZIP：`artifacts/one-vegetable-v2.7.0-chrome-mv3.zip`，990,914 bytes / 138 files。
- SHA-256：`ea121a17a9454ab7d8c6c3ee1133123801721670fa7724ea0f093b17e31c00e1`。
- 解包：4,088,269 bytes（原门槛 4,100,000）；background：85,512 bytes；Options 首次 JS：127,060 bytes；i18n：309,933 bytes（门槛 310,000）。后续增量需先精简，未放宽任何预算。
- 后台静态导入图通过，不包含动态 import、外部/缺失依赖；7 领域静态 validator 保持 CSP 安全，不含 sourcemap 或本机账号值。
- Manifest 的 `permissions`、`host_permissions`、`optional_host_permissions` 与两个旧包均完全相同。
- 打包器重复压缩、解包文件清单校验通过；商店资料副本在 `artifacts/store-listing/`。
- 原 2.6.0 ZIP 校验仍为 `3acd177478d685578faef9fd8a44a43b38cf8ff808d3f8100f57d17d8e9cc72c`，没有覆盖旧包。

## 提交资料

- 中英文说明：`store-listing/zh_CN.md`、`store-listing/en.md`。
- 权限/数据说明：`store-listing/listing.json`；此次无新增权限或数据种类。
- 既有 Small promo tile 可继续使用；截图来自无账号正式扩展，不携带开发账号或演示业务数据。
- 商店上传、审核及发布是后续独立动作，需要另外确认；不能将候选包完成等同于已上架。
