# 2.13.0 发布准备

检查日期：2026-09-27。基线：`cde6b68`（2.12.1）。本版交付统一任务中心、独立日志页与素材文案调整。

## 功能及边界

- 任务中心汇总既有商品、批量队列、图片传输及视频回执，不新建任务数据库，不自动核对、恢复或重发写请求；身份和配置变化时拒绝沿用旧操作。
- 日志位于版本更新下方，整合本地诊断、数据清理和额外主机权限。BFF 请求及操作审计仍仅管理员可见，离开页面后不再自动查询。
- 图片搜索继续是本页名称/图片 ID 筛选，不宣传为全店服务端关键词搜索。视频入口改称“关联商品”，真实关联写入仍关闭。
- 无新增 Manifest 权限、OpenAPI/BFF 协议、migration 或真实写能力，不执行 Alibaba mutation。
- 本轮准备候选包，不创建正式 Tag/GitHub Release，不部署 Worker，不上传或提交商店。商店版本及状态须在上传前人工复核。

## 发布检查

- [x] 六个 workspace、应用内双语版本说明及商店材料同步为 2.13.0。
- [x] Windows `pnpm check`：格式、Lint（0 error / 30 warning）、i18n、契约漂移、134 项离线审计、50/50 replay、类型、269 文件 / 1,802 项单测和三端构建通过。
- [x] 固定同一构建完成 Web/正式 MV3 **97 项** E2E（单 worker、无重试或跳过，5.5 分钟）；BFF replay 2 项、Node 凭据双语 2 项、Worker/D1 21 项通过。
- [x] 从原始 2.12.1 ZIP 完成隔离 Profile 升级，20 项检查通过；加密凭据、S3 设备密钥、语言/主题、列偏好和任务保留，不自动恢复中断写入。
- [x] 最终 ZIP、SHA-256、无凭据/Mock/源码映射扫描、权限及商店合规检查。额外扫描 `.env`、`.env.free` 和授权包中的 7 个本地敏感值，均未进入 ZIP；输出不记录具体值。
- [x] 刷新并逐张查看中英文各四张正式扩展截图，1280×800，空白 Profile，不含测试账号、密钥或模拟商品。

## 产物

ZIP：`artifacts/one-vegetable-v2.13.0-chrome-mv3.zip`，**1,146,182 字节 / 184 文件**。

SHA-256：`2292ad492b9a4f2c843e254c1384c7c6a4e1e26e79a70fd61fcf9125b91273c7`。

- 解包：4,094,113 字节；后台：99,349；options eager JS：190,180；共享 i18n：307,326。所有原预算通过，解包仅余 5,887 字节，下一迭代需先优化而非放宽门槛。
- 最终 ZIP 内 184 个文件逐一与已通过 E2E 的固定构建比对一致。测试后直接打包该构建，没有重新构建覆盖；校验报告：`artifacts/release-2.13.0-package-verification.json`。
- 升级报告：`artifacts/extension-upgrade/52bcd0a8-25d1-4fb2-8dc8-b9265d861c17/report.json`。
- 升级脚本首次新增日志检查时没有关闭应用级传输抽屉，导致日志页面处于遮罩后；同时旧离线拦截误将本地 `getDiagnostics` 当作不支持的网关操作。修复测试为先关闭抽屉、本地诊断走真实扩展 worker 后，20 项全部通过；没有放宽断言或修改生产逻辑。
- 原始 2.12.1 ZIP 未覆盖，其 SHA-256 仍为 `7d1e4602dd8acbfe3f047e70a35b812c59aafca2035edf7071627d728cf1b36e`。
- 检查日志：`artifacts/release-2.13.0-*.log`；截图：`store-listing/assets/screenshots/zh-CN/` 和 `en-US/`；打包后的上架资料：`artifacts/store-listing/`。
- Windows Node 24.16.0、pnpm 11.20.0。BFF 回放沿用隔离端口 18796；本机 5173/8787 真实服务未停止，元信息确认 `gatewayMode=real`、版本 2.13.0。

保持最终 ZIP 不超过 1,500,000 字节、解包不超过 4,100,000 字节及现有分块限制。旧版本包不覆盖。中英文说明见 `store-listing/zh_CN.md`、`store-listing/en.md`；提交清单见 [商店提交清单](store-submission.md)。
