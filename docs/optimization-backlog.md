# Web 与扩展优化待办

检查日期：2026-08-28

本清单用于保存 Web、BFF 和 Chrome Extension MV3 的后续优化项。真实 Alibaba 验收结果、Mock/Replay 和发布门禁继续分别记录，不互相替代。

## P0：当前迭代

### 扩展包体收口

- 状态：已完成（2026-08-27）。
- 当前扩展解包体积为 `3,249,839` 字节，距离项目 `3,250,000` 字节门禁仅剩 161 字节。
- 当前 `background.js` 为 `1,722,095` 字节。源码中的领域 validator 虽使用动态导入，但 classic service worker 构建会将其内联到单文件。
- 改为 MV3 ESM service worker，使能力定义和 standalone validator 可按领域共享、分块加载。
- 保留 CSP、无 source map、敏感值扫描及真实 mutation 出网前门禁。
- 完成后 `background.js` 为 `24,682` 字节，扩展解包体积为 `2,822,416` 字节；七个领域 validator 均为独立 chunk。

### Mock 验收真实性

- 状态：已完成（2026-08-27）。
- 商品 Mock 必须按请求的页码和每页条数返回匹配的数据；不能只改变分页文案而重复同一页数据。
- Mock 总数必须和实际可分页 fixture 一致。
- 图库 Mock 使用仓库内的代表性图片 fixture，不依赖会返回 `No Photo` 的远程占位地址。
- 应用运行时 Mock 数据继续只维护在 `mock/data`，通过生成脚本进入共享 fixture。
- 商品和图库现均按请求分页、筛选，并以实际 3 条 fixture 返回总数；跨页不会重复数据。
- 图库的三张代表性 SVG 素材位于 `mock/data/assets`，生成时转为自包含 data URL，Web 与扩展离线也能预览。

## P1：稳定性与一致性

- 将各页面的 `mode === 'mock'` 请求与写入门禁收敛为统一的 operation availability，明确允许状态和拒绝原因；纯运行模式文案和本地存储差异继续保留。（已完成，2026-08-28）
- 拆分商品工作区；Tiptap、Schema 高级编辑和 XML 预览在进入对应功能时再加载。（已完成，2026-08-28）
  - 商品列表主 chunk 从约 `122.90 kB` 降至 `54.79 kB`；编辑工作区、快速发布和高级模式分别成为独立 chunk。
  - Tiptap 仅在实际渲染 HTML 字段时加载；XML 正文仅在高级模式中展开“Schema XML 预览”后加载。
- 登录页明确区分“工作台本地账号”和 Alibaba OpenAPI 凭据；系统已初始化后隐藏或禁用管理员初始化入口。（已完成，2026-08-27）
- 为 MV3 service worker 被回收后的保险库重新解锁流程提供明确提示，并增加真实 worker 重启 E2E。（已完成，2026-08-27）
- 将订单、商品、向导步骤等上下文写入哈希路由，使刷新和浏览器前进/后退可恢复位置。（已完成，2026-08-27）
- 所有版本文案从 package/manifest 单一来源生成，避免 `2.0`、`2.0.0` 和 `2.0.1` 并存。（已完成，2026-08-27）

## P2：体验与维护

- 补齐移动端菜单名称、表单 `name/required`、键盘路径和自动化可访问性检查。（已完成，2026-08-28）
  - 关闭的移动端导航不再进入 Tab 顺序；打开后聚焦首个入口，Escape 关闭并将焦点还给菜单按钮。
  - 本地登录、管理员创建与首次确认表单补齐可访问名称、`name` 和必填语义。
  - Playwright 使用 axe-core 检查 Dashboard、商品列表和移动端导航；同时修正浅色主题辅助文字及主按钮对比度。
- 将隐私协议改为构建期生成的中英文静态页面，避免运行时 `innerHTML` 注入，并补 CSP、语言和 canonical 元数据。（已完成，2026-08-28）
  - 中英文 Markdown 分别生成 `privacy.html` 与 `privacy-en.html`，两页均无脚本并提供语言切换。
  - 页面声明限制性 CSP、`lang`、canonical 和 hreflang；构建与商店合规检查会阻止页面或政策文档漂移。
- 为用户可见错误统一提供 requestId 复制和脱敏诊断导出入口。（已完成，2026-08-28）
  - 网络、BFF 与扩展 runtime 错误保留同一 requestId，主要查询、写入、认证和管理失败统一使用可复制的错误卡。
  - 错误现场只导出脱敏摘要及同 requestId 的会话诊断，不包含请求参数、响应正文或凭证。
- 清理 OpenAPI 警告基线，让新增告警在 CI 中可识别。（已完成，2026-08-28）
  - Redocly 继续执行推荐规则；仅豁免作为运行时契约注册表而未被 HTTP path 引用的 Schema，以及没有人为 4xx 的基础设施探针。
  - 项目级检查明确约束探针只能使用 GET，其余接口只能使用 POST + JSON Body、必须声明 4xx，且不得使用 path/query 参数。
  - 删除历史遗留的分页、商品和订单 URL 参数组件；当前基线为零告警，新增结构问题会直接使质量门禁失败。
- 评估使用 Chrome Web Store 官方 API 上传草稿包；正式提交和发布继续保留人工确认。（已完成，2026-08-28）
  - 使用 V2 `media.upload` 更新既有条目的草稿包，并通过 `fetchStatus` 轮询异步状态；上传 mutation 不自动重试。
  - 工具要求显式 `--confirm-draft-upload`，不实现 `publish`、不在 CI 默认执行，也不持久化 access token 或 service account key。
  - 未配置商店认证时可完成发布 ZIP、SHA-256、版本和目标预检；正式提交审核与发布仍由开发者后台人工完成。
- 清理全量质量链中的剩余构建和 lint 告警。（已完成，2026-08-28）
  - 商品 mutation 测试复用单一 Vue 宿主，不再触发测试文件多组件告警。
  - Worker dry-run 显式选择顶层本地环境，避免 Wrangler 对 staging/production 目标不明确。
  - ErrorNotice 改用 core 精确子路径，Web 将契约、HTML 解析和校验代码拆成独立缓存块；最大 JS chunk 从约 607 kB 降至 456 kB，并加入 500 kB 强制预算。

## 下一迭代：真实数据来源透明化

- Web 对 `VITE_GATEWAY_MODE` 使用严格枚举，无效值阻止启动，不再静默转为 Mock。（已完成，2026-08-28）
- BFF Web 读取 `/meta/get`，全局状态与总览明确区分 `real / replay / mock / disabled / unavailable`。（已完成，2026-08-28）
- 为总览指标增加逐项来源和可用性，区分“真实为 0”、“上游未提供总数”、“接口失败”和“账号无权限”；只展示稳定原因码，不暴露上游响应正文。（已完成，2026-08-28）
- 生成能力真实性矩阵，展示契约、Replay、账号验证和当前运行四个独立维度。（已完成，2026-08-28）
  - 能力目录可按账号验证结果筛选，并明确区分文档验证、CI Replay、脱敏历史账号 smoke 和当前数据源/调用门禁。
  - 历史账号结果只保存状态、稳定原因码和检查时间，不保存账号、requestId、traceId 或响应内容，也不冒充当前配置凭据的实时权限。
- 增加 Mock、Replay、Real 三种 Web E2E，确认页面标识与实际出网路径一致，且真实错误不被 Mock 数据覆盖。（已完成，2026-08-28）
  - 本地 Mock 断言不访问 BFF；Replay 断言所有业务调用进入独立 Worker；Real smoke 断言业务调用只进入本地真实 BFF。
  - Real smoke 对成功和错误响应都扫描 Mock 哨兵值；RFQ 无权限或上游错误时还会检查页面没有回退为 Mock 列表。

## 分支约定

- 功能分支从最新 `origin/master` 创建。
- 每完成一个独立待办即提交一次，避免把多个风险点压进同一个提交。
- 后续开始新功能前，确保 `staging` 已包含 `master` 的发布与隐私协议提交。
