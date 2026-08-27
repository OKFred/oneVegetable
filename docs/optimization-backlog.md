# Web 与扩展优化待办

检查日期：2026-08-27

本清单用于保存 Web、BFF 和 Chrome Extension MV3 的后续优化项。真实 Alibaba 验收结果、Mock/Replay 和发布门禁继续分别记录，不互相替代。

## P0：当前迭代

### 扩展包体收口

- 状态：待完成。
- 当前扩展解包体积为 `3,249,839` 字节，距离项目 `3,250,000` 字节门禁仅剩 161 字节。
- 当前 `background.js` 为 `1,722,095` 字节。源码中的领域 validator 虽使用动态导入，但 classic service worker 构建会将其内联到单文件。
- 改为 MV3 ESM service worker，使能力定义和 standalone validator 可按领域共享、分块加载。
- 保留 CSP、无 source map、敏感值扫描及真实 mutation 出网前门禁。

### Mock 验收真实性

- 状态：待完成。
- 商品 Mock 必须按请求的页码和每页条数返回匹配的数据；不能只改变分页文案而重复同一页数据。
- Mock 总数必须和实际可分页 fixture 一致。
- 图库 Mock 使用仓库内的代表性图片 fixture，不依赖会返回 `No Photo` 的远程占位地址。
- 应用运行时 Mock 数据继续只维护在 `mock/data`，通过生成脚本进入共享 fixture。

## P1：稳定性与一致性

- 将各页面的 `mode === 'mock'` 分支逐步收敛为统一的 operation availability，明确允许状态和拒绝原因。
- 拆分商品工作区；Tiptap、Schema 高级编辑和 XML 预览在进入对应功能时再加载。
- 登录页明确区分“工作台本地账号”和 Alibaba OpenAPI 凭据；系统已初始化后隐藏或禁用管理员初始化入口。
- 为 MV3 service worker 被回收后的保险库重新解锁流程提供明确提示，并增加真实 worker 重启 E2E。
- 将订单、商品、向导步骤等上下文写入哈希路由，使刷新和浏览器前进/后退可恢复位置。
- 所有版本文案从 package/manifest 单一来源生成，避免 `2.0`、`2.0.0` 和 `2.0.1` 并存。

## P2：体验与维护

- 补齐移动端菜单名称、表单 `name/required`、键盘路径和自动化可访问性检查。
- 将隐私协议改为构建期生成的中英文静态页面，避免运行时 `innerHTML` 注入，并补 CSP、语言和 canonical 元数据。
- 为用户可见错误统一提供 requestId 复制和脱敏诊断导出入口。
- 清理 OpenAPI 警告基线，让新增告警在 CI 中可识别。
- 评估使用 Chrome Web Store 官方 API 上传草稿包；正式提交和发布继续保留人工确认。

## 分支约定

- 功能分支从最新 `origin/master` 创建。
- 每完成一个独立待办即提交一次，避免把多个风险点压进同一个提交。
- 后续开始新功能前，确保 `staging` 已包含 `master` 的发布与隐私协议提交。
