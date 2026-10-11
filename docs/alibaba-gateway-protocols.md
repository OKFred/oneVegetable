# Alibaba TOP / IOP 双协议兼容

## 默认与迁移

TOP 仍是默认协议，不自动替换已有本地、Node、Cloudflare 或插件凭据。历史授权包和加密设置没有 `protocol` 时按 TOP 读取；未知协议标识拒绝，不猜测 AppKey 或 Token 所属协议。

新版应用导出包通过 `protocol: "iop"` 显式标记。管理员或插件用户确认导入后才替换该工作台配置；导入包含明文密钥的 JSON 前应备份原授权包。旧 TOP 包仍可重新导入，两种协议不得共享或混搭凭据。

| 协议            | 业务网关                                                      | 认证与签名                                                        | 续期                                  |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| TOP（历史默认） | `https://eco.taobao.com/router/rest`，部分既有操作使用旧 sync | `method`、`session`、既有 TOP 签名；保持原行为                    | 旧 OAuth Token 端点                   |
| IOP（显式选择） | `https://openapi-api.alibaba.com/rest` + 逐项登记 API path    | `access_token`、毫秒 timestamp、API path + 排序参数的 HMAC-SHA256 | `/auth/token/refresh`；禁止跨协议刷新 |

来源：[新版 API 文档](https://openapi.alibaba.com/doc/api.htm)，[新版指南](https://openapi.alibaba.com/doc/doc.htm)。同名接口可能有不同参数、响应、权限及路径，不能用 `method.replaceAll('.', '/')` 推导。

## 当前 IOP 支持范围

| TOP 能力标识                               | IOP path                             | 适配说明                                                                                 |
| ------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `alibaba.icbu.product.list`                | `/alibaba/icbu/product/list`         | 商品分页、摘要；要求真实列表和总数                                                       |
| `alibaba.icbu.product.group.get`           | `/alibaba/icbu/product/group/get`    | 已通过账号只读核对；根目录 `group_id=-1`，此方法未出现在当前新版菜单中，不把它当目录承诺 |
| `alibaba.icbu.product.schema.render`       | `/icbu/product/schema/render`        | 将原请求 DTO 映射为 `render_request`；要求成功及 XML                                     |
| `alibaba.icbu.product.schema.render.draft` | `/icbu/product/schema/render/draft`  | 对应文档映射；草稿读取另需真实样本验收                                                   |
| `alibaba.icbu.photobank.group.list`        | `/icbu/product/photobank/group/list` | 图片分组                                                                                 |
| `alibaba.icbu.photobank.list`              | `/icbu/product/photobank/list`       | `groupId/currentPage/pageSize`；必须选择指定分组                                         |

总览可以显示可查询的商品统计；订单及跨全部分组的图片统计在未适配时显示不可用，不伪造为 0。IOP 的全部图片、未分组查询不猜特殊分组 ID，也不全店扫描。

订单、RFQ、物流、产品分等尚未映射的能力，在调用前返回清晰限制原因。所有 IOP 商品、图片及其他 mutation 暂不继承 TOP 的真实写白名单。不会失败后切到 TOP、Mock 或其他应用。

## 续期和安全

- Node/Cloudflare 凭据 Provider 按协议刷新；TOP 保持旧链路，IOP 只调用新版 System API。
- 平台未返回到期时间时保持未知；到期/失效时显示重新授权入口，不猜固定授权周期。
- IOP Refresh Token 可能轮换；结果不明时需要重新授权，不能重新发送同一个续期请求。续期在共享租约和 revision 下原子保存，配置身份不因正常 Token 刷新改变。
- 独立插件 IOP 工具可授权、续期及导出 JSON，再由工作台显式导入。旧 `pnpm openapi:auth:refresh` 只接受 TOP；遇 IOP 提示使用新版工具或凭据面板，不发送到旧端点。
- 网关校验协议与 endpoint；未适配方法和写请求出网前拒绝。公开响应仅含协议、来源、到期时间和 AppKey 尾号，不返回 Secret 或 Token。

## 验证边界

自动测试使用 `mock/data/alibaba-auth/iop-business-responses.json`，覆盖两种协议、旧包/设置、错误及预先拒绝。真实验收只使用独立 IOP 包顺序读取，不替换用户当前 TOP 配置、不续期现有 Token、不修改商品。

“IOP 只读可用”不等于其全部接口或写操作已验收。正式切换前仍需逐领域补齐映射和账号验收；当前无需旧用户重新授权或迁移。

### 2026-10-12 验收记录

- 独立 IOP 授权包真实读取通过：商品列表、商品分组、正式商品 Schema、图片分组和指定分组图片列表。草稿 Schema 仅完成契约/适配测试，尚无本轮真实草稿样本。
- 隔离 Node BFF 通过 JSON 导入、真实商品列表连接测试、显式 IOP 手动配置、重启保留、清除防回退、重新导入和设置页确认流程。验收使用临时 SQLite，不修改当前工作台 TOP 配置，也不轮换真实 Token。
- 正式 MV3 构建的离线 E2E 通过静态 Pages 回调、加密保存/导出、单次续期、错误 state 拒绝，以及工作台 IOP 持久化、图片分组查询和未适配读写拦截。测试副本预授予主机权限并使用 `mock/data` 响应，不声称该项是插件真实账号验收。
- 全量单测 294 文件 / 2067 项通过；Worker 隔离测试 23 项通过；相关 E2E 24 项通过（授权 3、双语 Node 配置 2、工作台及扩展回归 19）。Web/Worker/扩展构建、类型、契约漂移、格式、Lint 和文案检查通过；Lint 保留已有 warning，无 error。
- 正式扩展 ZIP 1,189,371 字节，解包 4,097,280 字节；未增加永久 Manifest 权限。代码推送不等于已部署 Worker、Pages 或发布商店。

只读真实回执保存在忽略目录 `artifacts/iop-business-read-validation/`，Node 设置验收记录在 `artifacts/node-credential-management/`；不提交凭据、完整 Schema 或平台业务响应。

## English

TOP remains the backward-compatible default. Unmarked historical bundles/settings remain TOP; an explicit `protocol: "iop"` import is required to select IOP. Do not mix application secrets or tokens between protocols. Supported IOP reads have explicit paths and request/response mappings. Unmapped operations and all unverified IOP writes are rejected before network access, never retried through TOP or Mock. Renewal uses the matching protocol; an uncertain IOP renewal requires reauthorization rather than resending. No existing user configuration is switched automatically.
