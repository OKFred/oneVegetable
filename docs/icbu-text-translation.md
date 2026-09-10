# ICBU 文本翻译

本轮仅接入 API 能力调试器中的 `alibaba.icbu.text.trans`，不自动修改商品、翻译详情或切换界面/接口语言。其他发现的方法（语种识别、识别并翻译、铺货查询、库存及物流确定性）只作为后续候选，未检查完整契约与权限，不标记为已接入。

## 文档及准入

- 来源为用户于 2026-09-10 提供的 [TOP docId=67157](https://open.taobao.com/api.htm?docId=67157&docType=2) 全文，包含“ICBU－商品”“￥免费”“不需用户授权”和“ICBU翻译能力”权限组。未独立访问官方网页；更新时间未提供，保留 null。
- 补充审计单独存于 `alibaba-api-supplements.json`；原 84 项国际站目录快照加本次 1 项 TOP 补充，不代表目录全量重审。`audit:apis --offline` 只合并已记录证据，CI 不联网。
- 免费和不需用户 session 不等于任意 AppKey 都能调用；请求仍需要 AppKey/AppSecret 签名。工作台现有登录及凭据配置要求不变，本轮不扩展无 Token 的保险库初始化流程。
- 参数表的 `icbu_translate_task_dto` 是数组，Java 示例是单对象；采用数组并记录差异。未取得权限前，不能宣称平台已验收数组序列化或业务场景 app_name。
- `app_name` 必填，是翻译业务场景标识，不保证等于应用展示名称。调试示例是占位值，不能照搬 `xiaoman`；需要平台确认可用的场景。`query` 只允许 text，其他列出的业务支持 text/html。未捏造文档未给出的字符和批量数量上限。

## 使用与结果

在 API 能力搜索完整方法名，打开详情，修改请求示例中的 app_name、原文及源/目标语种后调用。响应保持逐项 success/error_code/trace_id；HTTP 成功或 contractValid 仅表示传输/契约有效，不表示翻译业务成功。HTML 译文按 JSON 文本展示，不执行、不写入商品。

Mock 与测试样本位于 `mock/data/text-trans.json`。真实模式拒绝时不回退 Mock，不更换 AppKey、伪造场景或尝试绕过权限。

## 当前账号验收

2026-09-10 使用本机授权包，仅发送一条非敏感测试文本 `A cotton T-shirt.`（en → es），不发送 session、不自动重试。平台返回：

```text
requestId: 0c0879bb-326f-4b52-9973-3c7225491c85
code: 11
subCode: isv.permission-api-package-limit
```

结论：当前应用缺少对应 API 包权限，未取得译文，verification 保持 documented。需到开放平台应用权限管理核对“ICBU翻译能力”，获得权限并确认 app_name 后再验收；不自动申请权限或接受协议。

能力页的账号验收快照新增本条 permission-denied 结果；其他方法沿用历史记录，本次快照更新时间不代表重新验收了全部方法。

受控复查命令：设置 `ONE_VEGETABLE_TEXT_TRANS_SMOKE=1` 后运行 `pnpm exec tsx scripts/smoke-text-trans-real.ts`。可通过 `ONE_VEGETABLE_TRANSLATION_APP_NAME` 指定已确认业务场景；未指定时仅尝试授权包的应用名，并在报告标记未确认。授权文件可用 `ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE` 指定。脱敏报告仅保存到忽略目录 `artifacts/text-trans-real/report.json`，失败退出非零，不记录密钥或 Token。
