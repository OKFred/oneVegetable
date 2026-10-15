# 2.16.0 发布准备

记录日期：2026-10-15。候选范围为模板变量、顺序组合、携图 ZIP/S3 交换，以及独立 TOP/IOP 配置提示。发布准备不代表已经合入 master、创建正式 Tag、部署网站或提交 Chrome 商店。

## 范围与兼容

- 七个 workspace 包与商店材料使用 2.16.0；不复用或替换已经发布的 2.15.1 资产。
- 文本变量不执行代码、不自动代填商家身份；最多组合十个模板，插入后才成为商品编辑数据，不自动发布或更新。
- JSON 模式继续兼容。携图 ZIP 使用 `assets` 内容哈希路径；S3 逐对象写入并精确回读，清单最后写入。原 URL/fileId、图片账号属性和凭据不进入包。
- 图片导入复用持久传输回执：保存前核对新 fileId 及目标分组，结果不明仅核对，不自动重传。ZIP 50 MiB、解压 100 MiB、500 个素材、S3 单对象 5 MiB 限制不变。
- “配置 TOP / IOP”的消息只说明选择编辑对象，不代表已保存或已验证；取消离开确认或读取失败时不显示成功切换。
- 本地重新授权工具明确保存协议。历史未标记包仍按 TOP 处理；显式协议冲突在出网前拒绝，不根据 AppKey 猜测。
- TOP 默认及两份独立配置保持兼容，没有新增永久扩展权限、Alibaba 方法或真实写白名单。

## 真实只读核对

本轮新 TOP 授权已完成 Callback/state 校验、原子保存和本地加密导入，工作台商品列表连接测试通过。TOP 实际响应未返回有效期，不补造倒计时。

已有 IOP 续期包仍有效：以此前 `/auth/token/refresh` 成功回执核对协议及完整包，不按 AppKey 推断；复用后商品、分组、图片、库存、Schema、评分、订单与物流只读检查通过，并导入本地独立 IOP 档案。该包记录 Access Token 到期时间为 `2027-01-07T03:14:50.995Z`，不代表所有商家的通用授权时长。本轮未再次接受授权协议、刷新 Token、修改商品或自动恢复写任务。

TOP/IOP 两份授权的两个商品样本匹配，但这不是平台身份认证。隔离的双协议选路验收发送四个只读请求：商品走 IOP、全部图片走 TOP、图片分组及指定分组图片走 IOP，均通过。验证不改变当前工作台的同商家确认状态，默认仍为 TOP。

扩展 IOP 检查中的商品 ID 加密接口返回平台 `InternalError`；保留失败回执，不把该项称为通过，也不全局删除接口或悄悄换协议重试。此问题与商品/图片基本连接是否有效分开记录。

敏感授权包、原始商品内容和浏览器 Profile 只在本机忽略目录；发布包、公开日志及截图不包含这些数据。

## 发布门禁

完整 Windows 检查和固定构建回归已通过。首轮 Redocly 进程非零退出，尽管报告为零错误/警告，仍按失败阻断；保留初始日志，补充安全退出码诊断后重跑，不增加自动重试或忽略错误。

第二轮发现新增版本历史使 Web i18n 分块达到 500,441 字节，超过原有 500,000 字节门槛。将完整版本历史独立为懒加载页面使用的分块后降到 447,716 字节；没有删除历史记录、缩减双语内容或放宽预算。修复后的完整检查成功，之前的失败日志保留。

| 检查                     | 结果                                                                            | 忽略目录中的本机日志                                  |
| ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 完整 `pnpm check`        | 312 个文件 / 2,507 项单测；格式、类型、i18n、契约及生成漂移、三端构建和合规通过 | `artifacts/release-2.16.0-check-passed-candidate.log` |
| 隔离 Worker / D1         | 9 个文件 / 24 项                                                                | `artifacts/release-2.16.0-worker.log`                 |
| Web / 正式 MV3 E2E       | 108 / 108                                                                       | `artifacts/release-2.16.0-web-mv3.log`                |
| 静态授权与 TOP / IOP MV3 | 9 / 9                                                                           | `artifacts/release-2.16.0-authorization.log`          |
| Node 凭据与双语交互      | 4 / 4                                                                           | `artifacts/release-2.16.0-node-credentials.log`       |
| BFF / D1 回放            | 2 / 2                                                                           | `artifacts/release-2.16.0-bff-replay.log`             |
| 2.15.1 → 2.16.0 升级     | 20 项                                                                           | `artifacts/release-2.16.0-upgrade.log`                |
| Cloudflare 生产模式构建  | 类型、隔离测试、同源 Web 及 Worker 干跑通过；不含 localhost API 地址，未部署    | `artifacts/release-2.16.0-cloudflare-build.log`       |

Lint 为 0 error，保留 30 项既有 warning；未提高测试超时或放宽权限、包体门禁。中英文配置选择提示已在 Node E2E 中覆盖，不会因选择授权而保存、测试或刷新凭据。

固定构建候选 `artifacts/one-vegetable-v2.16.0-chrome-mv3.zip`：213 个文件，ZIP 1,230,660 字节，解包 4,227,554 字节，分别低于 2,000,000 / 5,470,000 字节门槛。SHA-256：`cd7f461ec7c0f84c2ca7d87ce0afea6885dfb74393a49c74305e746f6c69e1e8`。

包内容与经过测试的固定构建逐文件一致，权限及外部连接声明与正式 2.15.1 相同；没有环境文件、授权包、浏览器 Profile 或 Mock 文件目录。扫描本机当前两份 AppKey/AppSecret/Token、网站测试账密及环境敏感值，没有发现混入。审计回执为 `artifacts/release-2.16.0-package-audit.json`。候选包不等于正式 GitHub Release 资产；正式发布后仍需下载不可变资产，独立核对其 SHA-256、manifest 和权限。

模板变量及图片迁移已有离线 Web/MV3、隔离 Worker 与契约测试；不能用真实授权只读、此前 JSON-only S3 验收或 Mock 回读代替真实携图验收。

## 2026-10-15 受控携图验收补充

用户已批准少量真实图片/模板/S3 验收，以及通过后推进主线和 GitHub Release。测试使用独立 SQLite、浏览器上下文和 RustFS `dev` 下的 2.16.0 唯一前缀，不更换现有工作台凭据，不修改商品、桶权限或删除远端数据。

- **通过：真实 ZIP 导出。** 从测试账号读取一张现有图片，在实际模板页面导出 ZIP；校验图片字节、内容哈希和相对路径，包中不保留原图片 URL/fileId。
- **通过：RustFS 携图备份与读取。** 实际页面将一张图片及清单写入独立前缀，逐对象 GET 确认，清单最后写入；共享 S3 读取器再次校验图片 SHA-256 和模板内容。该次测试没有 Alibaba 写请求。
- **未通过：Alibaba 携图导入。** 仅创建一次独立测试分组，并仅发送一次图片上传；BFF 记录成功响应，但随后公开 API 和官网均显示目标分组为空。持久任务未通过目标分组/fileId 核对，因此模板没有被保存为迁移成功，也没有自动重复上传、移动或删除图片。平台去重、归组行为或查询延迟尚不能据此确定根因。
- 分页读取已确认不同页面确实返回不同素材；没有通过扫描整店或仅凭同名素材来判定上传成功。官网显示该账号存在大量图片，不扩大扫描范围。
- 上传请求及失败阶段的脱敏记录保存在 `artifacts/template-materials-real/dcdecaf5-01cf-478a-9717-79834508dcae/report.json`；独立 S3 成功记录为同目录下 `ae7929c2-d2d8-44f7-989d-e11365de3fbc/report.json`。这些目录均被 Git 忽略。
- 远端测试分组和两个 S3 备份对象保留；没有改商品、重新上传失败项或重放旧任务。S3 成功不代表整个 Alibaba 导入链路已通过。

**发布决策：** 在用户决定继续整改，或明确接受上述已知限制之前，不将携图导入标为真实验收通过，不创建正式 Tag/Release。原候选代码 CI 成功仍有效，但不能替代这项真实接口结果。

### Live acceptance summary

Real ZIP export and image-inclusive RustFS backup/readback passed. One Alibaba image upload was acknowledged, but neither the public gallery query nor the official UI found the image in the intended test group. The application correctly refused to save an unverified imported template and did not retry the mutation. The exact provider cause remains unconfirmed. Formal publication is on hold pending remediation or explicit acceptance of this known limitation; no product mutation or remote deletion was performed.

## 发布操作边界

候选代码与检查说明推送后，须等待同一候选的远端 CI 成功；以当前提交的 Actions 结果为准，不以旧提交通过替代。主线合并、不可变 Tag/GitHub Release、现有网站部署及商店提交分别确认；不移动旧 Tag，不覆盖旧 Release，不自动提交商店。
