# 正式版本与回退流程

## 版本载体

每个正式版本同时使用以下两个不可变载体：

- annotated Git Tag `vX.Y.Z`：精确标识实际构建和发布的源码提交；
- GitHub Release：关联该 Tag，保存扩展 ZIP、SHA-256、`release.json` 和版本说明。

`release/X.Y.Z` 不是回退载体。只有需要冻结 RC、同时继续开发下一版本时才从 `staging` 创建临时 release 分支；发布完成后删除。普通版本直接按 `feature → staging → master → tag` 流转。

## 正式发布

1. 将计划发布的功能合入 `staging`，完成回归后合入 `master`。
2. 在发布提交中同步更新根目录、API、Web、扩展、core 和 UI 的稳定 SemVer 版本。
3. 在 Windows 上执行完整发布前检查：

   ```powershell
   pnpm check:release-version v2.0.2
   pnpm check
   pnpm test:e2e
   pnpm test:e2e:bff-replay
   pnpm release:extension
   ```

4. 确认待发布提交已经推送且属于远端 `master`，再创建 annotated tag：

   ```powershell
   git tag -a v2.0.2 -m "oneVegetable v2.0.2"
   git push origin v2.0.2
   ```

5. Tag 会触发 `Publish formal release` 工作流。工作流重新执行版本校验、完整检查、两套 E2E 和可复现扩展打包，然后创建 GitHub Release。
6. 从 GitHub Release 下载 ZIP 并核对 SHA-256 后，再人工上传或提交 Chrome Web Store。Cloudflare 正式部署也必须记录使用的 Tag；Tag 不会自动触发商店提交或生产部署。

如果 Tag 推送后的工作流在 GitHub Release 创建前因自动化故障失败，先在默认分支修复工作流，再从 Actions 的 `Publish formal release` 页面手工运行并输入原 Tag。恢复任务必须检出该不可变 Tag 重新完成全套校验和打包；不得移动 Tag、改用其他提交或覆盖已经存在的 GitHub Release。

工作流只接受 `vX.Y.Z` 稳定版本、annotated tag、与所有 workspace 包完全一致的版本，以及属于远端 `master` 的提交。Tag 或 GitHub Release 一旦发布不得移动、覆盖或复用版本号。

## RC 与紧急修复

- 需要较长冻结期时，创建 `release/2.0.2`，只接受版本、文档和阻断发布的问题修复；最终仍合入 `master` 后再打 Tag。
- 紧急修复从最近正式 Tag 创建 `hotfix/2.0.3`，完成后同时合回 `master` 和 `staging`，并发布新的 patch 版本。不要修改原 Tag 或覆盖原 Release。

## 回退

- 扩展：从旧 GitHub Release 取回已校验 ZIP；Chrome Web Store 是否允许直接降级版本取决于商店规则，通常需要用旧源码构建一个更高 patch 版本重新提交。
- Cloudflare：检出旧 Tag 并重新构建、部署同一源码，同时保留对应 migration 的向后兼容性检查。
- 主线源码：需要撤销问题改动时使用 `git revert` 形成新提交，不重置或强推 `master`。

当前历史 `default` Tag 不作为正式版本基线。只有能够证明旧商店产物对应的确切提交和校验值时，才补录历史版本；不得把当前 HEAD 事后标记为旧版本。
