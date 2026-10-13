# 2.15.0 候选准备完成（全部发布门禁通过）

状态记录日期：2026-10-13。本文记录 Windows 工作区的发布准备，不代表已经合入主线、创建正式 Tag/GitHub Release、提交商店或部署线上服务。

## 发布结论

Node 原样本及正式 MV3 商品批量修改/恢复现均已闭环。正式 MV3 的最终报告为 `restored-and-confirmed`，`restored=true`、`untouchedFieldsMatched=true`，独立纠正任务为 `verified`；完整原语义基线及所有非目标值回读匹配。首次部分恢复及原 failed/pending 报告仍保留，没有重新绑定旧任务。

**候选准备完成，全部发布门禁通过（all release gates passed）。** 公共源最终 `pnpm check` 已 EXIT 0，实际 300 文件 / 2,233 项及全部门禁通过；Worker 23 项、Node 凭据 2 项、BFF 回放 2 项分别通过。FROZEN 验收 `allPassedSameBuild=true`：同一 205 文件 / 4,102,165 字节构建上，focused batch 1/1、完整 Web/正式 MV3 E2E 105/105（5.7 分钟）、授权 9/9（38.5 秒）通过。最终 ZIP 1,190,841 字节 / 205 条目，校验和及脱敏审计完成。

这里只完成候选准备，不代表正式商店发布、合入、Tag/GitHub Release 或线上部署；这些动作仍须主流程按授权执行。

- TOP 保持默认和向后兼容；无协议标识的历史授权包及设置仍按 TOP 读取。只有显式选择或导入 IOP 配置才使用 IOP，不自动迁移或替换原配置。
- IOP 已显式映射 16 项只读方法，其中 13 项完成真实账号验收；不能把映射数量写成全部验收通过。
- IOP 的三项 Schema 写入 `schema.add.draft`、`schema.add`、`schema.update` 已完成真实受理和字段回读；标题增量更新及原标题恢复均已回读确认。这不代表任意字段或全部 TOP 写能力可用，也不承诺 TOP / IOP 完全等价。
- 旧批量样本从回收站恢复后，原记录已重新出现在列表。用户不接受更换样本，要求继续核对该原记录；两件无品牌样本的替代方案不再作为当前接续路径。
- Node 原样本现已闭环：一次原批量变更及另行授权的一次性原分组/关键词恢复均已回读确认。最新直接 TOP 列表为 `approved` / `online`，类目不变，两个原根字段的精确指纹均匹配恢复基线；此前五分钟审核等待是历史状态，不再作为当前未验证结论。
- 独立恢复持久任务在其自身 actor/context 下只读刷新为 `verified`，没有额外写入；原失败报告已备份并保存 SHA，当前报告阶段为 `restored`，关联两次新的只读请求回执和新的独立恢复任务，未将旧回执重新绑定。
- 正式 MV3 第二件批量样本只发送一次分组/关键词修改并只读确认生效；随后第一次恢复也只发送一次。平台因 Schema 省略 value 节点而仅恢复关键词、未清空分组；审核通过后的精确字段回读已确认是已知部分恢复，不能把它当作结果不明或通过空节点兼容规则宣称全部恢复。
- 一次 operator 纠正恢复仅发送 `productGroup` 根字段，显式提供 `first_group_id` 的空 value；known-partial 守卫先确认当前为原关键词加临时分组，且整份计划原值指纹匹配后才发送。审核结束后原 `fullSemantic` 与 untouched 值均严格匹配，新 group-clear 任务为 `verified`，正式 MV3 恢复最终通过；这不是重放第一次恢复。
- 正式 MV3 实测总计 3 次不同的写入：1 次原分组/关键词修改、1 次仅关键词生效的初次恢复、1 次显式空值的 group-only 纠正。每次只发送一次，没有自动重发、猜测商品标识或修改其他字段。正式 Manifest 及主用户 TOP 配置保持不变；这次受控纠正没有增加用户界面的批量清空或自动回滚入口。
- Chrome 原生 IOP 主机权限确认已完成：正式 Manifest 未修改，用户批准精确 IOP 域名，加密保险库持久化通过。该项不依赖此前隔离 Profile 的权限预授结论，也不等同全部业务只读验收通过。
- 随后另行指定此前已验收的在售库存商品，第二次真实 IOP 读取的 8 项操作通过（7 项通过、1 项合法空物流），发送 28 次 IOP 只读请求，零 TOP 请求、Token 操作或写入。这是独立业务读取结果，不与权限测试伴随的 Schema 失败拼成一次全程无异常的 UI 验收。
- 公共源最终 `pnpm check` 已通过：300 文件 / 2,233 项，以及 Web、AuthPages、Worker dry-run、MV3 构建和 store compliance。Worker 23、Node 凭据 2、BFF 2 及 FROZEN 同构建 focused 1/1、full 105/105、授权 9/9 均实际通过。185025 的 pre-freeze 105/105 不计入最终同构建验收；旧 104/105 startup timeout 保留为历史，冻结后未复现，未修改 timeout。额外根脚本仍有 33 项旧类型债务，不扩大为零问题。公共源已冻结，本轮不改。

## 双协议范围与安全边界

IOP 的 16 项只读映射涵盖商品、分组、Schema、类目、评分、图片分组、指定分组图片、库存、订单及物流。13 项真实验收不继承 TOP 的验收标签。旧类目映射和层级 Schema 仍只有文档验证；商品 ID 加密真实调用返回平台 `InternalError`，未通过账号验收，不将其猜测为权限不足。

IOP 的三项已验收 Schema 写入仍受既有管理员检查、环境 mutation flag、显式确认和持久任务核对约束，不开放其他未验收写入。写入受理、字段回读、平台审核通过和恢复原值分别记录，结果不明不自动重发。

IOP 未适配 RFQ 和订单资金能力，明确返回不支持。不能用手续费字段冒充实付金额，不能用假数据或 Mock 填补能力；请求失败不自动切换 TOP、Mock、其他应用或账号。TOP 的原能力保持兼容，不承诺两种协议功能完全等价。

独立 IOP OAuth、Token 续期和 JSON 导出工具保留，与工作台配置分离；导出的授权包须由用户显式导入。续期使用相匹配的协议，结果不明时重新授权而不是重放请求。独立工具的既有验收不替代公共站点部署、首次公共回调、商店上线或原生权限确认验收。

没有新增扩展权限；继续使用既有 `storage`、`scripting` 及用户触发的精确可选主机授权机制，不预授正式包的主机权限。

## Node 原批量样本：历史证据与恢复闭环

[2.14.0 准备记录](release-2.14.0-readiness.md) 保留当时的证据：批量测试字段曾回读匹配，但平台审核退回，原值恢复与正式 MV3 真实批量验收没有闭环。2.15.0 接续未发布的 2.14.0 成果，不改写该历史结论。

最新状态与历史记录应一起阅读：

- 后续只读检查在平台回收站找到原样本；用户仅确认恢复一个候选。
- 回收站恢复后确认是原记录重新出现在商品列表，不是新建替代商品；该阶段曾记录平台原始状态为 `tbd` / `rejected`。这不是新恢复请求后的最终状态，列表可见也不能等同审核通过。
- 平台官方退回理由属于知识产权（商标、版权或肖像权）合规项，不是应用调用错误；不将该理由扩大解释为所有商品都无法更新。
- 回收站恢复后的检查未证明原分组和关键词恢复。回收站恢复、IOP 原标题恢复及本次原分组/关键词恢复是不同操作，不能相互借用成功结论。
- 用户已拒绝更换样本，要求继续该原记录；不再等待用户批准放弃旧记录或切换两件无品牌样本。
- 随后单独授权的一次性原分组/关键词恢复，通过隔离 BFF 的持久任务被平台受理；当时五分钟只读 Schema 轮询仍返回 `PRODUCT_IN_AUDITING`，列表为 `modified` / `auditing`。这段审核等待保留为历史证据，不再表示最新状态。
- 主流程最新直接 TOP 列表回读确认原记录为 `approved` / `online`，类目与原基线相同；两个原根字段的精确指纹均匹配基线。Node 原样本的一次原批量变更和一次授权恢复现均已回读确认，原样本恢复问题闭环，不重复发送恢复请求。
- 独立恢复持久任务在自己的 actor/context 下以只读方式刷新为 `verified`，零额外写入。原失败报告已独立备份并保存 SHA；当前报告阶段为 `restored`，关联两次最新只读请求回执和新的独立恢复任务。旧回执未被重新绑定，不用新恢复任务改写旧任务的身份或执行历史。
- 原知识产权审核退回历史与最新审核通过状态一起保留，不抹去原失败证据。正式 MV3 第二样本也已完成修改、纠正恢复及严格回读；两条独立链路都闭环，不替换或跳过原 Node 样本。

以上样本、审核原因、恢复任务历史和内部检查状态不作为用户可见的版本变化或商店介绍；技术准备文档保留脱敏验收记录。本文不包含账号或商品标识、实际关键词值、原始 Schema/XML、凭据、授权包或完整业务响应。私有恢复基线和回执继续留在忽略目录，不进入商店资料或发布包。

## 正式 MV3 第二样本：部分恢复历史与最终闭环

- 使用正式 MV3 进行分组和关键词批量修改，只发送一次修改请求，没有重复原修改。
- 最初五分钟只读 Schema 轮询持续返回 `PRODUCT_IN_AUDITING`，验收流程自动停止；不是将审核等待计为写入失败后重发。
- 约十二分钟后，通过只读检查确认列表为 `approved` / `online`、Schema 已可读取。当时原恢复基线不匹配，确认修改已生效；这是恢复前的历史阶段，不能与后续恢复匹配混淆。
- 第一次 restore-only 恢复只发送一次并被受理。发送前重建的精确 payload 与原修改任务的 `reconstructedHash` 一致，`keywordsMatches=true`；私有归档中两个原目标根字段的指纹精确匹配，恢复范围仅为这两个根字段，不是猜测写入。
- 平台省略已声明的空分组节点曾导致旧指纹误判 pending；core 比较已修复，提交 `a57a942` 记录了此前修复及 fixture。兼容只限 `productGroup` 已声明的三个 input 路径，每一路接受省略、无 value 或 empty 三种表示，最多 27 种组合；原 expected/hash 保持不变，非空 ID、带属性值及不明根字段仍严格比较，不丢弃真实标识或 attrs。
- 随后只读 `approved` 及精确字段回读确认：第一次恢复的 Schema 省略 value 节点，平台只恢复关键词，没有清空分组。这是已知部分恢复，不是结果不明；比较兼容修复不改变该业务结论，也不能把真实临时分组视为等价空节点。
- 主流程使用 known-partial 守卫执行一次特殊纠正清理：核对当前关键词等于原值、分组仍等于临时值，并确认整份 planned originalValues 指纹匹配原基线后，才发送一次仅分组根字段的 operator 恢复。该请求显式提供 `first_group_id` 空 value，不重放前次请求，不改写关键词或其他根字段。
- 纠正请求审核及回读现已完成：分组和关键词的原完整语义基线、所有非目标值均匹配。脱敏报告位于忽略目录 `artifacts/extension-batch-maintenance/`，记录 `stage=restored-and-confirmed`、`restored=true`、`untouchedFieldsMatched=true`；该纠正报告的 `writes=1` 只统计本次纠正，整条实测链路共 3 次不同写入。
- 新 group-clear 任务在自身新 context 下为 `verified`，主流程只在此状态确认最终成功。`oldReceiptRebound=false`，原 failed/pending 报告及旧任务保留，新独立回执没有重绑旧任务；Manifest 和主用户 TOP 配置未修改。
- 正式 MV3 真实修改/恢复全链路现已闭环；不提供批量清空分组或自动回滚入口。普通业务请求受理后仍须等待平台审核及字段回读，不承诺固定延迟。本文不复制商品标识、字段内容或私有基线。

## 当前检查状态

以下为主流程已有结果的状态快照，不是本次文档编辑重新执行完整检查。公共源最终 `pnpm check` 已 EXIT 0，实际 300 文件 / 2,233 项通过，日志为 `artifacts/release-2.15-check-public-final.log`，覆盖格式、Lint（0 error / 30 项既有 warning）、i18n、版本、OpenAPI/生成物漂移、离线审计、回放覆盖、工作区类型、Web/AuthPages/Worker dry-run/MV3 构建及 store compliance。旧的 299 文件 / 2,223 项及 2,231 项运行保留为历史，针对性 core 7 项加守卫 5 项不与全量计数相加。正式工作区类型检查通过不代表额外根脚本无诊断：33 项旧类型债务仍存在，不宣称为 0。

最新独立回归已通过：Worker 23 项，日志 `artifacts/release-2.15-worker-last.log`；Node 凭据 2 项，日志 `artifacts/release-2.15-node-credentials-rerun.log`；BFF 回放 2 项，日志 `artifacts/release-2.15-bff-replay-rerun.log`。最新授权 9/9 在 FROZEN 同一构建验收中实际通过，耗时 38.5 秒，不借用旧授权结果。

两次完整离线 E2E 的执行条件分别记录：静态 production mock 构建首次为 96/105，9 项失败来自 Vue 测试 host 在 production 构建中被移除。随后按套件正确的 dev Vite 稳定源码配置重跑，测试期间无文件改动，最终 105/105 通过。保留首次失败及执行条件，不将重跑描述为固定静态 production mock 构建全量通过，也不将离线测试等同于平台真实批量验收。

该历史 105/105 日志为 `artifacts/release-2.15-e2e-rerun-20261013-170128/full-105.log`。后续 104/105、1 项 startup timeout 保留为历史快照；`artifacts/release-2.15-e2e-fingerprint-final-20261013-185025/full-105.log` 的 pre-freeze 105/105 明确排除在最终同构建验收之外。旧失败在冻结后未复现，未修改 timeout；旧 dev Vite 重跑也不改写成静态 production mock 全量通过。

最终验收唯一依据为 `artifacts/release-2.15-e2e-fingerprint-final-frozen-20261013-185824/verification.json`，记录 `allPassedSameBuild=true`。该目录的 `focused-product-batch.log`、`full-105.log`、`authorization-9.log` 分别确认 1/1、105/105（5.7 分钟）和 9/9（38.5 秒）通过，全部对应同一 205 文件 / 4,102,165 字节构建。冻结目录聚合哈希为 `ABF27AAEBA710CB6B59DC4BDB47171EA98C51427A1CA636F58E934032DFA2309`；不拼接不同构建的通过结果。

| 项目                          | 当前结论                                                                | 验收边界                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 全量单测                      | 实际 300 个文件 / 2,233 项通过                                          | 公共源最终运行的实数，不与针对性测试计数相加                                |
| 新增针对性测试                | core 7 项加恢复守卫 5 项，共 12 项通过                                  | 覆盖兼容和纠正守卫，不证明真实平台最终恢复                                  |
| 工作区类型检查                | 公共源最终检查通过                                                      | 额外根脚本仍有 33 项旧类型债务，不扩大为零诊断                              |
| 已执行门禁                    | 格式、Lint、i18n、版本、OpenAPI/生成物漂移、离线审计和回放覆盖通过      | 该次检查中 Lint 为 0 error / 30 项既有 warning；最终候选包由主流程统一核对  |
| 完整 `pnpm check`             | 公共源 final EXIT 0，全链路通过                                         | 候选门禁通过，不等于已发布、合入、打 Tag 或部署                             |
| 构建及商店合规                | 当前 Web、AuthPages、Worker dry-run、MV3 构建及 store compliance 通过   | dry-run 不是部署，compliance 不是商店提交                                   |
| Worker 测试                   | 23 项通过                                                               | 与 Worker dry-run 构建及线上部署分别记录                                    |
| 授权 E2E                      | FROZEN 同构建 9/9 通过，38.5 秒                                         | 与 focused/full 使用相同冻结目录，不借用历史结果                            |
| BFF 回放 E2E                  | 2 项通过                                                                | 与 Node 凭据及正式 MV3 真实样本分别记录                                     |
| Node 凭据 E2E                 | 最新重跑 2 项通过                                                       | 与 BFF、授权和平台真实验收分别记录                                          |
| 静态 production mock 离线 E2E | 首次 96/105，9 项 Vue 测试 host 相关失败                                | host 在 production 构建中被移除；不改写为固定静态全量通过                   |
| 历史 Web / 正式 MV3 离线 E2E  | dev Vite 稳定源码重跑 105/105 通过                                      | 历史快照；测试期间无文件改动，不是固定静态 production mock 全量通过         |
| 历史后续 Web / 正式 MV3 E2E   | 104/105，1 项 startup timeout                                           | 保留旧失败；不作为当前最新结论                                              |
| pre-freeze Web / 正式 MV3 E2E | 185025 的 105/105 为历史快照，排除最终验收                              | 不计入 `allPassedSameBuild`                                                 |
| FROZEN focused batch E2E      | 同构建 1/1 通过                                                         | 聚合哈希及目录快照与 full/authorization 一致                                |
| FROZEN Web / 正式 MV3 E2E     | 同构建 105/105 通过，5.7 分钟                                           | `allPassedSameBuild=true`；旧 startup timeout 未复现，未调整 timeout        |
| 最终打包                      | ZIP 1,190,841 字节 / 205 条目，解包 4,102,165 字节                      | ZIP 2,000,000 / 解包 5,470,000 字节预算通过，最终 SHA 已核对                |
| 脱敏与包路径审计              | source 已知密钥差异及 ZIP 205 条目：10 项敏感值检查，匹配 0，危险路径 0 | 不保存或展示敏感值；不能扩大为任意历史或未知密钥的全量审计                  |
| IOP 单项真实验收              | 13/16 项只读；3 项 Schema 写入及标题恢复回读通过                        | 不承诺全部 TOP 能力等价，也不是批量真实验收                                 |
| 原生 IOP 权限确认             | 已通过；正式 Manifest 未修改，用户批准精确域名，加密保险库持久化通过    | 原生权限通过不等于全部业务只读计划通过                                      |
| 权限测试伴随业务读取          | 28 次读取；首件为审核中的原样本，Schema 查询失败                        | 无写入、TOP 请求或 Token 操作；不把 Schema 失败归因为权限确认失败           |
| 第二次独立业务读取            | 显式指定此前验收的在售库存商品，8 项通过（7 项通过、1 项合法空物流）    | 28 次 IOP 读取，零 TOP/Token/写入；不与前一次合并为全程无异常的 UI 验收     |
| Node 原样本                   | 一次原批量变更及一次授权恢复均已回读确认，恢复问题闭环                  | 最新 TOP 列表 `approved` / `online`，类目不变，两个原根字段精确指纹匹配基线 |
| 独立恢复持久任务              | 自身 actor/context 下只读刷新为 `verified`，零额外写入                  | 报告 `restored` 关联两次新只读回执和独立恢复任务；旧回执未重新绑定          |
| 正式 MV3 第一次恢复           | 历史一次请求只恢复关键词，未清空分组                                    | 已知 partial；原报告保留，不用最终报告擦除中间结果                          |
| 正式 MV3 纠正恢复             | 单次 group-only 纠正后 `restored-and-confirmed`，独立任务 `verified`    | 原完整语义及所有非目标值匹配；`oldReceiptRebound=false`，全链路真实闭环     |

原生权限确认与业务只读运行须分开记录：正式 Manifest 保持原样，用户手工批准精确 IOP 域名后，加密保险库保存及持久化通过；伴随业务计划共发送 28 次 IOP 只读请求，零写入、零 TOP 请求、零 Token 交换/续期操作。首件商品恰为审核中的旧样本，其 Schema 查询失败不否定原生主机权限确认通过。第二次运行另行显式指定此前已验收的在售库存商品，8 项操作通过（7 项通过、1 项合法空物流），独立发送 28 次 IOP 读取，同样没有 TOP、Token 或写入操作。这两次运行不是一次全程无异常的完整 UI 验收，第二次读取成功也不证明旧样本的原分组/关键词恢复。

## 包体预算与候选产物

用户批准的仓库预算已由提交 `2618d1c` 实现，使用十进制字节，不是 Chrome Web Store 的平台上限：

- 最终 ZIP：最多 2,000,000 字节。
- 解包文件总量：最多 5,470,000 字节。
- 其他单块、首屏、background、i18n、权限及安全门禁不变，详见 [包体预算](extension-package-budget.md)。

最终候选产物：`artifacts/one-vegetable-v2.15.0-chrome-mv3.zip`，ZIP 为 1,190,841 字节 / 205 条目，解包 4,102,165 字节，分别低于 2,000,000 和 5,470,000 字节预算。SHA-256 为 `f848acc45e21de71a7838e10033baeb5c71224ec5e8815054bf32e23bb332058`，本轮只读核对一致。对应 FROZEN 构建聚合哈希为 `ABF27AAEBA710CB6B59DC4BDB47171EA98C51427A1CA636F58E934032DFA2309`。

已知密钥 source delta 与最终 ZIP 全部 205 条目的审计检查了 10 项敏感值，匹配数为 0，危险打包路径为 0；不复制被检查值，不把此范围内通过扩大为整个 Git 历史或全部未知密钥均已审计。旧报告的尺寸和预算保留原值。本轮仅更新两个获准 Markdown，不生成、构建或修改产物。

2.13.0 已发布 ZIP 保持原 SHA-256：`2292ad492b9a4f2c843e254c1384c7c6a4e1e26e79a70fd61fcf9125b91273c7`，本轮只读核对一致，不覆盖旧产物。

## 商店资料与接续条件

- 中英文 listing：`store-listing/zh_CN.md`、`store-listing/en.md`，移除本轮真实批量未完成警告，保留功能说明、TOP 默认、显式 IOP 范围、审核回读及无新增批量清空/自动回滚入口的边界，不含内部样本、账号审核原因、测试计数或平台账号资料。
- 双语版本摘要：`release-notes/releases.json` 的 2.15.0 摘要聚焦共享模板、显式双协议兼容及批量维护，变化条目只描述用户功能；元数据日期为 2026-10-13，标题去掉候选字样。较早版本记录不变；日期和版本链接不是已经发布、打 Tag、上传商店或部署的证据。
- `docs/product-batch-maintenance.md` 保留历史段落及旧预算，并追加 2026-10-13 闭环和当前预算。
- 公共版本说明、双语 listing 及生成源码/输出保持冻结；本轮只更新本 readiness 和 `docs/product-batch-maintenance.md`，不改其他文件，不生成、构建、提交或推送。两个 Markdown 完成格式核对后提供稳定信号，供主流程执行已授权的后续提交/推送准备。

候选准备没有剩余验收阻断项：公共源最终检查 300 文件 / 2,233 项、Worker 23、Node 凭据 2、BFF 2、同一 FROZEN 构建 focused 1/1、full 105/105、授权 9/9、最终 ZIP/校验和及限定范围脱敏审计全部通过。Node 原样本与正式 MV3 真实修改/恢复均已闭环，不再发送恢复请求。候选准备完成不是正式发布；后续合入、Tag/GitHub Release、商店提交或部署仍由主流程按授权执行。本次文档更新没有执行 commit/push 或上述发布动作，也没有平台写入、权限或业务资料变更。

## English release-readiness summary

Version 2.15.0 candidate preparation is complete: all release gates passed. This is not a formal Store release, merge, tag or deployment. Node and formal MV3 live batch change/restoration workflows are closed. TOP stays the backward-compatible default; unmarked historical bundles/settings stay TOP. IOP requires explicit selection/import and has 16 mapped reads with 13 live-account acceptances, plus three accepted Schema writes with confirmed title restoration. Full protocol equivalence is not promised; RFQ and funding remain unsupported in IOP, without fabricated paid amounts, automatic protocol switching or simulated-response fallback. Independent IOP OAuth/renewal/export remains separate.

The original Node sample's trash recovery, IPR rejection and audit wait remain historical evidence. The latest TOP list readback confirmed `approved` / `online`, unchanged category and exact matches for both original root-field fingerprints. Its original batch change and separately authorized restoration are readback-confirmed. The independent recovery job was refreshed to `verified` under its own actor/context with no extra writes; the failed report was backed up with its SHA saved, and the `restored` report links two fresh read receipts and the new recovery job without rebinding the old receipt. This Node closure does not substitute for the formal MV3 sample.

The formal MV3 workflow made three distinct writes, each once: its original group/keyword change; a first restoration that restored only keywords because the value-less group was ignored, confirmed as a known partial result; and one guarded group-only correction with an explicit empty `first_group_id` value. Final readback now matches the full original semantic baseline and all untouched values. The report records `restored-and-confirmed`, `restored=true`, `untouchedFieldsMatched=true` and one correction write; its independent group-clear task is `verified`, with `oldReceiptRebound=false`. Failed/pending reports and old tasks remain preserved, while the correction keeps its own context and receipt. No automatic resend, guessed ID, unrelated-field change, Manifest change or active TOP configuration change occurred. Empty-node compatibility is limited to three declared group paths with omission/value-less/empty representations, at most 27 combinations; non-empty IDs, attributed values and unknown roots stay strict. This acceptance-only correction adds no user-facing bulk-clear or automatic-rollback entry point. Public copy now describes features and post-acceptance review/readback, without internal sample history, test counts or account data.

The public-source final `pnpm check` exited 0 with actual 300 files / 2,233 tests and all included format, lint, i18n, OpenAPI/generated drift, workspace types, Web/AuthPages/Worker dry-run/MV3 build and Store compliance gates passed. Its log is `artifacts/release-2.15-check-public-final.log`. Workspace type success does not eliminate the 33 existing root-script type debts. Worker 23, Node credential 2 and BFF replay 2 tests passed. FROZEN verification at `artifacts/release-2.15-e2e-fingerprint-final-frozen-20261013-185824/verification.json` confirms `allPassedSameBuild=true`: focused batch 1/1, full 105/105 in 5.7 minutes and authorization 9/9 in 38.5 seconds all used the same 205-file / 4,102,165-byte build. Its directory aggregate hash is `ABF27AAEBA710CB6B59DC4BDB47171EA98C51427A1CA636F58E934032DFA2309`.

Historical static-production 96/105, stable-source 105/105 and 104/105 startup-timeout results remain intact. The pre-freeze 185025 105/105 pass is explicitly excluded from final same-build acceptance. The timeout did not recur after freezing; no timeout was changed. Final ZIP size is 1,190,841 bytes / 205 entries, with 4,102,165 unpacked bytes, within the authorized 2,000,000 / 5,470,000-byte budgets. ZIP SHA-256 is `f848acc45e21de71a7838e10033baeb5c71224ec5e8815054bf32e23bb332058`. Known-secret source-delta and all 205 ZIP-entry checks covered 10 sensitive values, with 0 matches and 0 unsafe packaged paths; this does not claim an unrestricted history/unknown-secret audit. The original 2.13.0 ZIP hash is unchanged. Candidate preparation is complete, not publication or deployment.

Native IOP host consent passed with the production Manifest unchanged, exact-domain manual approval and persistent encrypted storage. The accompanying 28-read plan hit Schema failure on the old sample then under review; this was not a consent failure. A separate active-inventory-product run passed all eight operations, including legitimate empty logistics, with its own 28 reads and no TOP/token/write operations. These remain separate evidence, not one flawless full-UI run or restoration proof. No new permissions are introduced; the original 2.13.0 ZIP hash is preserved. Public/generated sources and the final build remain frozen after acceptance. Branch delivery is separate from a mainline merge, formal Tag/Release, Store publication or deployment.
