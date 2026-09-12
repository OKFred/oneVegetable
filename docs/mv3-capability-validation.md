# MV3 API 能力校验器兼容性收尾

日期：2026-09-12。继续在 `codex/showcase-order-product-type` 完成，不部署、不发布。

## 问题与修复

- 正式插件回归在普通类目查询复现旧问题：动态加载校验器失败，随后页面 preload 错误处理又访问 `window`，掩盖原始原因。
- Chrome 扩展 service worker 不支持 `import()`；它支持 module manifest 下的静态 ESM 导入。[Chrome 官方说明](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics#scripts)
- 商品、RFQ、交易、物流、数据、图库、平台七个领域共用校验引擎和同一份 OpenAPI standalone validators。Web/Node 保留懒加载入口，插件后台使用独立静态入口。
- 删除上一轮发品类型的临时独立 validator，不再逐接口打补丁。编译时按领域静态拆块，内容脚本保持单文件。
- 未找到方法或 validator export、validator 返回 false 却没有 errors 时均不视为验证通过。请求仍在出网前拦截，响应漂移保留原始数据、traceId 和结构化告警。
- 不修改收费、资格、ABAC、逐方法 mutation flag、Manifest 权限或公开接口契约。

## 自动验证

- 新增静态/懒加载入口一致性测试：遍历全部方法，分别检查请求、响应和非法 null 数据；覆盖七个领域，包括当前不可调用的受限方法。仅测试契约，不解锁调用权限。
- 正式 MV3 E2E 使用隔离 profile、实际 service worker 和现有契约样本拦截 TOP；遍历当前 active、read、可调用候选。参数非法时验证零请求，其余验证实际签名请求、回执和响应告警。
- 验证非法类目参数、原始 Schema 发布和受限平台接口被拒绝，拒绝后没有额外 TOP 请求。
- 重启测试在隔离 profile 的 `chrome://serviceworker-internals` 点击 Stop，断言 STOPPED，再发送 runtime 请求；断言新的 `performance.timeOrigin` 大于旧值，并正确返回漂移告警。不能用仅刷新 options 页面代替后台重启。
- 12 项定向单测、6 项 Web/正式 MV3 E2E 通过。E2E 包含原有橱窗、持久列设置、首次引导和保险库交互回归。
- 扩展包体门禁新增静态依赖图检查：递归解析 imports/reexports，禁止后台依赖中残留动态 import、远端/裸模块引用、越界及缺失文件。测试覆盖依赖循环和注释/字符串误报。
- 当前解包 `4,086,389` bytes，后台入口 `85,512` bytes，options 初始 JS `127,060` bytes；所有原预算保留，没有上调门槛。

本轮没有访问真实 Alibaba 业务接口。上轮已完成的真实橱窗恢复记录保持独立，不将本次隔离响应 E2E 宣称为新的真实账号验收。

## 复验命令

Windows 下执行，完整单测和类型检查仍由 pre-push 强制运行：

```powershell
pnpm generate:check
pnpm format:check
pnpm lint
pnpm check:i18n
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build:web
pnpm check:web-bundle
pnpm build:extension
pnpm check:extension-bundle
pnpm check:store-compliance
pnpm build:api
pnpm exec playwright test tests/e2e/extension.spec.ts tests/e2e/product-showcase-management.spec.ts --workers=1
```

`build:api` 仅执行 Worker dry-run。未覆盖已发布 v2.6.0 ZIP，未合入 staging/master，未改变线上网站或商店版本。
