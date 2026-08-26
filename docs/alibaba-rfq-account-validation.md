# Alibaba RFQ 真实账号验证记录

## 2026-08-26

本次使用本地授权包执行只读探测，没有上传附件、提交报价或修改 Alibaba 数据。

| 方法                         | 结果              | requestId                              | 平台错误                                |
| ---------------------------- | ----------------- | -------------------------------------- | --------------------------------------- |
| `alibaba.icbu.rfq.myequity`  | permission-denied | `a1fe3c6c-f12a-41e3-b124-6219a1c5e8f3` | `11 / isv.permission-api-package-limit` |
| `alibaba.icbu.rfq.search`    | permission-denied | `2f0b099f-a90d-46f5-a4f8-570903862c86` | `11 / isv.permission-api-package-limit` |
| `alibaba.icbu.rfq.recommend` | permission-denied | `594d5d22-b467-415b-a546-c8b2519f3ae6` | `11 / isv.permission-api-package-limit` |

结论：当前 AppKey 没有 RFQ API 包权限。接口虽然被官方标记为开放平台免费 API，但仍要求应用授权；当前账号无法申请该权限，因此不能把 RFQ 真实功能标记为 `account-verified`。

## 当前产品行为

- 真实模式先调用 `alibaba.icbu.rfq.myequity` 做权限预检。
- 命中 `isv.permission-api-package-limit` 后停止搜索、推荐、详情和已读状态请求。
- 页面展示平台错误码和 traceId，允许用户手工重新检测。
- Mock 模式继续支持完整查询与报价演示。
- 本地报价草稿不出网；真实附件上传和提交报价在完成账号验收前统一禁用。

## 尚未验证

- `alibaba.icbu.rfqdetail.get`
- `alibaba.icbu.rfq.read`
- `alibaba.icbu.annex.upload`
- `alibaba.icbu.quotation.post`

前两个接口依赖搜索或推荐返回真实 RFQ ID；后两个属于 mutation，在读权限打通前不得尝试。

## 未来复测顺序

1. `alibaba.icbu.rfq.myequity`
2. `alibaba.icbu.rfq.search`
3. `alibaba.icbu.rfq.recommend`
4. 使用真实列表 ID 验证详情和已读状态
5. 经人工确认后，逐项开启附件上传和提交报价的 mutation flag

参考文档：

- [查询 RFQ](https://developer.alibaba.com/docs/api.htm?apiId=32084)
- [供应商提交报价](https://developer.alibaba.com/docs/api.htm?apiId=32101)
