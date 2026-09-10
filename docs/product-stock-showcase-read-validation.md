# 商品库存与橱窗只读接入

检查日期：2026-09-10。五项仅进入 API 能力目录及通用调试器，不增加专用页面、库存修改或橱窗维护操作。

## 文档与准入

使用 `audit-top-api.ts` 获取的 TOP `getDocument.json` 官方参数表和 `rspSampleSimplifyJson`，保留文档更新时间。五项均标注免费/开放平台免费 API、必须用户授权，未标注聚石塔限制；收费标签不代表任意应用都已获得权限。

| 方法                                      | 官方详情                                                          | 当前账号结果                        |
| ----------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| `alibaba.icbu.product.type.available.get` | [发品类型](https://open.taobao.com/api.htm?docId=62123&docType=2) | passed：返回询盘品/下单品支持标志   |
| `alibaba.icbu.product.inventory.get`      | [商品库存](https://open.taobao.com/api.htm?docId=64125&docType=2) | no-data：success=true，库存数组为空 |
| `alibaba.icbu.product.sku.inventory.get`  | [SKU 库存](https://open.taobao.com/api.htm?docId=57873&docType=2) | no-data：success=true，库存数组为空 |
| `alibaba.scbp.showcase.list`              | [橱窗列表](https://open.taobao.com/api.htm?docId=40938&docType=2) | passed：返回 2 项                   |
| `alibaba.scbp.showcase.status`            | [橱窗状态](https://open.taobao.com/api.htm?docId=40936&docType=2) | passed：返回总量/已用数量           |

五项契约校验通过，无权限拒绝。本次仅抽查商品列表首批返回的一件有效商品，不能推断全部商品均无库存；库存非空真实响应尚未验收，使用官方示例覆盖嵌套数组类型。发品类型查询结果也不等于实际发布已经获准。

## 受控验证

Windows PowerShell：

```powershell
$env:ONE_VEGETABLE_STOCK_SMOKE='1'
pnpm exec tsx scripts/smoke-product-stock-showcase-real.ts
```

默认读取忽略目录内的 `artifacts/openapi-auth/credentials.json`；不读取网站密码，不在控制台回显任何凭据。

- 先调用一次商品列表，再使用实际商品 ID/类目；没有前置数据时跳过库存查询。
- 五项顺序执行，间隔 350ms，`maxAttempts=1`；只有只读调用。
- ID 支持安全整数或十进制字符串，不用虚构 ID 实测，不截断超长整数。
- 每项结束写入独立 UUID 报告；只存 requestId、traceId、结果、契约问题和结构类型，不保存商品标题、ID、原图或完整响应。
- `biz_success/success` 缺失、错误码与成功冲突，不归为成功；HTTP 200 或契约有效本身不代表业务成功。
- 本次报告：`artifacts/product-stock-showcase-real/da91c93e-29f8-4f37-995b-ff198c626b9f.json`，时间 `2026-09-10T06:40:47.891Z`。
- 账号核验快照新增这五项；旧项不是本次全部重测。翻译接口之前的权限拒绝保持不变。

实际验收路径是 Windows Node 共享网关；正式扩展/Worker 上的真实调用未在本轮重复验收。没有部署、上架或 Alibaba mutation。

## 校验生成器包体优化

新增五项后未压缩扩展为 4,130,922 bytes，超出原有 4,100,000 bytes 门槛。AJV standalone 设置 `loopRequired: 4`，将四项及以上必填规则生成循环而非展开重复错误分支；不减少规则、不关闭 allErrors、不使用运行时代码生成。优化后扩展 4,067,964 bytes，启动 JS 126,479 bytes，未放宽预算或修改权限。另有 16 种必填字段子集测试验证缺失字段仍全部报告。

## 自动回归结果

- `pnpm check`：通过；196 个测试文件、879 个测试，包含格式、Lint、中英文键、OpenAPI/审计漂移、类型检查、Web/Worker dry-run/扩展构建与商店合规。Lint 保留原有 21 项 warning，无 error。
- `pnpm exec playwright test --workers=2`：32 项通过；五项新能力均可搜索、打开详情和调用 Mock 契约。修复测试中未关闭详情抽屉及写死 9 页的断言，分页预期由实际目录数量计算。
- `pnpm test:e2e:bff-replay`：2 项通过；隔离本地 D1、Worker、登录、跨领域 Replay 和写操作拒绝。不是云端真实验收。
- 本地日志位于 `artifacts/top-api-audit/check-stock-final.log`、`e2e-stock-final.log`、`e2e-bff-stock.log`。
