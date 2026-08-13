# 数据与供应商洞察域

检查日期：2026-08-13。

## 边界

- 本领域纳入 2 个数据接口和 2 个采购供应商接口，均来自免费、非聚石塔目录，并生成请求/响应 OpenAPI 契约、方法关联 TypeScript 类型和 CSP 安全 standalone validator。
- `alibaba.icbu.diagnostic.supplier.rank.getpercent` 返回当前供应商的全站排名百分比时间序列。官方只定义了日期和 `percent`，未定义前端趋势结论，因此页面不生成“提升”“下降”或经营评级。
- `alibaba.procurement.mysupplier.list` 返回曾经下过信保订单的加密供应商 ID；官方不返回公司名称，页面不会用 Mock 或第三方信息补造。
- `alibaba.procurement.supplier.items.get` 使用加密供应商 ID 查询历史下单商品。官方页码从 0 开始，适配器把界面第 1 页转换为 `page_index = 0`。
- 商品、类目、属性和供应商 ID 均按字符串保留，避免超出 JavaScript 安全整数范围。

## CGS 小满限制

`alibaba.mydata.self.query.cgsokk` 虽然标记为开放平台免费且不需要用户授权，但接口名称与说明明确限定 CGS 小满签约客户，并要求额外业务 `app_secret`：

- 能力保留在类型化目录和 Mock 契约中，标记为受限、默认关闭。
- 专用页面不提供调用按钮，也不提供 `app_secret` 输入框。
- 通用调试入口由 service worker 在请求校验前阻止，参数不会发送到 Alibaba 网关。
- 文档示例中的密钥样式内容已在离线 override 中替换为占位符。

## 验证边界

- Web Mock 覆盖排名、供应商分页、历史商品和受限能力说明。
- MV3 E2E 验证受限方法即使收到完整请求参数也会由 service worker 阻止。
- 当前没有真实国际站账号，普通三个只读接口处于“文档验证”，不宣称完成账号级验收。

## 离线输入

- `config/alibaba-insights-category.json`：4 个目标方法清单。
- `config/alibaba-insights-overrides.json`：嵌套响应修正、Mock examples 和 CGS 资格限制。
- `docs/alibaba-insights-api-docs.json`：官方文档离线快照。
- `docs/alibaba-insights-api-exclusions.json`：当前为空，保留统一生成结构。

更新快照使用 `pnpm snapshot:insights-docs`。该命令仅在人工审计时执行，CI 不访问实时文档站。
