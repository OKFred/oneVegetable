# oneVegetable / 一根青菜

Alibaba.com 国际站商品、图片银行和订单运营工具。v2 已迁移到 Vue 3、shadcn-vue、WXT 和 Chrome Extension Manifest V3。

## 工程结构

- `apps/web`：使用 OpenAPI examples 和类型化 MockGatewayClient 的独立演示站。
- `apps/extension`：WXT 管理的 MV3 扩展，真实 API 请求只由 service worker 发起。
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
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm zip:extension
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
- 商品发布、草稿与更新使用 Schema 流程；不再把旧 `product.add/update` 作为主路径。
- `alibaba.seller.order.get` 需要聚石塔，v2 不提供该调用；订单页面组合使用列表、资金和物流接口。
- `docs/alibaba-api-audit.json` 是 2026-08-12 的文档审计快照，共 84 个免费且非聚石塔候选 API。特定 ISV/业务资格接口默认关闭。
- 当前没有真实国际站账号，自动化验证覆盖契约 Mock、签名、适配和 MV3 行为，不代表真实账号 smoke test 已通过。
