# 本地商品列表连接与交互修复（2026-09-11）

## 现场与结论

- 用户报告 `b6825298-75bc-4066-b3ec-5746fa6c5101`：本地审计显示 `listProductGroups` 在 759ms 后返回 502。另一次同类请求耗时 299ms。
- 商品列表与分组为独立请求，因此列表成功不能证明分组请求也成功。历史审计只存状态和耗时，不能从该 requestId 反推出完整底层异常。
- 同机独立 Node 网络探针复现 `ETIMEDOUT` / `ENETUNREACH`，而 PowerShell 可连接正式网关。Node 调整地址优先顺序和地址族连接尝试时间后，真实网关请求及分组重新读取成功。
- 将该缓解固定在 `pnpm dev:api:real` 的子进程环境：`--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=2000`。保留显式 `NODE_OPTIONS` 配置，不改系统 DNS，不关闭 TLS 校验，不影响 Worker/插件网络配置。
- 识别已知连接错误码，返回脱敏 `NETWORK_ERROR`。Alibaba 只读操作沿用已有有限重试策略；mutation 不自动重发。分组最终失败可单独重试，不再同时显示“暂无分组”。网络不可达时仍可能失败，不宣称从此不会出现网络故障。

## 凭据配置边界

- 插件：设置页现有凭据填写/保险库流程不变。
- Cloudflare 自托管：设置页提示前往管理后台导入授权包，由管理员操作。
- Node：新增明确说明，并非新增网页密钥编辑器。`pnpm openapi:auth` 获取授权包，`pnpm dev:api:real` 默认读取 `artifacts/openapi-auth/credentials.json`；也可通过后端进程环境变量使用 App Key、App Secret、Access Token。
- Node 更改凭据后需重启后端。网页不会读取或回显服务端密钥，网站登录账密不能代替开放平台凭据。

## 列表交互

- 商品标题限制宽度及三行展示，完整标题保留在悬浮提示。
- 商品列上限使用表格容器宽度的 40%，比包含横向溢出区域的整张表格 40% 更严格。真实窗口测得 240px / 表格 1320px。
- 商品 ID 从标题下移除，操作列在“编辑”左侧显示“链接”；提示保留商品 ID。仅使用平台返回地址，新标签页打开并带安全 rel；缺失地址显示占位，不拼接地址。
- 选择、固定列、列显隐及商品导出数据不变。

## 验证边界

真实本地界面使用原有账号和授权包，验证分组列表及设置指引；此修复不新增商品/图库写操作，不更换账号、不部署 Worker。橱窗独立真实验收及恢复记录见 `showcase-mutation-validation.md`。

验证结果：

- Windows 格式、Lint（0 error，保留已有 warning）、i18n、OpenAPI 漂移、类型检查及 898 项单测通过。
- Web、Worker dry-run、正式 MV3 构建通过；33 项 Web/扩展 E2E 通过，包含链接位置、列显隐、固定列、暗色模式和无障碍检查。
- 首次包体检查发现新增文案超额及不应打包的本地登录变量名，已精简并移除。复查通过：扩展总量 4,082,138 字节，双语块 309,933 字节；未修改任何门槛或 Manifest 权限。
- 重启前最近五次真实分组请求均为 200；不带临时 NODE_OPTIONS 重新执行 `pnpm dev:api:real` 后，原登录态仍可用，页面读取 20 个根分组、20 个商品，没有网关错误。
- 日志保存在忽略目录 `artifacts/showcase-mutation-real/ui-fixes-*-20260911.log`。首次全检查停在已修复的包体门槛，修复后单独重跑三端相关构建、包体及商店检查；不将首次失败日志抹去。
