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
