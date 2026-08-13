# 凭证保险库

## 目标与边界

凭证保险库降低 `chrome.storage.local` 被离线读取、扩展数据被误导出或旧版明文设置残留时的泄露风险。它不能保护已经解锁的 service worker、被恶意软件或其他高权限扩展控制的浏览器，也不替代高安全场景中的服务端 BFF。

## 密钥与密文格式

- 用户口令限制为 12–256 个 UTF-8 字节，口令本身从不写入 Chrome 存储、页面存储或日志；
- PBKDF2-HMAC-SHA256 使用每个保险库独立的 16-byte 随机 salt 和 600,000 次迭代；
- 派生 256-bit、不可导出的 AES-GCM `CryptoKey`；
- 每次加密使用新的 12-byte 随机 IV、128-bit authentication tag 和固定 additional authenticated data；
- 存储记录只包含版本、算法、salt、迭代次数、IV 和 ciphertext，不包含凭证明文。

AES-GCM 同时验证密文完整性。错误口令、被修改的密文和不合法的设置都返回统一解锁错误，不把解析细节暴露给页面。

## 运行时生命周期

解锁后的 `CryptoKey` 和完整设置只存在于扩展 service worker 的模块内存。options 页面只能读取 App Key、网关、签名算法和凭证是否存在；App Secret 与 Access Token 不返回页面，留空保存时由 service worker 保留原值。

用户可以主动锁定。Chrome 回收或重启 service worker 也会丢弃内存中的密钥，因此后续真实请求返回“保险库已锁定”，直到用户重新输入口令。保险库记录若被其他上下文覆盖，worker 会在使用前比对记录并拒绝继续使用旧的缓存密钥。

## 升级、轮换与恢复

旧版明文设置被识别为“待迁移”后不再参与真实请求。迁移由 service worker 读取旧记录、使用用户新口令加密并原位覆盖；options 页面不会收到旧 App Secret 或 Access Token。

更换口令会生成新 salt 和新密钥并重新加密现有设置。项目不保存恢复密钥、口令提示或后门；遗忘口令时无法恢复密文，只能从设置页彻底清除扩展本地数据，再重新配置开放平台凭证。

## 验证范围

单元测试覆盖创建、解锁、重新封装、口令轮换、错误口令和密文篡改。MV3 Playwright 回归覆盖密文中不出现凭证明文、service worker 重启自动锁定、旧口令在轮换后失效、旧版明文迁移和彻底清除。当前仍没有真实 Alibaba.com 账号验收，以上测试不代表上游接受了真实签名请求。
