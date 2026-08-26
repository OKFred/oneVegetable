# Mock 数据边界

该目录是 Web 演示、组件测试和端到端测试所用业务样例的唯一数据源。它不包含真实账号响应，也不会在
`real` 网关失败时作为静默回退。

- `products.json`：商品、类目、Schema 发品和质量评分。
- `product-description-templates.json`：中英文内置商品详情模板；它们是发布包内的起始内容，不是接口响应，使用前必须将占位内容替换为真实信息。
- `product-schema/`：脱敏、最小化的 Schema XML 布局与官方提示回归样例，不保存完整真实商品 XML。
- `photos.json`：图库（图片银行）分组与素材。
- `rfqs.json`：RFQ 搜索、详情、权益和报价演示。
- `trades.json`：交易订单、资金、物流和地址。
- `logistics.json`：OneTouch 物流演示。
- `insights.json`：数据洞察演示。
- `system.json`：旧订单组合视图等跨领域演示数据。

修改 JSON 后运行：

```powershell
pnpm generate:mock-data
```

生成结果位于 `packages/core/src/generated/mock-data.ts`；内置详情模板单独生成到
`packages/core/src/generated/product-description-templates.ts`，避免扩展只用模板时引入全部演示响应。生成物会通过
TypeScript 对照共享契约检查结构。
`pnpm generate:check` 会阻止源数据与生成结果发生漂移。不要手工编辑生成文件。

OpenAPI 中的官方请求/响应 examples 继续用于契约、validator 和 documentation replay，不属于此目录的
UI Mock 数据，不能为了消除 Mock 而从契约中删除。
