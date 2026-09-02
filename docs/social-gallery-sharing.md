# 图库社交分享

检查日期：2026-09-01。

## 当前能力与验收边界

图库的“分享”入口支持三类互不替代的能力：

- 使用 Web Share API 把原图和文案交给操作系统分享面板。目标由操作系统和已安装应用决定。
- 下载 ZIP 分享包，包含 `assets/` 原图、`caption.txt` 和不含账号凭据的 `share.json`。
- 通过用户自己的 BFF 和 Meta Graph API，把一张图库图片发布到一个 Facebook Page 或一个关联的 Instagram 专业账号。

Meta 直发的契约、加密存储、OAuth、多连接、权限发现、发布状态机、Node/Cloudflare 素材暂存和插件设备配对已实现并通过本地自动测试。2026-09-01 已使用项目 Meta 应用和测试 Page 完成一次 Facebook 单图发布，并通过 Facebook 页面回读确认图片与文案；详细证据见 [Facebook 真实发布验证记录](meta-facebook-real-validation.md)。Instagram 尚未取得可关联的专业账号，因此仍不能标记为真实账号已验证。

X、TikTok、轮播、定时发布和多目标同时发布不在当前范围。未配置或权限不足时界面显示真实原因，不回退页面自动化或 Mock。

## 配置 Meta 应用

准备一个全局 Meta 应用即可连接多个管理员身份和多个 Page。推荐命名为 `oneVegetable Social`，但系统不自动创建应用或代替用户接受 Meta 协议。

1. 在 [Meta for Developers](https://developers.facebook.com/apps/) 创建或选择 Business 类型应用。
2. 启用 Facebook Login for Business，并在应用中准备以下权限：
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
3. 在 oneVegetable 的“管理后台 → 社交账号”填写 App ID、App Secret 和公开 Origin。App Secret 为 write-only，保存后不会回显。
4. 复制界面生成的 Callback，并加入 Meta 应用的 Valid OAuth Redirect URIs。默认路径为：

   ```text
   https://<你的域名>/api/v1/social/meta/oauth/callback
   ```

5. 点击“连接 Meta 账号”，在 Meta 页面授权。系统会换取长期用户令牌，并从 `/me/accounts` 发现该身份可管理的 Page、Page 任务和关联的 Instagram 专业账号。

App ID 或公开 Origin 变更前必须先断开所有连接。令牌过期或 Meta 返回令牌失效后，连接会标记为“需要重新连接”，不会回退 Mock。

开发模式可先使用应用角色和测试 Page。面向不属于应用角色的真实管理员或公开用户前，还需要按 Meta 当前要求完成权限审核或业务验证；平台最终是否批准不由 oneVegetable 决定。

## Facebook 与 Instagram 目标

Facebook 只支持 Page，不发布到个人主页。账号必须能在 Page 任务中创建内容，并授予 Page 读取和发布权限。

Instagram 只支持与 Facebook Page 关联的 Business/Creator 专业账号。首版要求 JPEG、宽度 320–1440 像素、宽高比 0.8–1.91，且不自动转码。Facebook 接受 JPEG/PNG。两者解码后均不超过 5 MiB；Facebook 文案最多 4000 字符，Instagram 最多 2200 字符。

发布时每次只选择一个目标和一张图片，并经过两次明确操作：先准备任务，再确认发送。Facebook mutation 不自动重试；若请求在平台受理后超时，任务进入 `unknown`，必须人工核对，系统不会自动重发。Instagram 先创建 media container；平台仍在处理时，至少间隔 60 秒再“检查进度”，最终 `media_publish` 对每个任务最多执行一次。

Cloudflare 使用私有 `SOCIAL_MEDIA` R2 binding 暂存素材；桶不公开，平台只拿到随机 256-bit 临时地址。Node 使用 `.data/social-media`。素材最长保留 24 小时，任务元数据最多保留 30 天。Node 上的 Instagram 发布必须配置 Meta 可访问的公开 HTTPS Origin；localhost 仅适合本地界面和模拟测试。

## 插件如何使用自托管后端

插件不保存 Meta App Secret、用户 Token 或 Page Token，也不直接调用 Meta：

1. 在插件“设置 → 社交发布后端”填写自托管 BFF Origin。
2. Chrome 只为这个精确 Origin 请求可选主机权限。
3. 插件生成 10 分钟有效的一次性配对码。
4. 管理员在 BFF“管理后台 → 社交账号 → 插件设备”输入配对码并二次确认。
5. 插件领取一次性的 30 天设备令牌并保存在受信 `chrome.storage.local`；D1/SQLite 只保存 SHA-256 hash。

设备令牌仅能读取发布目标和调用社交发布任务，不能读取 Meta 密钥、管理用户或调用 Alibaba 能力。管理员可随时在后端撤销设备；插件本地“断开”只删除本机令牌，若设备可能遗失还应在管理后台撤销。

配对成功后可点击插件里的“检查连接”，它只读取目标列表，用来验证精确主机权限、CORS、设备令牌和 BFF 路由，不会创建发布任务或调用 Meta mutation。开发排障也可运行 `pnpm smoke:social:extension:read`，并在当前进程临时提供 `ONE_VEGETABLE_SOCIAL_SMOKE_BASE_URL`、`ONE_VEGETABLE_SOCIAL_SMOKE_EXTENSION_ID`、`ONE_VEGETABLE_SOCIAL_SMOKE_DEVICE_TOKEN`。该命令只输出数量、状态、requestId 与耗时到忽略目录，绝不写出令牌或目标名称；令牌不要放入仓库或普通日志。

## 安全边界

- Meta App Secret、用户 Token、Page Token 和待发布文案使用独立 AAD 的 AES-256-GCM 密文保存，API 不回显。
- 所有 Meta 请求走统一 `NetworkManager` 和显式版本化 Graph URL；业务代码不直接调用 `fetch`。
- OAuth state 一次性使用、10 分钟失效并绑定发起管理员；Callback 只接受已配置的精确 Origin 和路径。
- 发布使用调用方提供的 UUID 幂等键。同一键与相同内容返回原任务，不同内容返回冲突。
- 日志和审计只保留 requestId、目标/任务标识、结果和脱敏 Meta 错误，不记录 Token、完整文件或完整平台响应。

官方参考：[Facebook API](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api)、[Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)。
