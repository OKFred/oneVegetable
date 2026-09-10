# 橱窗加入/移出：契约与受控真实验收

## 当前状态（2026-09-11）

真实 API 加入、移出及原商品恢复闭环已通过，详见文末的复测记录。普通 BFF/扩展的真实调用策略仍未开放这两个方法：本轮验收只通过显式 opt-in 的独立脚本执行，不代表已经提供专用橱窗管理界面。

## 契约与初次预检（2026-09-10）

新增能力目录和类型化契约：

- [alibaba.scbp.showcase.addproduct](https://open.taobao.com/api.htm?docId=40964&docType=2)：商品 ID 数组。
- [alibaba.scbp.showcase.deleteproduct](https://open.taobao.com/api.htm?docId=40963&docType=2)：**橱窗 ID** 数组，不是商品 ID，也不是删除商品。

官方 TOP 文档更新时间为 2021-11-18，标注开放平台免费、必须用户授权。快照来自 `getDocument.json` 的公开响应，不依赖 CI 实时访问。申请权限包与账号业务额度仍分别由平台控制。

两种内部 ID 数组都限制为 1–20 个唯一正十进制字符串，签名前仅对这两个方法转成 CSV；不改变其他接口的 JSON 数组传输。

初次预检时尚未完成真实写验收。普通 BFF/扩展的 `realCallEnabled` 保持 false，未加入通用 mutation 白名单。Mock 调试器可以运行契约样本；真实账号通过情况单独记录，不能用 Mock 代替。

## 真实预检结果

只读报告：`artifacts/showcase-mutation-real/476f5e06-0555-41a9-a1f2-418043357bc5.json`（本机忽略目录）。

| 检查            | 结果                             | requestId                            |
| --------------- | -------------------------------- | ------------------------------------ |
| showcase.status | contract-valid；总额度 2，已用 2 | b8d37c96-efc1-4e6e-bf33-10ee8ae2225a |
| showcase.list   | contract-valid；确实返回 2 条    | f86193e1-e16e-4040-a110-154687386cd1 |
| product.list    | 指定测试商品真实存在且 online    | 4918ba32-048d-4c6b-9609-6117c6277e4a |

同时在用户已登录的官方商品列表核对了相同商品 ID 与上架状态。没有在官方页面找到并验证橱窗管理入口，不宣称 UI 橱窗闭环通过。

首次只读尝试遇到未分类 GATEWAY_ERROR，未取得足够诊断，原因未确认；后续两次只读预检成功读取相同的满额状态。不是凭据或网络永久故障的证据。

当日阻塞原因为 `NO_FREE_SHOWCASE_SLOT`：未发送 addproduct/deleteproduct，没有修改已有橱窗或商品。2026-09-11 用户明确允许临时腾位并恢复，脚本才增加了显式指定原橱窗 ID 的受控替换模式。

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
- 默认模式仅允许移出明确确认由本次新增的橱窗 ID；文末的显式替换模式额外允许临时移出指定原项并恢复。读取失败、重复游标、结果不唯一均停止。
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

## 2026-09-11 受控替换与独立回读

用户明确允许临时腾出一个现有橱窗，完成测试后恢复原商品展示。原项及恢复 ID 只写入本机忽略报告，不修改商品内容或上架状态。

- 第一轮移出已实际生效，但脚本只识别带 `_response` 包装的响应，误判了 `simplify=true` 的精简 JSON。恢复流程随即重新加入原商品并回读确认，未继续加入测试商品。
- 修复为同时支持包装与精简格式，依然要求 AJV 通过且 `result === true`。报告增加响应**结构**和契约问题，不保存完整响应。
- 后续两次只读预检遇到 `fetch failed`，均未发出 mutation。原生 Node HEAD 探测得到 `ETIMEDOUT`/`ENETUNREACH`；系统 HEAD 请求成功。仅在本机进程增加 IPv4 优先及 2000ms 地址族连接尝试时间后，原生请求和真实验收成功。这是本次网络环境的复测结果，不是所有部署环境都需要此参数的结论。

成功报告：`artifacts/showcase-mutation-real/ea2fe90a-e97d-4ac8-9dda-f621acf461b9.json`。

| 阶段           | requestId                            | 结果                         |
| -------------- | ------------------------------------ | ---------------------------- |
| 临时移出原商品 | 1ac9f217-0865-439f-ac63-b53272996770 | 明确成功，回读确认           |
| 加入测试商品   | 1e2a4343-0309-4f35-8f95-c45150db0911 | 明确成功，回读确认唯一新橱窗 |
| 移出测试商品   | 8ca6e9c1-a56f-4b29-910b-2623f60df6a5 | 明确成功，回读确认           |
| 恢复原商品     | 417fa633-d580-4d57-ab50-e98f1d9e67ef | 明确成功，回读确认           |

四项回执都为 contract-valid，真实响应结构为 `{ result: boolean, request_id: string }`。每项 mutation 恰好发送一次，无自动重试。第一轮故障及恢复另留 `0f49dd98-fec7-44e5-bad6-1f14b48d83f8.json`，未覆盖或删除。

独立只读验证报告：`ea2fe90a-e97d-4ac8-9dda-f621acf461b9-verification.json`。确认原两件橱窗商品均在，未测试的原项橱窗 ID 不变，测试商品不在橱窗内；原商品 Schema SHA-256 与开始前一致；原商品和测试商品仍为 online。恢复原商品的橱窗 ID 发生变化，符合事先告知。

显式替换模式需同时设置两个环境变量，不能删除 `.once` 绕过旧任务防重复标记：

```powershell
$env:ONE_VEGETABLE_SHOWCASE_PRODUCT_ID = '<本次测试商品ID>'
$env:ONE_VEGETABLE_SHOWCASE_REPLACE_WINDOW_ID = '<刚核对的原橱窗ID>'
$env:ONE_VEGETABLE_SHOWCASE_SMOKE = '1'
# 本次本机网络使用的进程级参数，不修改系统设置：
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2000'
pnpm exec tsx scripts/smoke-showcase-mutation-real.ts
```

独立验证仅发只读请求：

```powershell
pnpm exec tsx scripts/verify-showcase-recovery-real.ts '<已完成的runId>'
```

替换执行器覆盖正常四步恢复、腾位拒绝、测试加入拒绝后恢复、未知加入不猜测归属、移出回执未知但回读确认后的恢复，以及恢复失败不重发。凭据在进程内冻结，不跟随界面切换；读到橱窗基线变化时停止而不操作其他项。

本地工作台使用既有 SQLite 和真实授权包，`meta/get` 确认 `local-node + real`；服务保留在 5173/8787。浏览器中核对了已登录的真实商品列表；没有增加专用橱窗页面，也没有开启调试器的真实写按钮。
