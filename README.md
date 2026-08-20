# oneVegetable / 一根青菜

Alibaba.com 国际站商品、图库（图片银行）、RFQ、交易、国际物流和数据洞察运营工具。v2 已迁移到 Vue 3、shadcn-vue、WXT 和 Chrome Extension Manifest V3。

## 工程结构

- `apps/web`：独立演示站；默认只使用 `mock/data` 生成的类型化 Mock，显式切到 BFF 后不会静默回退。
- `apps/extension`：WXT 管理的 MV3 扩展，真实 API 请求只由 service worker 发起。
- `apps/api`：共享 Hono 应用，分别运行于 Node.js + SQLite 和 Cloudflare Workers + D1。
- `packages/core`：OpenAPI 生成类型、AJV standalone validators、签名器、API 审计目录和网关客户端。
- `packages/ui`：Web 与扩展复用的 shadcn-vue 风格后台界面。
- `legacy/v1`：原 Manifest V2 项目及构建产物的只读归档。

## 环境与命令

使用 Node.js 24 Active LTS 和 pnpm 11：

```bash
pnpm install
pnpm dev:web
pnpm dev:extension
```

其他常用命令：

```bash
pnpm generate          # OpenAPI TypeScript 类型和 AJV standalone validators
pnpm audit:apis        # 更新官方免费、非聚石塔 API 审计快照
pnpm snapshot:product-docs # 从人工确认后的文档输入更新商品域快照
pnpm snapshot:rfq-docs     # 重新生成 RFQ 官方文档离线快照
pnpm snapshot:trade-docs   # 重新生成交易域官方文档离线快照
pnpm snapshot:logistics-docs # 重新生成物流域官方文档离线快照
pnpm snapshot:insights-docs  # 重新生成数据与供应商领域离线快照
pnpm snapshot:photo-docs     # 重新生成图库（图片银行）领域离线快照
pnpm snapshot:platform-docs  # 重新生成平台协作能力离线快照
pnpm typecheck
pnpm test
pnpm build
pnpm check:extension-bundle
pnpm test:e2e
pnpm test:e2e:bff-replay # 重建隔离 D1，启动 Worker/Web，验证认证后的全领域 BFF 读链路
pnpm check:replay-coverage # 校验所有可真实调用的只读能力都有有效文档回放
pnpm openapi:auth         # Windows 本地有头浏览器获取 OpenAPI 授权包
pnpm release:extension # 可复现 ZIP、SHA-256 与 release.json
pnpm capture:store-assets # 从构建后的扩展刷新 1280×800 商店截图
```

## 扩展调试

日常开发使用 `pnpm dev:extension`。WXT 会启动独立 Chromium profile，并在 options、popup、service worker、content script 或 manifest 变化后自动更新/重载扩展；不需要像 MV2 一样每次打开 `chrome://extensions` 手工点击“重新加载”。

Chrome DevTools 适合检查 options 页面、service worker、Network 与 `chrome.storage.local`。Playwright 使用构建后的 `.output/chrome-mv3` 做安装和回归测试，不承担日常热更新。

手工加载生产构建时：

1. 执行 `pnpm build:extension`。
2. 打开 `chrome://extensions` 并开启开发者模式。
3. 选择“加载已解压的扩展程序”，目录为 `apps/extension/.output/chrome-mv3`。

## API 与验证边界

- 正式网关为 `https://eco.taobao.com/router/rest`，支持 `hmac`、`md5` 和 `hmac-sha256`，默认 `hmac`。
- 商品发布、草稿与更新使用 Schema 流程；新建商品通过 `schema.get` 获取类目模板，编辑已有商品通过 `schema.render` 加载现有值，不再把旧 `product.add/update` 作为主路径。
- 商品页分为商品列表、Schema 发品/编辑、类目与分组、质量与上下架四个工作区。Schema XML 会解析为七类可视化字段，并保留只读 XML 预览与未知节点。
- Schema 中 `valueTypeRule=html` 或 `superText` 会使用受限 Tiptap 编辑器；仅维护 `productDescType=2` 的普通详情。智能详情和不受支持的旧 HTML 默认原样只读，查看变化并二次确认后才转换。
- 主图、SKU 图和详情图复用国际站图库选择器。Web Mock 支持分组/分页选择、本地上传和外部 URL 转存；真实上传、转存和商品更新在账号 smoke test 前保持禁用。
- 详情整改面板区分 `Alibaba Schema`、`官方提示` 和 `项目建议`。只有 Schema/契约硬错误阻止提交；内容长度、结构、SEO、图片质量和官方评分提示均不阻止提交。
- `openapi/one-vegetable.json` 是运行时唯一契约；商品、RFQ、交易、物流、洞察、图库和平台协作文档 JSON 是离线生成输入。商品快照包含 25 个目录 API 和 2 个文章来源 Schema 发布 API；RFQ 快照包含 7 个目录 API；交易分类的 27 个方法中，26 个进入类型化快照；物流快照包含 14 个官方物流分类方法和 1 个商品域运费模板方法；洞察快照包含 2 个数据接口和 2 个采购供应商接口；图库快照包含 4 个官方目录 API；平台协作快照包含最后 3 个目录 API。CI 不访问官方文档站。
- 审计目录中的 84 个候选方法均已具有方法关联的请求/响应映射和 CSP 安全 standalone validator。非法请求不会出网；响应漂移会保留原始数据、`traceId` 和结构化告警。类型化不等于业务资格或真实账号验收。
- RFQ 工作台提供市场搜索、推荐、详情、最多 20 个 ID 的已读状态、报价权益和浏览器本地报价草稿。`alibaba.icbu.annex.upload` 按官方 RFQ 分类归入该领域；真实附件上传和提交报价在账号 smoke test 前保持禁用，Web Mock 可走通完整报价流程。
- 所有真实 mutation 方法均为逐方法 feature flag 关闭，Web Mock 可完整演示写流程；UI 没有自行开启真实写操作的入口。
- `alibaba.seller.order.get` 需要聚石塔，v2 不提供该调用；订单工作台组合列表、资金和物流，并提供履约通道、服务费率、TT 信息与地址 Schema。敏感交易数据不做页面持久化，真实交易写入继续关闭。详见 [交易域说明](docs/trade-domain.md)。
- 国际物流工作台覆盖地址字典、特殊商品属性、运力列表、运费试算、物流订单、面单和下单草稿。14 个 OneTouch 方法因业务资格和账号状态在扩展中默认关闭；Web Mock 可完整回归，运费模板保持独立可查询。详见 [物流域说明](docs/logistics-domain.md)。
- 数据洞察工作台展示供应商全站排名时间序列，以及买家历史信保供应商与下单商品。页面不推断排名含义、不补造供应商名称，并保持长 ID 为字符串。CGS 小满签约客户接口默认关闭且不提供业务密钥表单。详见 [数据与供应商洞察说明](docs/insights-domain.md)。
- 图库工作台支持三层分组管理，展示文件大小、引用数量、更新时间与图库 `fileId`，并对未引用和低于 750 × 750 的素材给出非阻断建议。真实分组操作、上传和 URL 转存在账号 smoke test 前保持关闭。详见 [图库域说明](docs/photo-domain.md)。
- 普通文件转存、天鹿风控和 URL 爬取任务通知归为平台协作能力。文件转存不会冒充图库入库；风控和任务回调不提供页面采集或发送入口，并由 service worker 二次门禁。详见 [平台协作能力说明](docs/platform-domain.md)。
- MV3 默认只申请 `storage` 和正式网关主机权限；自定义网关与外部图片来源在用户执行对应操作时按需申请主机权限。设置页可导出或清空最多 100 条会话级脱敏诊断，且构建会执行权限与体积预算检查。详见 [MV3 发布加固说明](docs/mv3-release-hardening.md)。
- 开放平台凭证使用用户口令派生的 AES-256-GCM 密钥加密保存；local/session 存储对内容脚本不可见，口令不落盘，默认空闲 15 分钟或 service worker 重启后自动锁定，旧版明文设置必须显式迁移。遗忘口令只能清除后重新配置，威胁模型与恢复边界见 [凭证保险库说明](docs/credential-vault.md)。
- RC 构建会迁移旧设置、允许查看/撤销额外主机权限、只对只读请求执行有限重试，并生成可复现 ZIP 与 SHA-256。CI 只保存产物，不自动上架。详见 [RC 发布准备说明](docs/rc-release-readiness.md)。
- 扩展首次使用会显著说明凭证、权限、Mock 与真实验收边界；设置页可导出不含具体值的数据清单并彻底清除本地数据。商店文案、隐私政策、真实扩展截图和仍待人工完成的阻断项见 [Chrome Web Store 提交清单](docs/store-submission.md)。
- `docs/alibaba-api-audit.json` 是 2026-08-13 的文档审计快照，共 84 个免费且非聚石塔候选 API。特定 ISV/业务资格接口默认关闭。
- 已提供本地 OpenAPI 授权包获取工具，但真实 API 验收结果仍以显式的 real smoke 报告为准；契约 Mock、签名、Replay 和 MV3 行为不等于真实账号验收。2026-08-20 最新一轮真实只读 Smoke 为 35 项候选中 22 项通过、5 项权限不足、1 项上游错误、7 项缺少前置数据，契约漂移为 0；真实 Web 页面 Smoke 同时确认核心查询没有回退到 Mock，并已跑通真实商品列表到 Schema 可视化解析及评分的只读链路。

## 商品详情 Mock 场景

执行 `pnpm dev:web`，进入“商品 → Schema 发品/编辑”：

- 商品 ID 留空：安全的普通详情，可直接可视化编辑。
- 商品明文 ID 填 `10000002` 后获取 Schema：智能详情只读与显式降级流程。
- 商品明文 ID 填 `10000003` 后获取 Schema：含未知标签、样式和 iframe 的旧详情转换差异。

图库 URL 转存会先拒绝凭据 URL、本机、回环、私网与 link-local 字面地址，逐跳检查重定向，验证图片 MIME，并以 20 MiB 或 Schema 更小值限制下载。service worker 随后调用 `alibaba.icbu.photobank.upload`，不会使用只能返回 URL 的 `file.urlposting.upload`。
