# 交易 / 订单域

检查日期：2026-08-13。

## 边界

- 官方交易分类当前列出 27 个方法；其中 `alibaba.seller.order.get` 明确要求聚石塔内调用，只进入排除快照，不生成可调用能力。
- 其余 26 个方法均已生成请求/响应 OpenAPI 契约、方法关联 TypeScript 类型和 CSP 安全 standalone validator。
- 8 个合作方或额外资格方法默认受限；12 个写方法在扩展中全部关闭，取得真实账号并逐方法完成 smoke test 后才可解锁。
- 官方订单列表文档将页码定义为从 0 开始，适配器把界面的一起始页转换为 `start_page = page - 1`，并将 `page_size` 限制为最多 100。
- 文档只把订单日期描述为“美国时间”，未指明具体时区。因此应用不做猜测式换算，并在稳定响应中返回 `documentTimeZoneUnverified: true`。

## 订单工作台

- 订单列表使用 `alibaba.seller.order.list`。
- 聚合详情并行组合 `alibaba.seller.order.fund.get` 与 `alibaba.seller.order.logistics.get`。任一接口失败只将对应区块标为不可用，不丢弃其他结果。
- 完整详情固定显示 `fullDetail: jushita-only`，不会用 Mock 字段冒充真实返回。
- 资金与履约区提供履约通道、服务费率和按订单读取的 TT 汇款信息。
- 地址区把官方动态表单 Schema 转为声明式字段，并提供地址簿读取；邮箱、地址和 TT 账号数据只保留在当前页面内存，不写入 localStorage 或 `chrome.storage`。
- 信保订单草稿可在 Web Mock 演示；扩展中的创建、修改、地址保存与删除仍由 service worker 的 mutation gate 拦截。

## 离线输入

- `config/alibaba-trade-category.json`：官方交易分类方法清单。
- `config/alibaba-trade-overrides.json`：风险分类与异常示例的人工修正。
- `docs/alibaba-trade-api-docs.json`：26 个可类型化方法的官方文档离线快照。
- `docs/alibaba-trade-api-exclusions.json`：聚石塔专用排除项。

更新快照使用 `pnpm snapshot:trade-docs`，该命令只在人工审计时执行，CI 不访问实时文档站。
