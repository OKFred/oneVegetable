# 橱窗加入/移出：契约与受控真实验收

## 状态（2026-09-10）

新增能力目录和类型化契约：

- [alibaba.scbp.showcase.addproduct](https://open.taobao.com/api.htm?docId=40964&docType=2)：商品 ID 数组。
- [alibaba.scbp.showcase.deleteproduct](https://open.taobao.com/api.htm?docId=40963&docType=2)：**橱窗 ID** 数组，不是商品 ID，也不是删除商品。

官方 TOP 文档更新时间为 2021-11-18，标注开放平台免费、必须用户授权。快照来自 `getDocument.json` 的公开响应，不依赖 CI 实时访问。申请权限包与账号业务额度仍分别由平台控制。

两种内部 ID 数组都限制为 1–20 个唯一正十进制字符串，签名前仅对这两个方法转成 CSV；不改变其他接口的 JSON 数组传输。

**尚未完成真实写验收。** 普通 BFF/扩展的 `realCallEnabled` 保持 false，未加入已验收 mutation 白名单。Mock 调试器可以运行契约样本，但不代表真实账号可用。

## 真实预检结果

只读报告：`artifacts/showcase-mutation-real/476f5e06-0555-41a9-a1f2-418043357bc5.json`（本机忽略目录）。

| 检查            | 结果                             | requestId                            |
| --------------- | -------------------------------- | ------------------------------------ |
| showcase.status | contract-valid；总额度 2，已用 2 | b8d37c96-efc1-4e6e-bf33-10ee8ae2225a |
| showcase.list   | contract-valid；确实返回 2 条    | f86193e1-e16e-4040-a110-154687386cd1 |
| product.list    | 指定测试商品真实存在且 online    | 4918ba32-048d-4c6b-9609-6117c6277e4a |

同时在用户已登录的官方商品列表核对了相同商品 ID 与上架状态。没有在官方页面找到并验证橱窗管理入口，不宣称 UI 橱窗闭环通过。

首次只读尝试遇到未分类 GATEWAY_ERROR，未取得足够诊断，原因未确认；后续两次只读预检成功读取相同的满额状态。不是凭据或网络永久故障的证据。

**阻塞原因 `NO_FREE_SHOWCASE_SLOT`：未发送 addproduct/deleteproduct，没有修改已有橱窗或商品。** 若要继续，需用户明确允许临时腾出一个现有橱窗，并先设计原项恢复记录；当前脚本刻意不支持移除原有橱窗。

## 本地脚本

Windows PowerShell，只读预检默认开启：

```powershell
$env:ONE_VEGETABLE_SHOWCASE_PRODUCT_ID = '<刚在官方页面核对过的真实上架商品ID>'
pnpm exec tsx scripts/smoke-showcase-mutation-real.ts
```

只有用户已授权且有空位时，设置 `ONE_VEGETABLE_SHOWCASE_SMOKE=1` 后运行同一命令，执行一次加入、只读回读、移出本次新橱窗、恢复核对。当前满额账号不要开启。

- 使用本机忽略的授权包，凭据在进程内冻结，不传给页面。
- 指定商品须在最新第一页 100 条内、处于 online 且名称不含 dont-edit；不自动换选其他商品。
- 顺序执行；写入前原子保存意图，每次 mutation 仅一个请求，不自动重试。
- `.once` 文件防止同一目标被重复执行；不要为了重试直接删除它。异常时先检查对应报告与远端状态。
- 成功必须是契约匹配且 `result === true`，再分页确认唯一新橱窗 ID。空响应、超时、未知回执都不宣称成功；新增回执不明确时即使看到新条目也要求人工核对归属，不自动移出。
- 仅允许移出明确确认由本次新增的橱窗 ID，保留全部原有条目。读取失败、重复游标、结果不唯一均停止。
- 正常恢复确认目标不存在且原有条目仍存在，不声称共享测试账号的所有数据都没变化。
- 报告保留 requestId、traceId、阶段、必要恢复 ID 和脱敏错误；不保存 Token、完整响应、商品 XML 或图片。
- 进程崩溃后不自动恢复写入；保留现场交由人工核对。真实写闭环仍需后续账号验收，不能用本地单测代替。

本轮不合入 master、不部署 Worker、不提交商店版本。

## 本地回归

- `pnpm check`：格式、Lint（0 error，21 条既有 warning）、双语、OpenAPI/审计漂移、类型、883 项单测以及三端构建通过。
- Worker 仅 `deploy --dry-run`，没有远端部署；扩展解包 4,078,035 字节，未放宽 4,100,000 字节预算，商店合规检查通过。
- `pnpm exec playwright test --workers=2`：33 项 Web/正式扩展构建 E2E 通过，包含两种新接口的 Mock 调试器契约交互。
- 独立真实脚本额外执行 strict TypeScript 检查；上述自动测试不替代真实橱窗写入验收。
- 本机检查日志：`artifacts/showcase-mutation-real/check.log`、`e2e.log`。
