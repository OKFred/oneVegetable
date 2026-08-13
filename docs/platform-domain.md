# 平台协作能力与安全边界

## 范围

本迭代收尾了审计目录中原先归为 `other` 的 3 个免费、非聚石塔方法，并统一归为
`platform`：

- `alibaba.icbu.file.urlposting.upload`：普通文件转存。
- `alibaba.icbu.risk.send`：天鹿风控事件校验。
- `alibaba.icbu.task.status.notify`：URL 爬取任务状态回调。

官方文档快照保存在 `docs/alibaba-platform-api-docs.json`，人工语义修正在
`config/alibaba-platform-overrides.json`。`openapi/one-vegetable.json` 继续作为运行时唯一契约，生成
`PlatformCapabilityRequestMap`、`PlatformCapabilityResponseMap` 和 CSP 安全的 standalone validators。

完成本迭代后，审计快照中的 84 个候选方法均具有非空请求/响应 Schema。这里的“类型化”只表示文档
契约、Mock 和门禁已完成，不表示受限能力已获得业务资格或通过真实账号验收。

## 文件转存与图库的区别

`alibaba.icbu.file.urlposting.upload` 只返回普通文件 URL，不返回国际站图库（图片银行）`fileId`。
因此它保留在通用能力目录，但不会用于商品主图、SKU 图或详情图入库。图库 URL 转存仍由 service
worker 安全下载后调用 `alibaba.icbu.photobank.upload`。

该接口会产生文件写入，因此风险类型为 `mutation`。Web Mock 可验证契约；扩展中的真实调用在账号
smoke test 前关闭。

## 协议型能力

### 天鹿风控

风控请求可能包含 WUA、UMID、IP、IMEI、IMSI、UA 和 MAC 等环境信息。本项目不从页面采集这些
字段，不保存这些字段，也不向通用调试入口提供可编辑发送表单。能力定义只展示经过控制的只读文档
示例。

### 任务状态通知

任务通知是 URL 爬取供应商向平台回报任务状态的协议回调，需要真实 `task_key`、ISV 身份和任务
上下文，不是卖家交互能力。没有专用服务端集成时始终禁止调用。

两项协议能力都标记为 `restricted + mutation + documented`，Web 与扩展界面都不提供调用按钮；
service worker 会再次执行门禁，防止绕过界面直接发送 runtime message。

## 验证边界

当前无国际站账号。本迭代验证离线快照、严格 validator、Mock 响应、通用调试器只读展示和 MV3
service worker 门禁，不代表平台协作协议已完成真实接入。
