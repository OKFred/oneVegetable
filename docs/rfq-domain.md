# RFQ 领域契约与验证边界

检查日期：2026-08-12。

RFQ 领域以 `docs/alibaba-rfq-api-docs.json` 为离线生成输入，以 `openapi/one-vegetable.json` 为应用、Mock、扩展消息和 DTO 的唯一运行时契约。官方 RFQ 分类当前共纳入 7 个方法：

- `alibaba.icbu.rfq.search`：RFQ 市场搜索。
- `alibaba.icbu.rfq.recommend`：推荐 RFQ。
- `alibaba.icbu.rfqdetail.get`：RFQ 详情。
- `alibaba.icbu.rfq.read`：最多 20 个 RFQ ID 的已读状态。
- `alibaba.icbu.rfq.myequity`：报价权益与市场表现。
- `alibaba.icbu.annex.upload`：报价附件上传；方法名不含 RFQ，但属于官方 RFQ 分类。
- `alibaba.icbu.quotation.post`：提交报价。

原始接口响应在 `RfqAdapter` 中转换成稳定的 `RfqSummary`、`RfqDetail`、`RfqPage`、`RfqEquity` 和 `RfqReadStatus`。页面不解析 Alibaba 的响应包装、嵌套 `result` 或 JSON 字符串。

Web Mock 支持搜索、推荐、查看详情、读取权益、保存/恢复报价草稿、附件上传和提交报价。扩展中只有五个查询方法允许真实调用；附件上传和提交报价属于 mutation，仍在 service worker 出网前统一拒绝。当前没有国际站账号，因此这些能力只标记为“文档验证”，不代表账号权限、响应字段或真实写链路已验收。
