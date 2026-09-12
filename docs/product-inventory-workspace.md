# 2.8.0 商品库存只读工作区

状态：开发候选。没有部署 Worker、创建 Release 或提交商店。

## 使用

- 商品行的“库存”打开右侧抽屉；默认使用商品库存接口，可手工切换到 SKU 库存接口。
- “显示列”中勾选库存记录数、库存状态、库存查询时间后，按需顺序查询本页。
- “更多 → 查询所选库存”查询已选商品。可停止后续调度；已发出的读取请求完成后才处理其结果。
- 抽屉和列表共享仅驻内存的五分钟缓存，按运行模式、账号/凭据上下文、接口语言、商品和来源隔离。刷新库存绕过缓存；切换界面语言不改变接口语言。
- 空记录不表示库存为零；0 只显示平台明确返回的值。缺失值显示 —；不同库存编码、两套 API 结果不合计。库存编码不推断为仓库名称。
- 不调用旧商品详情或逐行 Schema，不新增库存写权限。

## 契约与边界

新增内部只读 operation `getProductInventory`，仍通过 POST `/operations/call` 和扩展 runtime message。
OpenAPI JSON 定义 `ProductInventoryRequest` / `ProductInventorySnapshot`，构建期生成类型及 standalone validators；底层复用既有两个能力的 AJV 校验。
必须显式业务成功且存在记录数组；错误码与成功标志冲突时不显示成功。响应漂移保留可解释记录及问题路径；不保存完整原始响应。
无法安全转换的数字 SKU ID 不变成错误字符串。重复组合、缺少 SKU/数量/库存编码均标记待核对。
两个真实读取接口均固定一次尝试，无自动重试；权限/会话/账号配置问题停止后续调度。

## 包体门槛

商店最终 ZIP 上限为 **1,500,000 字节（1.5 MB，十进制）**，超限时在写入发布文件前失败。
原有解包 4.1 MB、主线程启动资源、service worker 与 i18n 门槛保持不变。
通过共享重复 AJV 错误文本节省空间；未减少校验规则或错误信息，未引入运行时代码生成。

本地候选包：`artifacts/one-vegetable-v2.8.0-chrome-mv3.zip`，999,134 字节、140 个文件；解包 4,083,649 字节。
SHA-256：`a6356278fa77dfe1f3a01192a58b6f01d40884361c410bcc793b0d9cfb2deb26`。
候选包不是商店上架记录；2.7.0 及更早版本的 ZIP 未改动。

## 真实只读验证

2026-09-12 至 2026-09-13，使用忽略目录中的授权包；未创建或修改商品/库存。

- Node 原始能力：10 件现存商品 × 两个接口，全部契约有效且返回空数组。
- Node 新的专用 operation：抽样 1 件商品、两种来源，均返回 `no-data` 且无契约问题。
- 正式 MV3 构建：独立 Profile 中读取商品及两种库存；停止真实 service worker 后，再次读取成功，检查 `performance.timeOrigin` 已变化。
- 本地脱敏报告：`artifacts/product-inventory-real/`、`artifacts/product-inventory-extension-real/`；只记录状态、追踪码、数量和结构，不提交账号数据。

**尚未验证：真实账号的非空库存、SKU 维度含义和不同商品类型覆盖。** 当前样本均为空，不通过修改库存制造验收数据；非空、真实零值、异常结构先使用 `mock/data` 样本进行自动化验证。

可复现命令（Windows PowerShell，真实验收不进入 CI）：

```powershell
$env:ONE_VEGETABLE_INVENTORY_SMOKE='1'
pnpm exec tsx scripts/smoke-product-inventory-real.ts
pnpm exec tsx scripts/smoke-product-inventory-real.ts --dedicated --limit=1
pnpm exec tsx scripts/smoke-extension-inventory-real.ts
```

## 自动验证

覆盖请求出网前校验、平台业务失败、空数组、数量零值、精度丢失、重复记录、缓存隔离、停止调度、双语/暗色/窄屏、MV3 真正停止后重启与 BFF/Worker 回放。
CI 与 Mock 场景不请求真实 Alibaba；真实非空库存验收单独列为上述待办。

```powershell
pnpm check:openapi
pnpm check:i18n
pnpm typecheck
pnpm test
pnpm release:extension
# 扩展构建完成后再运行，不能与重建 .output 并行。
pnpm exec playwright test --workers=2
pnpm test:e2e:bff-replay
```
