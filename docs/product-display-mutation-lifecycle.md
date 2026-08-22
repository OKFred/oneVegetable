# 商品上下架持久任务与真实 Smoke

检查日期：2026-08-22。

`alibaba.icbu.product.batch.update.display` 当前仍出现在官方国际站商品 API 目录中，标记为开放平台免费、需要授权。请求使用逗号分隔的商品混淆 ID 和 `on/off`；应用只在 `sub_success=true` 时认为 Alibaba 已接受请求。官方文档地址：<https://developer.alibaba.com/docs/api.htm?apiId=44413>。

“已接受”不等于最终完成。BFF 会为每个商品先保存持久任务，再调用 Alibaba，并通过 `alibaba.icbu.product.list` 回读明文 ID、混淆 ID 和上下架状态：

- `submitted`：任务已持久化，尚未得到 Alibaba 明确接受。
- `verifying`：Alibaba 已明确接受，等待商品列表回读。
- `verified`：商品列表状态与目标状态一致。
- `recovery-required`：限定时间内未确认目标状态，需要人工确认或恢复。
- `recovering`：已请求恢复操作前状态，等待回读。
- `recovered`：列表已确认恢复到操作前状态。
- `failed`：Alibaba 在明确接受前失败，或本地准备阶段失败。

同一商品存在未完成或待恢复任务时，BFF 在出网前拒绝新的 Schema 更新或上下架操作。任务只保存请求指纹、商品 ID、混淆 ID、原状态、目标状态和脱敏错误，不保存完整 Alibaba 响应。

## 真实 Smoke

真实 Smoke 只测试一个已明确核对的在线商品，不修改标题，不批量操作其他商品：

1. 精确核对标题、明文 ID、混淆 ID和当前上架状态。
2. 原子记录 `displayNeedsRecovery=true`。
3. 下架并通过列表回读确认。
4. 立即上架并再次回读确认。
5. 只有确认重新上架后才清除恢复标记。

Windows PowerShell 中显式启用：

```powershell
$env:ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_SMOKE = '1'
pnpm smoke:product:display:real
```

可通过以下环境变量覆盖测试目标：

- `ONE_VEGETABLE_REAL_PRODUCT_ID`
- `ONE_VEGETABLE_REAL_PRODUCT_ENCRYPTED_ID`
- `ONE_VEGETABLE_REAL_PRODUCT_SUBJECT`
- `ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_OUTPUT`
- `ONE_VEGETABLE_REAL_PRODUCT_DISPLAY_DATABASE`

报告和 SQLite 任务库默认保存在忽略目录 `artifacts/real-smoke/`。若进程在恢复前中断，以相同配置再次运行时，脚本只优先恢复上架并退出；确认恢复后再单独启动新一轮 Smoke。

真实 Smoke 不进入 CI。`pnpm dev:api:real` 默认仍不启用 `operation:updateProductDisplay`，页面真实按钮只有在本地显式 feature flag 开启时才可用；staging 和 production 继续禁止商品 mutation。
