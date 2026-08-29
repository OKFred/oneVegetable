# 商品上下架持久任务与真实 Smoke

检查日期：2026-08-22。

`alibaba.icbu.product.batch.update.display` 当前仍出现在官方国际站商品 API 目录中，标记为开放平台免费、需要授权。请求使用逗号分隔的商品混淆 ID 和 `on/off`；应用只在 `sub_success=true` 时认为 Alibaba 已接受请求。官方文档地址：<https://developer.alibaba.com/docs/api.htm?apiId=44413>。

“已接受”不等于最终完成。BFF 会为每个商品先保存持久任务，再调用 Alibaba，并通过 `alibaba.icbu.product.list` 回读明文 ID、混淆 ID 和上下架状态：

- `submitted`：任务已持久化，尚未得到 Alibaba 明确接受。
- `verifying`：Alibaba 已明确接受，等待商品列表回读。
- `auditing`：上下架变更触发平台商品审核；等待审核完成，期间不会重复提交。
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

商品列表的 `status=new/modified` 优先映射为审核中，即使此时 `display=N` 也不能当成普通下架并重复请求上架。Smoke 遇到审核态会保留恢复标记并退出；稍后重跑时只查询状态，直到确认 Active/online。

## 2026-08-22 真实账号记录

单商品下架请求已得到 `sub_success=true`，并由商品列表回读为下架；随后的上架请求也得到明确受理，但商品进入国际站 `Pending` 审核。官方后台此时显示 Active 0、Pending 1，商品行操作被禁用；OpenAPI 列表返回 `status=modified` 与非上架 display。

随后官方后台恢复为 Active 1、Pending 0，OpenAPI 列表再次回读为 online；两条持久任务最终均为 `verified`，恢复标记已清除。因此该方法记为当前账号验证通过，但验收同时证明上架可能经过异步审核，不能按同步接口对待，也不能在 Pending 阶段重复提交。

真实 Smoke 不进入 CI。完成上述真实账号生命周期验收后，`pnpm dev:api:real` 默认在本地 Node 子进程中启用 `operation:updateProductDisplay`；页面仍要求管理员会话、二次确认、混淆 ID 完整且没有阻断中的持久任务。显式设置 `ONE_VEGETABLE_MUTATION_FLAGS` 可覆盖本地默认值，包括设为空值以关闭全部写能力。local-worker、扩展、staging 和 production 继续禁止真实商品上下架。
