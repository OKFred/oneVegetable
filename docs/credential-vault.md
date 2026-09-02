# 凭证保险库

## 目标与边界

凭证保险库降低 `chrome.storage.local` 被离线读取、扩展数据被误导出或旧版明文设置残留时的泄露风险。它不能保护已经解锁的 service worker、被恶意软件或其他高权限扩展控制的浏览器，也不替代高安全场景中的服务端 BFF。

## 密钥与密文格式

- 用户口令限制为 6–256 位，口令本身从不写入 Chrome 存储、页面存储或日志；
- PBKDF2-HMAC-SHA256 使用每个保险库独立的 16-byte 随机 salt 和 600,000 次迭代；
- 派生 256-bit、不可导出的 AES-GCM `CryptoKey`；
- 每次加密使用新的 12-byte 随机 IV、128-bit authentication tag 和固定 additional authenticated data；
- 存储记录只包含版本、算法、salt、迭代次数、IV 和 ciphertext，不包含凭证明文。

AES-GCM 同时验证密文完整性。错误口令、被修改的密文和不合法的设置都返回统一解锁错误，不把解析细节暴露给页面。

## 运行时生命周期

解锁后的完整设置和不可导出的运行时 `CryptoKey` 只存在于扩展 service worker 的模块内存。为适应 MV3 后台会频繁休眠的生命周期，派生出的 32-byte 会话密钥材料会额外写入内存型 `chrome.storage.session`，并与当前密文版本及最后活动时间绑定。后台被回收后会用它重新导入不可导出的 `CryptoKey` 并校验 AES-GCM 密文，因此刷新 options 页面或普通后台休眠不要求再次输入口令。options 页面只读取 App Key、网关、签名算法和凭证是否存在；App Secret、Access Token 与会话密钥材料都不返回页面。

用户可以主动锁定。浏览器重启、扩展禁用、更新或重载会由 Chrome 清空 `storage.session`；此后真实请求返回“凭证已锁定”，直到用户重新输入口令。保险库记录若被其他上下文覆盖，worker 会在使用前比对 salt、IV 和 ciphertext，清除不匹配的会话材料并拒绝继续使用旧密钥。

新建保险库默认不因空闲自动锁定。用户可主动选择 5、15、30 或 60 分钟；已有保险库保留原先保存的策略。启用后，读取或更新凭证会刷新保存在会话内存中的活动时间，只读取保险库状态不会续期。超时判定在每次状态或凭证访问前执行，不依赖在 MV3 中不可靠的长时间定时器；到期会同时清除运行时密钥和 `storage.session` 会话材料。

扩展启动时把 `chrome.storage.local` 和 `chrome.storage.session` 的访问级别设置为 `TRUSTED_CONTEXTS`，阻止网页及扩展内容脚本通过 Storage API 读取。由于该 API 自 Chrome 102 起提供，manifest 明确设置最低 Chrome 版本为 102。参考 [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) 和 [扩展 service worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)。

## 升级、轮换与恢复

旧版明文设置被识别为“待迁移”后不再参与真实请求。迁移由 service worker 读取旧记录、使用用户新口令加密并原位覆盖；options 页面不会收到旧 App Secret 或 Access Token。

更换口令会生成新 salt 和新密钥并重新加密现有设置。项目不保存恢复密钥、口令提示或后门；遗忘口令时无法恢复密文，只能从设置页彻底清除扩展本地数据，再重新配置开放平台凭证。

## 验证范围

单元测试覆盖创建、解锁、重新封装、口令轮换、错误口令、密文篡改、会话密钥恢复、记录不匹配、状态读取不续期、凭证访问续期和截止点自动锁定。MV3 Playwright 回归覆盖内容脚本无法访问 local/session 存储、密文和会话缓存中不出现凭证明文、service worker 重启后保持当前 Chrome 会话解锁、主动锁定清除缓存、旧口令在轮换后失效、旧版明文迁移和彻底清除。以上测试不代表 Alibaba 上游接受了真实签名请求。
