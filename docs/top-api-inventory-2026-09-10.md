# TOP 文档全量目录筛查与国际站增量能力盘点

## 结果与边界

2026-09-10 通过用户提供的公开文档 JSON 接口采集，未使用网站账号、浏览器 Cookie 或 Alibaba 网关凭据，也没有调用任何业务接口。正常匿名访问文档页获取会话及 CSRF Token 后，两个接口返回 success=true；直接跳过会话会得到 HTTP 成功但业务失败的“页面已过期”。临时 Cookie/Token 只在进程内存中。

来源：[目录接口](https://open.taobao.com/handler/document/getApiCatelogConfig.json?docId=58734&docType=2)、[国家列表文档](https://open.taobao.com/handler/document/getDocument.json?docId=58734&docType=2&isEn=false)。网页 docId=58734 已确认对应 `alibaba.icbu.product.country.getcountrylist`；此前用户粘贴全文缺少编号，后续接入迭代可补齐运行时目录链接，本次不修改它。

| 口径                                          | 数量 |
| --------------------------------------------- | ---: |
| 全站目录去重文档                              | 7020 |
| 当前 TOP 目录中与项目相关                     |  143 |
| 旧国际站审计中仍可读取、但当前 TOP 目录未列出 |   41 |
| 实际读取详情（全部成功）                      |  184 |
| 已有项目审计记录                              |   86 |
| 新发现条目                                    |   98 |

新发现的 98 项分为：通用免费候选 21、业务/权限有条件候选 31、聚石塔内调用 45、实际属于 1688 的接口 1。已有 86 项中，74 项保留既有记录，12 项沿用项目的 deprecated 标识。目录消失不等于接口下线；此筛查也不是对淘宝全站所有业务的接入承诺。

全部 184 项详情都标为“免费”或“开放平台免费API”，但 API 免费不等于业务服务、广告消耗或物流免费，更不等于任意 AppKey 可以调用。没有把本次文档结果记为 account-verified，也没有加入可调用契约或开启真实写操作。

## 优先考虑的 21 项（全部必须用户授权）

以下读写判定仅用于规划，不用于自动启用权限。视频关联接口根据视频/商品两个 ID 入参和布尔结果按写操作处理，不能仅因方法包含 detail 就视为查询。

| 方法                                                                                                                     | 用途与建议                                                                 | 读写 |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---- |
| [alibaba.icbu.product.type.available.get](https://open.taobao.com/api.htm?docId=62123&docType=2)                         | 查询商家可发品类型，减少新建商品时盲选类型                                 | 读   |
| [alibaba.icbu.product.inventory.get](https://open.taobao.com/api.htm?docId=64125&docType=2)                              | 商品库存信息，先作为按需扩展列/详情                                        | 读   |
| [alibaba.icbu.product.sku.inventory.get](https://open.taobao.com/api.htm?docId=57873&docType=2)                          | SKU 库存，商品规格维护的基础                                               | 读   |
| [alibaba.icbu.product.inventory.update](https://open.taobao.com/api.htm?docId=53178&docType=2)                           | 库存维护；待查询回读链路和真实权限验收后考虑                               | 写   |
| [alibaba.icbu.product.logistics.country.getcoststatus](https://open.taobao.com/api.htm?docId=58733&docType=2)            | 国家运费确定性，需重量、体积、运费模板、MOQ 和售卖类型；不能当作无条件报价 | 读   |
| [alibaba.icbu.product.id.encrypt](https://open.taobao.com/api.htm?docId=50558&docType=2)                                 | 视频/专题等链路的商品 ID 格式转换；按需使用，不改变内部主键                | 读   |
| [alibaba.scbp.showcase.list](https://open.taobao.com/api.htm?docId=40938&docType=2)                                      | 查看橱窗商品，可从商品列表进入                                             | 读   |
| [alibaba.scbp.showcase.status](https://open.taobao.com/api.htm?docId=40936&docType=2)                                    | 橱窗总数与使用数量                                                         | 读   |
| [alibaba.scbp.showcase.addproduct](https://open.taobao.com/api.htm?docId=40964&docType=2)                                | 批量加入橱窗                                                               | 写   |
| [alibaba.scbp.showcase.deleteproduct](https://open.taobao.com/api.htm?docId=40963&docType=2)                             | 移出橱窗，不是删除商品                                                     | 写   |
| [alibaba.scbp.showcase.sort](https://open.taobao.com/api.htm?docId=40996&docType=2)                                      | 调整橱窗顺序                                                               | 写   |
| [alibaba.scbp.showcase.updateproduct](https://open.taobao.com/api.htm?docId=40997&docType=2)                             | 替换橱窗商品                                                               | 写   |
| [alibaba.icbu.video.query](https://open.taobao.com/api.htm?docId=49930&docType=2)                                        | 视频列表，可作为图库后续“视频”页签                                         | 读   |
| [alibaba.icbu.video.relation.product.list](https://open.taobao.com/api.htm?docId=50709&docType=2)                        | 视频关联的商品 ID；区分主图视频和详情视频                                  | 读   |
| [alibaba.icbu.video.upload](https://open.taobao.com/api.htm?docId=50133&docType=2)                                       | 视频上传；不能直接复用图片上传的格式/大小限制                              | 写   |
| [alibaba.icbu.video.relation.product.detail](https://open.taobao.com/api.htm?docId=50088&docType=2)                      | 将视频关联到商品详情                                                       | 写   |
| [alibaba.icbu.video.relation.product.main](https://open.taobao.com/api.htm?docId=50089&docType=2)                        | 将视频关联到商品主图                                                       | 写   |
| [alibaba.icbu.industry.topic.list](https://open.taobao.com/api.htm?docId=58593&docType=2)                                | 行业定向征品主题                                                           | 读   |
| [alibaba.icbu.topic.products](https://open.taobao.com/api.htm?docId=58594&docType=2)                                     | 符合主题的商品列表；不等于执行活动报名                                     | 读   |
| [alibaba.icbu.trade.assurance.account.get](https://open.taobao.com/api.htm?docId=31686&docType=2)                        | 信保开通状态及额度；非资金扣款接口                                         | 读   |
| [alibaba.onetouch.logistics.express.logistics.solution.semi.list](https://open.taobao.com/api.htm?docId=70438&docType=2) | 半托管订单线路，需要真实订单及批次等前置数据                               | 读   |

合计 13 项读、8 项写。建议下一批先验证商家发品类型、商品/SKU 库存、橱窗查询/状态这 5 个只读接口；其次视频查询/关联列表；写功能独立验收，不由本报告自动开放。

## 31 项有条件候选

完整方法名、文档 ID、授权标签、适用应用和入参/出参字段保存在脚本生成的 inventory.json / inventory.md 中。

| 权限/业务领域          | 数量 | 建议                                                                                                                                                   |
| ---------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ICBU 翻译能力          |    2 | `alibaba.icbu.text.recognize`、`alibaba.icbu.text.recognize.trans`；与既有 text.trans 同权限组，但尚未真实测试，不把前一接口的拒绝结果复制成已验证结果 |
| 国际站海外分销         |    2 | `alibaba.icbu.distribution.product.query/get`；不是普通卖家全部商品列表的替代品                                                                        |
| 国际站 DropShipping    |    9 | 选品、下单、支付、运费、物流轨迹、店铺保存；是独立买家/分销业务，不接入普通卖家订单页；支付接口后置                                                    |
| ICBU 直播              |    2 | 直播间商品列表与推品，需先具备直播业务场景                                                                                                             |
| 站外店铺继承三方服务商 |    5 | shopclone 4 项和 supplierfoster 通知 1 项；专用项目权限，不作为通用店铺管理                                                                            |
| ACP 小满               |    4 | 准入、关联、确认函、主动通知；特定合作方能力，默认只留记录                                                                                             |
| 国际站服务市场         |    7 | 优惠券校验、服务商订单、客户关联、购买授权和客户回写；不是卖家的实物商品交易订单                                                                       |

## 暂不接入的 46 项

- 国际站外贸直通车 40 项、额外数据管家 5 项：详情均有“聚石塔内调用”标签。无论 API 是否免费，都不直接接入本地插件/普通 BFF；不能因为请求在技术上能发出就尝试绕过。
- `alibaba.trade.aliance.create`：权限组实际是“1688推客(交易相关)”，虽然方法名前缀容易混淆，本项目排除。
- 上述计数不包含已有的 12 个废弃接口；这些继续保留原有生命周期标记。

## 脚本与复查

Windows 执行 `pnpm exec tsx scripts/audit-top-api.ts`。默认顺序读取，间隔 300 ms，单请求超时 30 秒，响应上限 16 MiB，不自动重试、不持久化 Cookie、不读取 .env。输出均在被 Git 忽略的 `artifacts/top-api-audit/`：两个种子 JSON、7020 项目录索引、184 项原始详情、完整 JSON/Markdown 清单。

`pnpm exec tsx scripts/audit-top-api.ts --offline` 只读取本机快照重新分类，保留原采集时间；不再请求官网。纯函数测试样本在 `mock/data/top-api-audit.json`。公开目录会变化，以上数量只代表此次返回的可见目录；权限组/特殊资格采用保守规则初筛，需要逐项人工确认后才能作为正式接入决策。

本次没有合并运行时目录、更新 OpenAPI、修改 feature flag、重新部署 Worker 或提交商店。该文档是盘点记录，不是实现完成声明。
