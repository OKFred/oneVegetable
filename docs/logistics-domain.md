# 国际物流域

检查日期：2026-08-13。

## 边界

- 官方国际物流分类当前纳入 14 个 OneTouch 方法；另把商品域的 `alibaba.wholesale.shippingline.template.list` 作为跨域只读能力纳入，共生成 15 组请求/响应契约、方法关联 TypeScript 类型和 CSP 安全 standalone validator。
- `alibaba.onetouch.logistics.express.logistics.rule.validate` 与 `alibaba.onetouch.logistics.express.order.cancel` 在官方分类中标记为暂停使用，因此保留类型和文档记录，但生命周期为 `deprecated`。
- `alibaba.onetouch.logistics.express.order.list.query` 的官方说明明确面向 ISV；其余 OneTouch 方法也依赖一达通业务资格。没有真实账号可验证，因此 14 个方法全部标记为受限并默认关闭。
- 运费模板接口不属于 OneTouch，维持普通免费只读能力；它仍通过 service worker 请求，页面不接触密钥。

## 稳定模型与工作台

- 地址使用省、市、区县和街道四级类型化查询，适配器按层级选择官方方法和参数名。
- 货品、包裹、海关、收发件人和试算结果转换为稳定内部 DTO。金额、尺寸、重量、数量和业务 ID 使用字符串，避免 JavaScript 浮点精度或长整型截断。
- 运费试算在出网前执行 standalone AJV 校验，并将 DTO 转为官方 `paramn_query` 嵌套结构。
- 下单前再次校验确认的运力产品代码必须与最近试算一致；真实创建属于 mutation，账号 smoke test 前保持关闭。
- 物流订单支持分页、详情、追踪号和面单。面单明确区分 HTTPS 地址和 Base64 内容，不将 Base64 或收发件个人信息写入页面持久化存储。
- Web Mock 覆盖完整试算、地址查询、订单详情与下单流程；扩展界面不会自动发起 OneTouch 查询，相关按钮显示业务资格待验收状态。

## 离线输入

- `config/alibaba-logistics-category.json`：官方物流分类方法与跨域运费模板清单。
- `config/alibaba-logistics-overrides.json`：风险、资格限制、暂停状态和异常示例的人工修正。
- `docs/alibaba-logistics-api-docs.json`：15 个类型化方法的官方文档离线快照。
- `docs/alibaba-logistics-api-exclusions.json`：当前为空，保留统一生成结构。

更新快照使用 `pnpm snapshot:logistics-docs`。该命令仅在人工审计时执行，CI 不访问实时文档站。
