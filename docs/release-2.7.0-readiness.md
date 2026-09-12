# 2.7.0 候选验收

检查日期：2026-09-12。候选分支 `codex/release-2.7.0-readiness`，从已集成橱窗与 MV3 修复的 `staging` 创建。

## 状态与边界

- 本轮准备候选并推进 `staging`，不合入 `master`，不创建 Tag/GitHub Release，不部署 Worker，不上传或提交商店审核。
- 2.6.0 已由所有者提交商店审核；尚未确认审核通过。保留原 ZIP 和不可变 `v2.6.0` Tag。
- 2.7.0 增加橱窗排序/替换、类目发品类型引导，以及七领域 MV3 静态校验和后台重启恢复。
- 不增加扩展权限，不扩大 Cloudflare 写入白名单。本轮不再执行 Alibaba mutation。
- 既有真实 Node 橱窗调整及恢复证据见 [橱窗验收](showcase-order-product-type-validation.md)；正式 MV3 隔离回归不冒充真实平台验收，见 [静态校验说明](mv3-capability-validation.md)。

## 候选检查

构建、升级回归、包体、安全检查和 ZIP 校验完成后在此记录结果。构建和测试期间固定分支，不同时切换工作树。

## 提交资料

- 中英文说明：`store-listing/zh_CN.md`、`store-listing/en.md`。
- 权限/数据说明：`store-listing/listing.json`；此次无新增权限或数据种类。
- 既有 Small promo tile 可继续使用；截图来自无账号正式扩展，不携带开发账号或演示业务数据。
- 商店上传、审核及发布是后续独立动作，需要另外确认；不能将候选包完成等同于已上架。
