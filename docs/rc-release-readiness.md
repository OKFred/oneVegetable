# RC 发布准备

## 本迭代边界

本迭代不连接真实国际站账号，也不开放任何真实写能力。目标是让无账号可验证的构建、升级、错误处理、权限管理和发布产物先形成闭环。

## 设置升级

扩展设置现在以版本 2 加密保险库保存：PBKDF2-HMAC-SHA256 使用随机 salt 和 600,000 次迭代派生不可导出的 AES-256-GCM 密钥，随机 96-bit IV 与固定 additional data 为密文提供机密性和完整性。用户口令不写入任何存储，解锁密钥和设置只存在于 service worker 内存，后台重启或用户主动锁定后页面和真实请求都无法读取凭证。

local/session 存储在后台启动时限制为 Chrome `TRUSTED_CONTEXTS`，最低支持 Chrome 102。已解锁保险库默认空闲 15 分钟自动锁定，可配置为 5、15、30 或 60 分钟；策略与凭证一起加密，状态查询不会意外续期。

旧版 `{ version: 1, settings }` 或扁平 `gatewaySettings` 会显示为“待迁移”，真实请求停止读取。用户设置新口令后，service worker 直接完成原位加密迁移，不把旧 App Secret 或 Access Token 返回给 options 页面。遗忘口令无法恢复，只能彻底清除本地数据后重新配置。

设置页会列出自定义网关和外部图片转存曾按需授予的额外主机权限，并允许逐项撤销。正式网关是 manifest 必选权限，不出现在可撤销列表中。撤销后再次使用对应主机时，Chrome 会重新请求授权。

## 查询重试与错误分类

传输层使用稳定错误码区分：

- `AUTHENTICATION_FAILED`：HTTP 401，不重试；
- `PERMISSION_DENIED`：HTTP 403，不重试；
- `RATE_LIMITED`：HTTP 429，可重试；
- `REQUEST_TIMEOUT`：客户端超时，可重试；
- `UPSTREAM_UNAVAILABLE`：HTTP 5xx，可重试。

只有能力目录标记为 `read` 的方法会执行退避重试，最多三次，间隔 250 ms、500 ms。mutation 即使遇到超时或 5xx 也只发送一次；UI 查询层不再叠加第二套重试，避免一次操作被成倍放大。

## 可复现发布包

执行：

```bash
pnpm release:extension
```

命令会构建 MV3、检查权限和体积预算，并在 `artifacts/` 生成：

- `one-vegetable-v2.0.0-chrome-mv3.zip`；
- 同名 `.sha256` 校验文件；
- `release.json`，包含版本、文件数、大小和 SHA-256。

ZIP 内文件按名称排序，使用固定时间和权限属性；脚本会在写出前生成两次并逐字节比较，再解压核对文件清单。根包、扩展包和 manifest 版本不一致时拒绝打包。CI 会保存发布目录 14 天，但不会自动发布到 Chrome Web Store。

## 剩余限制

- WXT 将后台依赖合并为单一 service worker，当前后台约 1.66 MB；构建预算限制其继续增长。
- 无账号测试只能确认客户端门禁、契约、Mock、升级与浏览器行为，不能确认开放平台权限、服务端限流语义或真实响应结构。
- Chrome 可选权限弹窗仍由浏览器控制；自动化验证 manifest、无额外授权状态和权限仓库行为，不绕过浏览器确认。
