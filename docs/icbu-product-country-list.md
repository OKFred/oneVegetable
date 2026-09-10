# 商品国家列表接入与只读验收

## 来源与范围

2026-09-10 用户提供 `alibaba.icbu.product.country.getcountrylist` 官方 TOP 文档全文，标签为“￥免费 / 必须用户授权”。未提供详情 docId 和更新时间，目录链接暂指向 TOP 文档入口，不猜测编号。未重新抓取全部目录；现为原 84 项国际站目录 + 2 项 TOP 补充。

该能力仅加入 API 能力调试器。请求不包含商品 ID，结果不能用于断言某件商品可售国家、物流可达性或运费。没有修改发品流程、语言偏好或任何真实写能力。

## 契约差异

- `country_request` 必填对象，`language` 可选字符串。curl 示例 `country_request=-` 无效，按参数表实现；当前真实验证值为 `zh_cn`，其他语言尚未验收，不臆造枚举。
- 既有签名器发送 `simplify=true`。真实 `data` 和 `country_list` 是数组；文档 JSON 则分别包装为 `continent_d_t_o` / `country_d_t_o`。override 兼容两种完整结构，不改其他 API 序列化行为。
- 文档示例的 `biz_success=true` 与 `SYS_ERROR` 冲突，Mock 成功样本移除错误信息，失败样本单独保留。契约有效不等于业务成功，调试器保留 biz_success、msg_code、message 和 trace_id。
- 样本统一位于 `mock/data/product-country-list.json`，真实错误不回退 Mock。

## 真实账号验收

使用本机忽略目录中的完整授权包，发送两个顺序只读请求，均携带 session，maxAttempts=1；没有商品或图库 mutation。

1. 首次 requestId `ba0eec09-b735-46cb-94ee-dbe553c5888a`：biz_success=true，但 data 数组与文档包装契约不匹配。保留脱敏报告，不把契约漂移当作完全通过。
2. 修复后 UTC `2026-09-10T02:37:41.199Z`，requestId `556960d1-6508-4508-9a3a-4213c1b46c1f`，平台 traceId `15qx0xfl3e3g3`：biz_success=true、contractValid=true、无 msg_code；8 个分组、281 条国家条目。包括热门国家，因此条目数不是去重国家数量。

仅新增本方法的 account-verified/passed 记录；快照更新时间不表示其他历史方法被重新验收，也不保证其他 AppKey 拥有同样权限。真实验收发生在本地 Node 网关；不是已部署 Worker 或已安装商店插件的真实验收。

## 调试与复查

在 API 能力搜索完整方法名，使用 `{"country_request":{"language":"zh_cn"}}`。需要有效授权凭据，结果只读展示，不写入商品。

受控脚本 `scripts/smoke-product-country-real.ts` 需显式 `ONE_VEGETABLE_COUNTRY_SMOKE=1`；默认读取 `artifacts/openapi-auth/credentials.json`，可用 `ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE` 指定。报告保存在忽略目录 `artifacts/product-country-real/`，只含状态、计数、契约告警及 requestId/traceId，不保存凭据或完整响应。

后续可实现按接口语言缓存的国家选择器，保留热门分组与国家代码去重逻辑；必须仍尊重业务 Schema 自带的枚举和约束。
