# 橱窗排序、替换与发品类型引导

分支：`codex/showcase-order-product-type`；基于最新 staging，保留 2.6.0 发布包，不自动合并、部署或发布商店。

## 功能入口

- 商品列表 → 更多 → 橱窗管理：按 1 开始的位置上移/下移；边界按钮有禁用提示。
- 每个橱窗提供“替换商品”，分页搜索在线且未加入橱窗的商品，二次确认后直接替换。满额不需要先移出再加入。
- 排序、替换冻结完整有序基线与账号上下文；后台再次读取校验，过期基线不发送 mutation。
- 提交前持久保存 requestId/动作/基线；缺少成功回执、超时或回读不匹配保留待核对状态，不自动重发。恢复提示不会执行逆操作。
- 新增商品选择类目后查询账号可用类型，显示“询盘 / 定制品”和“直接下单品”。仅一种可用时自动选择，但绝不覆盖已加载表单或本地草稿的类型。未知或失败明确提示，不冒充“不支持”。
- 类型查询跟随 Alibaba 接口语言，切换界面中英文不触发请求。现存商品编辑不新增该查询。

## 文档与真实差异

采用 TOP 参数详情及国际站准入标签双源策略。本轮排序、替换契约来自 2026-09-10 离线快照：

- [排序，docId=40996](https://open.taobao.com/api.htm?docId=40996&docType=2)：`window_id`、1-based `source_order/target_order`。
- [替换，docId=40997](https://open.taobao.com/api.htm?docId=40997&docType=2)：`window_id/new_product_id`；明确 `result=true` 才能进入回读确认。
- [发品类型，docId=62123](https://open.taobao.com/api.htm?docId=62123&docType=2)：`type_request.cat_id` 文档为选填，实测不传返回 `biz_success=false`、`msg_code=-5`（category id can not be empty）。因此界面先选择叶类目，再传类目与语言；失败不能只因 contractValid=true 就算成功。

## 2026-09-12 真实受控验收

用户明确允许现有两个橱窗排序后恢复、临时替换后恢复。通过 Windows Node、项目真实 Alibaba gateway / ProductShowcaseAdapter 运行；不是 Mock，也不是新 UI 的线上点击验收。

运行 ID：`4f2bd6cd-7744-4a6a-9c08-f9b332b6e2f2`。完整脱敏回执在忽略目录 `artifacts/showcase-edit-real/`；含恢复所需 ID，不包含凭据或原始响应。不会上传该目录。

| 步骤       | requestId                            | 结果      |
| ---------- | ------------------------------------ | --------- |
| 排序       | e5757657-e7e3-4483-bf37-5c789b01030c | confirmed |
| 恢复排序   | 0980a8fe-08df-492b-a773-37be06b9db70 | confirmed |
| 替换       | 72f0cca1-5a2e-40a7-82ab-92a19ff935e2 | confirmed |
| 恢复原商品 | 275682a8-5ed9-40f5-b3f6-5d49509c0fea | confirmed |

四次均明确成功并完整回读，最终橱窗 ID、商品 ID、順序及额度与原基线相同。没有修改商品内容、上下架、图库或其他业务数据。发品类型带真实类目后返回两种均支持，requestId `94536370-a38a-4c0d-b3e6-4911a78bf692`。

脚本 `pnpm exec tsx scripts/smoke-showcase-edit-real.ts` 默认为只读；写入需显式 `ONE_VEGETABLE_SHOWCASE_EDIT_SMOKE=1`。写模式保留原基线指纹 `.once`，相同基线不得重复执行；异常停止，不自动重复写或清理现场。使用现有测试账号授权包，优先选择带测试标记的在线商品，没有时只选测试账号下非 `dont-edit` 商品。

## 启用边界

自动质量记录（Windows）：全量 211 文件 / 971 单测通过；最终定向 37 单测通过；Web 双语橱窗与正式 MV3 排序、替换、类目类型查询共 3 条 E2E 通过。格式、Lint（0 error，既有 warning 保留）、i18n、OpenAPI/生成漂移、类型、Web/扩展/Worker dry-run 构建及商店合规门槛通过。最终扩展解包 4,090,201 bytes，低于原 4.1 MB 门槛，没有新增权限或覆盖 2.6.0 ZIP。

- 验收后本地 Node 默认白名单和插件受信工作台启用 `sortShowcaseProduct/replaceShowcaseProduct`。Node 显式 flag 配置仍优先，需重新启动本地 real 启动器才载入默认值。
- 仍要求管理员、CSRF（BFF）、runtime 来源（扩展）、账号上下文与请求契约。通用 `callCapability` 不开放原始 mutation。
- Cloudflare self-hosted/staging/production 写白名单不变；本轮不部署。
- 扩展自动回归使用正式构建、真实 service worker 和隔离 TOP 响应，与真实平台验收分别记录。
- 包体优化只在构建期压缩 AJV 中未被代码引用的 Schema 常量分支，保留断言、错误、CSP 与现有体积门槛。
- 正式 MV3 回归发现类型查询的动态校验器加载会进入页面 preload 错误处理，报 `window is not defined`；该接口改用同源契约生成的静态小校验器。其他领域通用调试器的动态加载仍应单独盘点，不将本轮类型查询验收扩展为全能力验收。
- 同时修复扩展只读取方法 envelope、忽略 `simplify=true` 无 envelope 响应的问题，与 Node 的解包逻辑对齐；仍交给方法专属 AJV 与业务成功标志判断，不将缺失字段当成功。
