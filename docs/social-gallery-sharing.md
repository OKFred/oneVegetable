# 图库社交分享

检查日期：2026-09-01。

## 当前可用能力

图库支持选择多张原图，并在分享中心执行以下操作：

- 使用浏览器的 Web Share API 将原图和文案交给操作系统分享面板。最终可选目标由系统和已安装应用决定，oneVegetable 无法获知或强制选择具体平台。
- 下载 ZIP 分享包。压缩包包含 `assets/` 原图、`caption.txt` 和不含账号凭据的 `share.json`，用于不支持文件分享的桌面浏览器。
- 查看 Facebook、Instagram、X 和 TikTok 的真实接入条件。当前未连接这些平台账号，不显示虚假的“发布成功”。

所有远程图片仍通过统一 Gateway 的 `downloadProductAsset` 读取；图库页面不直接调用 `fetch`。单次最多 20 张、合计 50 MiB。

## 为什么不能仅靠 Alibaba 账号一键直发

| 平台      | 发布目标         | 账号与应用要求                                                     | 素材要求                                 |
| --------- | ---------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Facebook  | Page             | Meta 应用、Page 管理权限、Page token、`pages_manage_posts`         | 服务端上传图片；个人主页不属于支持目标   |
| Instagram | Business/Creator | Meta 应用、专业账号 OAuth、内容发布权限                            | 平台从公共 HTTPS URL 拉取图片            |
| X         | X 用户           | 开发者项目、用户 OAuth、可用 API credits                           | 先上传媒体，随后创建 Post；单条最多 4 图 |
| TikTok    | 创作者账号       | 开发者应用、Content Posting API、`video.publish` 或 `video.upload` | 照片 URL 必须属于应用已验证的域名        |

官方参考：

- [Meta Instagram API 官方 Postman 文档](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [X 创建 Post](https://docs.x.com/x-api/posts/manage-tweets/quickstart)
- [X API 计费](https://docs.x.com/x-api/getting-started/pricing)
- [TikTok Content Posting API](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [TikTok 照片发布](https://developers.tiktok.com/docs/en/content-posting-api-reference-photo-post)

## 后续官方直发迭代

1. 在自托管 BFF 增加社交平台应用配置和 OAuth callback。Client Secret、access token 与 refresh token 只加密存于服务端；插件不读取网站密码。
2. 增加 `SocialAccountConnection`、发布草稿和 append-only 发布审计。每次真实发布都要求用户确认，不自动重试 mutation。
3. 使用短期素材中转层：Instagram 和 TikTok 使用具备 TTL 的 R2 公共 HTTPS 地址；TikTok 还需要完成域名所有权验证。过期后删除中转素材。
4. 按平台实现独立适配器和状态回读：Facebook Page、Instagram container、X media + Post、TikTok publish ID。
5. 取得开发者应用审核后逐平台进行真实 smoke；未通过审核的平台保持“需要配置”，不回退页面自动化或 Mock。

平台令牌不能复用 Alibaba 凭据。Cloudflare、Node.js 与插件需要分别通过同一类型化 BFF 契约访问，业务组件不得直接调用平台 API。
