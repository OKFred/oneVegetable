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

## 初轮 Node / MV3 相同的结果（修复前）

| 模式             | 通过 | 合法空 | 权限不足 | 协议限制 | 范围保护 | 平台失败 |
| ---------------- | ---: | -----: | -------: | -------: | -------: | -------: |
| TOP              |   19 |      5 |        4 |        5 |        0 |        2 |
| IOP              |   21 |      1 |        0 |        9 |        1 |        1 |
| 双授权，TOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |
| 双授权，IOP 默认 |   25 |      5 |        4 |        0 |        0 |        1 |

IOP 视频未得到合法结果，两个关联检查不计为通过，因此该组共 33 项，其余组各 35 项。

权限不足按用户要求保留：RFQ 搜索/推荐/权益、供应商排名返回 isv.permission-api-package-limit。

初轮未通过项，不伪装成功：

- TOP 产品分：15 / -1。后续确认是本项目错误地发送明文 ID，而非已证实的平台故障；修复及重新验收见下。
- TOP 供应商列表：15 / isp.top-remote-connection-error，远程服务不存在。
- IOP 视频：10000002，illegal param error；按公开文档核对分页参数，并独立测试 page_size=10，仍被拒绝。TOP、双授权视频正常。

保留 IOP 图片跨分组保护 ALIBABA_IOP_PHOTO_SCOPE_MISMATCH。双授权图片使用 TOP，不修改图片分组 ID，不套用商品加解密。

## 后续整改与定点真实回归

- 官方 TOP [产品分文档](https://developer.alibaba.com/docs/api.htm?apiId=47461)要求混淆商品 ID。工作台先精确查询同一商品的列表摘要，取得接口返回的混淆 ID，再调用评分接口；不猜测加解密。IOP 仍直接使用明文 ID，只读调用不增加查询。
- 两个真实 TOP 样本使用正确标识后取得 3.9、4.6。随后 Node BFF、正式 MV3 均对 TOP 单授权、IOP 单授权及两种默认双授权完成精确商品查询和产品分检查，八组运行全部通过；TOP 评分最多两次只读请求，IOP 及双授权为一次。
- 通用调试器继续遵循 TOP 原始评分参数语义；双授权时不凭数字外观把混淆 ID 当作 IOP 明文 ID。工作台专用操作保持独立、明确的参数转换。
- 评分缺失、非法或负数不再伪造 0 分；显式返回的 0 分仍有效。精确查询无法取得匹配标识时停止评分，显示可翻译的稳定错误码。
- 供应商接口仍在公开 ICBU 目录中，未找到公开替代方法；目前仅证实本账号调用出现上游远程服务解析错误，不推断接口全局停用。缺少成功依据、缺失总数不再视为空列表，查询中或失败显示“数量未知”，明确成功且总数为零才显示 0。
- IOP 视频分别核对官方分页名称、POST 表单、JSON POST、GET，以及从 TOP 返回的真实视频 ID，均收到 10000002。外层 code=0、内层 result.msg_code 拒绝准确归为业务拒绝并保留 traceId，不能将 HTTP/外层成功冒充视频成功；没有证据支持改用私有参数或扩大 ID 转换。

定点回执为 bff-score-fixed.json、mv3-score-fixed.json；视频对照和 supplier UI 后续回执保存在同一忽略目录。初轮完整矩阵与后续定点回归分别记录，不能把旧矩阵计数改写为全功能新一轮通过。

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
