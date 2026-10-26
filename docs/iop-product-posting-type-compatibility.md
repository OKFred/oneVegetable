# IOP 商品发布类型查询兼容修复

检查日期：2026-10-27。仅修复发布类型的只读查询，不改变授权、默认协议、写入白名单或现有 Schema 契约。

## 协议前置核对

| 项目     | TOP                                                | IOP                                                             |
| -------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 方法     | `alibaba.icbu.product.type.available.get`          | `/icbu/product/other/available/get`                             |
| 请求     | `type_request: { cat_id, language }`               | 签名前展开为 `cat_id`、`language`                               |
| 成功依据 | 沿用原响应校验                                     | `code=0`、`result.success=true` 及明确的两项布尔值              |
| 发布类型 | `support_post_whole_sale`、`support_post_sourcing` | 将 `supportPostWholeSale`、`supportPostSourcing` 映射到共享字段 |

新版不接受旧版 DTO 包装。仅展开请求还不足以修复：必须同时归一化响应字段，否则页面仍无法确认类目的发布类型。缺字段不能默认为 `false`，明确业务拒绝不能转换为成功。

依据：[IOP 官方定义](https://openapi.alibaba.com/doc/api.htm#/api?cid=1&path=%2Ficbu%2Fproduct%2Fother%2Favailable%2Fget&methodType=GET%2FPOST)及仓库 `docs/alibaba-iop-api-docs.json` 快照。当前账号真实成功响应省略了文档中的 `msg_code`、`message_info`，但明确返回 `success` 和两项布尔值；兼容这两个非必要状态文本缺失，不放松业务成功条件。

## 回归范围

- 共享客户端：签名使用展开后的参数；不混入 TOP `session`、`method` 或旧 DTO；不修改调用方数据。
- 页面到客户端：TOP 单授权、历史未标记 TOP、IOP 单授权，以及双授权的两种默认协议；沿用原有选路，不在失败后切换协议或重试。
- 明确的 `false`、缺失或异常字段、平台拒绝、无效参数和未知参数均有测试。
- 切换界面语言不触发额外业务查询，不改变 Alibaba 请求语言。
- 新增样本均为 `mock/data` 中的虚构数据，不包含账号资料。

## 验收结果

- 使用远程已有 IOP 授权单独调用：平台明确返回成功，两项发布类型均支持，归一化通过。首次诊断的本地 URL 策略配置错误在出网前拒绝，修正为精确 Origin 后仅实际发送一次只读请求；两个诊断记录均保留。
- 在远程 Chrome 重载正式 MV3 构建，经商品列表的“新增”入口逐级选择原失败样本相同的叶子类目。发布类型查询不再报 `cat_id` 缺失，两种类型均可选择；TOP/IOP 配置和原平台草稿回执保持不变。
- 全量单测 372 个文件、3762 项通过；独立 Worker 回放 26 项通过；正式 MV3 的 TOP 发布类型/橱窗回放 E2E 通过。
- 类型检查、Web/API dry-run/MV3 构建及现有 Web/扩展包体和商店合规门禁通过。构建只更新远程解包验收目录，不替换已发布的 2.19.0 ZIP。

真实验收的脱敏日志保存在忽略目录 `artifacts/`。本轮只读验证，不再创建商品或草稿；此前已创建且回读成功的草稿保持不变。未合并主线、部署线上 Worker 或发布商店版本。
