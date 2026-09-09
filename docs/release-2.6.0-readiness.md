# 2.6.0 候选包验收

状态：准备中，仅开发分支。没有创建发布 Tag、GitHub Release、合入 master、部署 Worker 或提交 Chrome Web Store。

## 本次变化

- 图库 ZIP/S3 导入导出进入本机持久任务中心，关闭弹窗或切换工作台页面后继续。
- 刷新后手工恢复；ZIP 重新选择原包，S3 核对源版本和目标内容，成功项不重复上传。
- 逐文件请求回执、分组创建及最终清单均记录。结果不明或目标组未确认时停止，不伪装整批成功。
- Web/BFF 与插件共享规则和任务执行器；插件继续无需后端。
- 明确允许可信私网 RustFS 的 HTTP 连接，默认仍 HTTPS；Worker 不允许私网 HTTP。

## English candidate notes

- A local task center for gallery ZIP/S3 imports and exports continues across dialogs and workbench navigation.
- Resume explicitly after reload. ZIP recovery requires the original archive; S3 recovery verifies object versions and content without repeating confirmed uploads.
- Persist per-file receipts, folder creation and final manifest steps. Uncertain writes or unverified destination groups stop the batch rather than claiming success.
- Shared behavior across Web/BFF and the standalone extension, with explicit opt-in for trusted private-LAN HTTP S3 storage. HTTPS remains the default; Workers do not allow this HTTP exception.

## 真实验收与边界

详见 [任务中心与安全恢复](gallery-transfer-task-recovery.md)。Web/Node BFF 和正式构建插件已分别通过真实 ZIP/S3 导入导出、暂停和手工恢复。RustFS 主机授权由用户在原生 Chrome 权限弹窗中批准，没有修改 Manifest 预授权。

远端 OSS 使用重复图片验证了平台去重：返回已有 fileId 但不改变其原分组。保留需处理任务，第二张没有继续上传。这是安全保护验收，不宣称新分组导入全部成功。

本机忽略目录保留少量测试素材、目标分组和脱敏回执；没有删除远端文件，没有修改商品。密码、访问密钥、授权包和 Mock 响应不得进入候选包。

## 发布检查

最终格式、Lint、类型、OpenAPI/i18n 漂移、全量单测、三端构建、Web/扩展 E2E、Worker/D1 与商店合规检查完成后记录包名及 SHA-256。

应用版本历史明确标为“候选、尚未上架”，链接到本文件；正式发版时再移除候选标记并更新正式 Release 链接。
