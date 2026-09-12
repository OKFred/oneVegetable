# 商品橱窗管理（2.6.0 候选）

排序、直接替换及按类目查询发品类型的后续改造与真实恢复回执，见 [2026-09-12 增强验收](showcase-order-product-type-validation.md)。下文保留原 2.6.0 加入/移出验收边界。

## 入口与行为

- 商品列表 → 更多 → 橱窗管理：查看总额度、已用/剩余额度及完整橱窗列表。
- 勾选当前页商品后，更多 → 加入橱窗 / 移出橱窗；每次 1–20 个，提交前再次确认对象和公开展示影响。
- 操作表头 → 显示列 → 橱窗：可选状态列，默认隐藏。开启或打开抽屉才读取，查询结果短时复用；未读取不显示为“未加入”。
- 加入仅接受 UI 列表中的在线且尚未加入商品，容量不足会拒绝，不自动替换其他商品。
- 移出将商品 ID 映射为平台返回的橱窗 ID，并在提交前核对映射。它不是删除商品，也不改变上下架状态。
- 中英文、暗色模式、键盘关闭、禁用原因 Tooltip 和结果 Sonner 均已接入。

## 服务与权限

现有 POST `/operations/call` 新增 `getProductShowcase`、`addShowcaseProducts`、`removeShowcaseProducts`，没有增加独立 HTTP 路由。

- Node BFF：`pnpm dev:api:real` 的本地默认白名单加入两个专用写操作，仍要求管理员、会话、CSRF 和对应 operation flag。显式配置 `ONE_VEGETABLE_MUTATION_FLAGS` 时不会覆盖用户配置；修改后需重启启动器。
- 扩展：仅受信 options 工作台可执行写操作；凭据仍在 service worker，精确校验传输上下文，不新增 Manifest 权限。
- Cloudflare：本轮不部署，不改变 self-hosted 固定写白名单。未开放环境仍只读，界面显示限制原因。
- 通用 `callCapability` 不开放这两个原始 mutation 方法；专用入口不能变成任意 TOP 写接口代理。

请求使用同一份 OpenAPI 契约生成的类型和 standalone validators。针对橱窗静态加载精简的原始请求/响应校验器，避免 MV3 service worker 执行页面专用的异步 preload helper。其他领域未在本次重构范围内。

## 回执与恢复

1. 前端冻结选中商品和账号上下文，重新读取容量和目录，获取本 Origin 的 Web Lock。
2. 先将 requestId、动作和相关商品 ID 写入 `one-vegetable:showcase:v1:` 本地记录；保存失败不发送写请求。不保存图片、Token 或完整平台响应。
3. BFF/service worker 再次验证参数、账号配置、额度和移出目标。写操作只发一次，requestId 不作为平台幂等键。
4. 必须取得明确 `result === true`，并分页回读全部橱窗，确认目标变化、原有保留项及数量，才提示成功。
5. 超时、缺失成功字段、回读失败或发现其他并发变化，保留“结果尚未确认”。刷新后显示原动作、商品 ID 和 requestId，不自动重发。
6. 用户可刷新只读结果并到平台核对，再二次确认“我已核对平台结果”；这只解除本地提示，不再次发送。其他窗口正在写入时不能解除。

Web Locks 只保证同一 Origin 内互斥，不能锁住另一个部署、其他设备或 Alibaba 官方后台。平台并发变更仍由前后快照检测。清除全部本地数据需要等待当前写锁，且不会删除远端商品或橱窗；清除后不再保留本机恢复提示。

## 验收边界（2026-09-11）

- 真实 Web/Node BFF：从已登录工作台读取总额度 2、已用 2、剩余 0，实际显示两条橱窗及图片；重启本地启动器后写入口权限正常。没有在本轮再次执行线上加入/移出。
- 真实平台 mutation 的先前受控加入、移出及恢复记录见 [橱窗真实验收](showcase-mutation-validation.md)，不把该脚本验收混同为本轮新界面真实写验收。
- 自动化：Web Mock 验证双语抽屉、确认前不写、移出/加入、可选状态列；正式 MV3 构建使用真实 service worker、保险库、runtime message 和隔离 TOP 响应，验证 CSV 参数、写次数及回读。该测试不是 Alibaba 线上验收。
- 安全用例覆盖配额不足、不完整分页、重复 ID、非法 ID、缺失成功字段、写超时不重试、本地持久化失败、刷新恢复和互斥。
- 本机忽略目录 `artifacts/showcase-mutation-real/` 保存本轮 `showcase-*.log` 检查记录。候选包和完整回归结果见 [2.6.0 发布检查](release-2.6.0-readiness.md)。

## English summary

Products → More → Showcase manages quota and current showcase products. Select products to add or remove with explicit confirmation. A removable showcase entry is identified by its window ID, not a product deletion. Full quota never replaces existing products automatically.

Confirmed success requires an explicit provider acknowledgement and complete readback. Uncertain requests remain locally recorded and are never automatically resent. Users must inspect the platform before clearing the local warning. Web/BFF and the standalone extension share this behavior; Cloudflare deployment and Store publication are not part of this iteration.
