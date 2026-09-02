# 插件新增商品持久任务

Chrome Extension MV3 现已开放 `saveProductDraft` 和 `publishProduct`。两项能力不会直接从页面调用 Alibaba；请求始终进入 service worker，并复用同步网关、HMAC-SHA256 签名、请求契约和凭证保险库。

## 安全闭环

1. service worker 计算 `operation + categoryId + language + schemaXml` 的 SHA-256 指纹。
2. 在任何 Alibaba 请求之前，将 `submitted` 任务写入 `chrome.storage.local`。
3. 同一 operation、同一指纹存在阻断任务或已验证任务时，后台在出网前拒绝重复创建。
4. Alibaba 只有同时返回 `biz_success=true` 和非空商品 ID 才视为已受理。
5. 平台草稿使用 `schema.render.draft` 回读；正式发布按商品 ID 从商品列表回读。
6. 回读成功后任务进入 `verified`。平台商品仍处于 `auditing` 时，只表示创建已经回读，不代表平台审核通过。
7. 请求结果不确定或回读超时后进入 `recovery-required`，继续阻止重复提交并要求用户到国际站后台核对。

新增商品没有自动恢复操作。插件不会删除平台草稿，也不会自动下架或删除已经发布的商品。页面关闭、刷新或 service worker 休眠后，任务仍可继续查询平台状态；未确认前保留本地编辑草稿。

## 真实验收

2026-09-01 在 Windows 本地用生产构建的 MV3 扩展完成验收：

- `saveProductDraft` 创建草稿 `1601938471572`，由 `schema.render.draft` 回读，任务为 `PRODUCT_DRAFT_READBACK_MATCHED`。
- `publishProduct` 创建商品 `1601938537310`，由商品列表按 ID 回读，任务为 `PRODUCT_PUBLISH_READBACK_MATCHED`。
- 两个任务最终均为 `verified`，没有执行删除、下架或其他清理 mutation。
- 脱敏报告位于忽略目录 `artifacts/real-smoke/extension-product-creation-20260901.json`，不保存凭证、密码或完整 Schema XML。

预检命令：

```powershell
pnpm build:extension
pnpm smoke:extension:product-create:real
```

真实执行必须显式开启一次性安全开关：

```powershell
$env:ONE_VEGETABLE_REAL_EXTENSION_PRODUCT_CREATION_SMOKE='1'
pnpm smoke:extension:product-create:real
```

Smoke 使用独立、已忽略的 Chrome Profile。报告已经为 `passed` 时脚本直接退出，避免重复创建。
