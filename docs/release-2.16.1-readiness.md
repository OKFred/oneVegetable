# 2.16.1 发布准备

检查日期：2026-10-20。基于当前主线的授权体验、模板组合和携图迁移成果，按用户要求准备 2.16.1。旧 `v2.16.0` Tag 保持不可变；不沿用旧候选包或移动旧 Tag。

## 用户可见变化

- 新用户建议先连接 IOP；既有 TOP 应用继续兼容。在线连接、离线单份/双协议 JSON 数组导入分开引导，整份校验后保存，默认授权可记忆。
- 本机保护口令可选，授权工具与设置共享。无口令模式用随机设备密钥；旧口令用户保留原保护，手动锁定仍有效，重启或更新不自动锁定。
- 包含模板变量、顺序组合及携图 ZIP/S3 交换；平台去重时只在用户确认后复用，并核对实际分组及哈希。
- 待办使用 Chrome 同步，旧本机待办需主动迁移；凭据和密钥不参与同步。总览卡片高度统一。
- 中英文商店说明、权限理由、隐私页及审核步骤同步，并重拍中英文各 4 张 1280×800 截图，不再宣传必填口令或空闲锁定。截图使用无真实凭据的隔离 Profile，阻断 HTTP 网络，不提供模拟业务结果。未新增扩展权限或真实写能力。

## 商店更新摘要

中文：

> 2.16.1 简化 TOP/IOP 授权：支持在线连接、离线 JSON 及双授权数组导入，记住默认授权。本机保护口令可选，授权页与设置共用，重启或更新无需重复解锁。新增模板组合、携图 ZIP/S3 交换和待办同步，并修复开发者引导。旧用户与手动锁定继续兼容，平台权限及未知结果保护不变。

English:

> Version 2.16.1 simplifies TOP/IOP setup with online connection, offline JSON or dual-authorization arrays, and a remembered default. Local protection is optional and shared across Authorization and Settings, without automatic locking on restart or update. Includes template composition, image-inclusive ZIP/S3 exchange, to-do sync and developer-guide fixes. Legacy users, manual locking and platform permission safeguards remain supported.

## 验证分层

### 已有真实授权验收

2026-10-19 的干净重装流程已分别获取新的 IOP 和 TOP Token，经用户确认保存后验证商品、图片、视频、订单及总览。TOP 仅从旧包读取原应用资料，未复用旧 Token；旧应用入口不可读不代表新商家可创建旧 TOP 应用。部分 RFQ/排名能力仍受账号权限限制，IOP 单协议存在平台方法差异，不宣传完全等价。

本次发布材料与版本调整不重复执行商品写入，不替换现有授权，不把离线回放说成新的真实 OAuth 验收。原脱敏回执位于忽略目录 `artifacts/auth-tutorial/2026-10-19/`；凭据和原始录屏不进入仓库或 Release。

### 2.16.1 自动化门禁

Windows 验证：329 个文件、2,845 项单测，Worker 隔离 24 项，Web/MV3 114 项，独立授权 26 项，BFF/D1 回放 2 项，Node 凭据及登录 6 项，以及 2.13.0/2.15.1 升级 40 项检查均通过。Lint 保留 31 项既有 warning、0 error。测试没有使用真实账号写入。

首次全量检查发现本机私有工具目录被 Lint 扫描，明确排除已被 Git 忽略的 `.codex/` 后复跑；没有删除私有脚本或降低业务源码规则。末尾合规检查的英文短语大小写也已修正并重新生成隐私页，合规分项通过。修复后完整 Windows pnpm check 已干净通过（release-2.16.1-check-verified.log）；CI 及 Tag 流水线另行核对，失败日志不冒充成功。

日志位于远程忽略目录 `.codex/runtime/release-2.16.1-*.log`。正式 Tag 只能在同一候选通过后创建，GitHub Release 仍需自身流水线通过，不使用旧提交的 CI 结果替代。

Windows 固定构建候选：215 个文件，ZIP 1,269,813 字节、解包 4,347,433 字节、启动 JS 236,885 字节。SHA-256：`e7e2d0683b05057c8104e1d6af384b2391c4899ffc55ec4b1e4c8500848b1e57`。与固定构建逐文件一致，权限及外部连接声明与 2.15.1 正式资产相同；10 个本机真实敏感值扫描没有命中，无环境文件、授权包、Profile、Mock 目录或 sourcemap。最终 GitHub Release 资产的哈希以下载后独立校验为准，不预设其等于 Windows 候选。

## 包体与交付边界

ZIP 不超过 2,000,000 字节，解包不超过 5,470,000 字节，不放宽其他预算。最终检查 manifest、权限、文件清单、SHA-256，以及真实本机敏感值和环境/Mock/Profile 文件混入。正式发布后下载 GitHub Release 资产再次独立校验，再交付商店 ZIP。

用户手工上传和提交 Chrome Web Store。本轮不部署 Worker、网站或静态授权页，不进行商店提交。平台身份验证、授权确认、应用资格和审核仍由用户及 Alibaba 决定。
