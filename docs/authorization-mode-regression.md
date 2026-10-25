# 授权组合回归验收（2026-10-26）

基线 2.18.1，分支 codex/authorization-mode-regression。远程 Windows 开发和验收，未改日常授权、默认协议或业务数据。

## 实际检查

Node BFF 使用内存 SQLite、真实会话和实际路由；正式 MV3 使用独立加密 Profile。候选副本移除 Refresh Token，网络层只允许固定公开只读方法；无业务写入、跨协议失败重试或 Mock 回退。

每个运行时共 138 项检查、418 次平台读取，最终网络越界数为 0。包括商品、Schema、类目/分组、评分、库存、图片、视频、橱窗、销售/采购订单、RFQ、物流模板、洞察和五项原生 IOP 查询。写操作仅做现有隔离测试。

正式插件还实际打开每种配置的 14 个工作台菜单，共 56 次页面检查：均加载到对应工作区、没有未捕获脚本错误，原授权及默认配置不变。只读 RPC 由页面实际触发，不把首次引导页面当作菜单验收；IOP 视频失败及图片范围保护仍单独记录。

## 修复

- 上下文接口保留稳定 GatewayException 错误码，不再统一变成 GALLERY_CONTEXT_UNAVAILABLE，不回显内部消息。仅 TOP 访问 IOP 原生能力准确提示 ALIBABA_IOP_AUTHORIZATION_REQUIRED，且不出网。
- 树读取失败时停止新子项、等待已发出请求结束，防止迟到请求。商品分组子项并发限制为 4。
- 补上下文端点、树生命周期和独立只读网络门回归；修正参考验收脚本的泛型收窄。

## Node / MV3 相同的结果

| 模式             | 通过 | 合法空 | 权限不足 | 协议限制 | 范围保护 | 平台失败 |
| ---------------- | ---: | -----: | -------: | -------: | -------: | -------: |
| TOP              |   19 |      5 |        4 |        5 |        0 |        2 |
| IOP              |   21 |      1 |        0 |        9 |        1 |        1 |
| 双授权，TOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |
| 双授权，IOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |

IOP 视频未得到合法结果，两个关联检查不计为通过，因此该组共 33 项，其余组各 35 项。

权限不足按用户要求保留：RFQ 搜索/推荐/权益、供应商排名返回 isv.permission-api-package-limit。

未通过的平台项，不伪装成功：

- TOP 产品分：15 / -1，通用验证失败；同一商品通过 IOP 可读。
- TOP 供应商列表：15 / isp.top-remote-connection-error，远程服务不存在。
- IOP 视频：10000002，illegal param error；按公开文档核对分页参数，并独立测试 page_size=10，仍被拒绝。TOP、双授权视频正常。

保留 IOP 图片跨分组保护 ALIBABA_IOP_PHOTO_SCOPE_MISMATCH。双授权图片使用 TOP，不修改图片分组 ID，不套用商品加解密。

## 重跑

输入、输出均必须位于远程忽略目录。以下占位符换成实际值：

```powershell
pnpm exec tsx scripts/smoke-authorization-modes-real.ts --top=artifacts/local-dual-authorization/top-credentials.json --iop=artifacts/local-dual-authorization/iop-credentials.json --product-id=<ID> "--prediction-title=<unbranded description>" --output=artifacts/authorization-mode-regression/<new-receipt>.json --confirm-read-only --confirm-same-merchant
```

正式插件使用 smoke-authorization-modes-extension-real.ts，同参数。加 --ui-only 逐菜单检查；仅副本预授权网关域名，不改生产 Manifest，不宣称覆盖原生权限弹窗。

可用 "--modes=top-only,iop-only"、"--probes=products-exact,product-score,videos,suppliers" 明确复查；PowerShell 含逗号参数须加引号。失败仍返回非零退出码，不通过更换分类隐藏问题。

```powershell
pnpm exec tsc --noEmit -p scripts/test/tsconfig.authorization-mode-regression.json
pnpm exec vitest run scripts/authorization-mode-regression.test.ts packages/core/test/product-tree-read-lifecycle.test.ts apps/api/test/dual-authorization.test.ts
```

回执在远程 artifacts/authorization-mode-regression/，不提交 Git。无密钥或完整业务响应，只有检查状态、requestId、方法/协议、计数和脱敏错误。测试 Profile 不管理用户日常浏览器页面。
