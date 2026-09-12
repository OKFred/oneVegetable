# 2.8.0 正式发版准备

检查日期：2026-09-13。准备分支 `codex/release-2.8.0-readiness`，基于已同步的 `staging` / `master` 提交 `3afc07c`。

## 范围与不可变版本

- 本轮准备并创建 `v2.8.0` annotated Tag 和 GitHub Release，发布流水线必须从 Tag 重建并验证产物；不移动或覆盖已发布 Tag/Release。
- 2.7.0 仅有候选包，没有正式 Tag/Release。本版说明同时覆盖自 `v2.6.0` 以来的橱窗、发品类型、MV3 校验及库存功能；不补造 2.7.0 发布记录。
- Worker 部署、Chrome Web Store 上传及审核不由此流程自动执行，也不把 GitHub Release 创建当作商店上架。
- 本轮仅修改中英文版本说明和商店介绍，不新增权限，不执行 Alibaba mutation。

## 既有验收

- 代码基线及合并门禁：995 项单测、全工作区类型检查通过。
- [开发基线 CI](https://github.com/OKFred/oneVegetable/actions/runs/34706534026) 已通过完整检查、Worker 测试、Web/扩展 E2E、BFF replay、Node 凭据 E2E 和打包。正式 Tag 的流水线会重新执行这些检查。
- 从 2.6.0 正式包和 2.7.0 候选包升级到 2.8.0：28 项通过。加密凭据、S3 配置、语言/主题、XML 草稿保留，原有列偏好和未完成传输任务按对应基线核对。
- 升级报告：`artifacts/extension-upgrade/5e54eee5-a992-4311-a9b7-160f9d1a9734/report.json`。使用隔离 Profile，禁止外部 HTTP(S)，不读取真实凭据。
- 真实 Node/MV3 两种库存来源及后台重启后读取均返回合法空结果；真实非空库存和不同商品类型覆盖仍待验收。不把空记录解释为零，也不修改库存制造测试数据。

## 产物与提交资料

- 最终 ZIP 上限 1,500,000 字节；保留其他启动资源、后台和解包门槛。
- 本机正式说明构建：`artifacts/one-vegetable-v2.8.0-chrome-mv3.zip`，999,389 字节 / 140 个文件；解包 4,085,140 字节，后台 97,023 字节，Options 首次 JS 126,937 字节，i18n 309,933 字节。所有门槛与商店合规检查通过。
- 本机 SHA-256：`eacaef552a1c35ed6a4859789764a2688828d885abc5bc1f19fb937e54f556c6`。正式流水线的操作系统不同，最终上传包以 Release 所附校验文件为准，不预先假设 ZIP 二进制跨平台相同。
- 正式来源是 GitHub Release 的 ZIP、同名 `.sha256` 和 `release.json`。下载后应同时核对 SHA-256、长度、Manifest 版本及文件清单。
- 早期 999,142 字节的开发候选保留在 `artifacts/release-2.8-readiness/baseline-3afc07c/`，不与正式产物混淆。2.6.0 与 2.7.0 原包不改动。
- 中英文商店介绍：`store-listing/zh_CN.md` / `store-listing/en.md`，已补充库存只读、批量查询及空记录说明。Manifest 权限与既有版本一致。
- 商店提交前使用正式 Release 下载包，而不是 `chrome-mv3-dev` 或早期候选包；商店发布状态需以开发者后台为准。
