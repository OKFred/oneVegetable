# Meta Facebook 真实发布验证记录

## 2026-09-01

本次通过本地 Web、Node BFF 和 Meta Graph API 向测试 Page `OneVegetable Test` 执行且仅执行一次单图发布。没有发布到个人主页或 Instagram，没有自动重试，也没有自动删除帖子。

## 验证输入

- 来源：Alibaba 国际站真实图库。
- 素材：`AI_IMG.jpg`，内容为豆沙粉男士连帽运动套装。
- 文案标记：`[oneVegetable-smoke-20260901]`。
- 目标：Facebook Page `OneVegetable Test`。
- 发布任务尾号：`56d5d496`。

文案根据图片内容生成，并明确注明用于 Facebook Page 单图发布链路验证。

## 验证结果

- Meta API 返回明确成功状态。
- 平台发布 ID：`1364867756699027_122102832039456929`。
- [Facebook 页面回读](https://www.facebook.com/61593707893731/posts/122102832039456929/)显示正确 Page、相同 smoke 标记、完整文案和运动服图片。
- 页面回读发生在发布后约 1 分钟，帖子可见性为公开。
- 未发生重复发布、Instagram 写入或自动清理。

## 现场发现与整改

Alibaba CDN 对该素材返回 `Content-Type: image/jpeg` 和 `.jpg` 文件名，但下载字节具有标准 PNG 文件头。旧逻辑把响应头与文件头不一致直接视为错误，导致发布在创建任务前中止。

整改后，资源下载层以文件头识别出的真实格式为权威值，并同时执行以下约束：

- 实际格式必须位于图库支持白名单。
- 文件名扩展名按实际格式规范化。
- 文件大小、Base64 长度和 SHA-256 仍按实际字节计算。
- 上层继续复核网关返回的格式与文件头，避免非规范适配器绕过校验。

修复提交：`c7f30f6 fix(media): normalize gallery image content types`。

## 自动检查

- 针对资源下载和社交分享的 24 项测试通过。
- 全 workspace TypeScript 检查通过。
- 推送前全量测试：153 个测试文件、645 项测试全部通过。

## 尚未验证

- Instagram Business/Creator 专业账号 OAuth 与目标发现。
- Instagram media container 创建、状态轮询和最终发布的真实平台行为。
- Cloudflare Worker + R2 路径下的真实 Meta 发布。

上述能力已有契约、适配器和自动测试，但在获得对应账号或部署环境并完成外部 smoke 前，不应标记为平台侧已验证。

## Chrome 插件配对发布补充验证

2026-09-02，Chrome 插件通过 30 天设备令牌与用户自托管 Worker 配对后，成功发现一个可发布目标，并完成一次人工确认的 Facebook 单图发布。平台返回发布 ID `1364867756699027_122103092019456929`，插件随后通过用户主动触发的永久链接查询展示帖子入口。验证期间没有把 Meta App Secret、用户 Token 或 Page Token保存到插件。
