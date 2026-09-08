# 插件独立 S3：实现与验收

检查日期：2026-09-08；候选版本：2.5.0。没有上传商店、发布 GitHub Release 或部署 Worker。

## 使用

1. 插件工作台 → 设置 → S3 素材存储。填写 HTTPS Endpoint、Region、Bucket、访问密钥和根前缀；可选择 path-style。
2. 点击“加密保存”，授予对应存储域名权限，再点击“测试连接”。不要求部署或配对 BFF。
3. 在图库“导入/导出”弹窗选择 S3。导入可按本机规则映射前缀，也可全部导入当前分组；“自动创建缺失分组”默认勾选。导出可平铺或保留图库层级，每次使用独立批次前缀。
4. 保持工作台打开。没有后台定时同步，也不承诺关闭浏览器后继续传输；中断后先核对远端，避免重复上传。

ZIP 限制仍为 50 MiB，S3 单对象限制为 5 MiB。所有图片上传仍经过图库适配器和现有权限策略，不新增商品写能力。

## 安全

- 配置全文 AES-256-GCM 加密到受信任上下文的 chrome.storage.local；独立非导出 CryptoKey 在 IndexedDB，AAD 包含存储标识和 revision。不新增密码，设备配置文件被入侵时仍可能被使用，不等价于用户口令保险库。
- 只有同一扩展的 options.html 可请求 S3；Popup、内容脚本及外部页面拒绝。摘要不返回 Secret、Token 或完整 Access Key。
- 设置保存时按用户手势申请精确 endpoint/bucket origin。所有实际请求重新检查权限，撤销后在签名前拒绝。
- 原生 Fetch 仍由 NetworkManager 集中管理，SigV4 使用既有 aws4fetch，禁止重定向，读写最多一次尝试，JSON/Base64 桥接重新校验大小。
- 保存/清除串行处理并检查 revision。清除全部本地数据也删除 S3 设备密钥。不删除远端对象或图库素材。
- Web 与扩展共享传输组件，原 ZIP 专用重复组件已移除；ZIP 部分成功计数和未知上传保护移入共享实现。

## 自动验证

- 单元：加密、篡改、配置与响应校验、精确权限、撤销拒绝、非法发送者、并发 revision、Base64、大小、路径穿越、错误脱敏及写入不自动重试。
- 组件：共享目录映射及自动创建勾选/不勾选，ZIP 确认前不上传、部分失败不重试、过时预览取消。
- 正式 MV3 包 E2E：S3 设置入口、密文落盘、worker 停止后恢复、密钥输入不回显、Popup 拒绝、清除配置。用已存在必需 origin 的测试配置，不请求网络，不能替代真实存储验收。

## 真实 S3

`scripts/smoke-extension-s3-real.ts` 默认要求人工允许原生权限；凭据仅从用户已有的本地加密 SQLite 配置解密到内存，不打印或保存明文。

本轮默认模式在权限确认阶段超时：`permissionGranted=false`，配置未保存，未执行远端写入。随后显式使用 `ONE_VEGETABLE_S3_PREGRANTED_TEST_HOST=1`：仅在 artifacts 隔离副本 manifest 中预授予同一精确存储域名，原正式 manifest 不改。

隔离副本真实通过：设置保存及输入清空、测试连接、写入 PNG 与 JSON 清单、列举两对象、下载 PNG 且 SHA-256 一致、停止 worker 后再次连接、清除本地 S3 配置。没有 Alibaba mutation，没有删除远端文件。

- 远端相对前缀：`extension-1788846107637-194af7bd`（位于用户已配置根前缀下）。保留一张 2635 字节插件图标和一份清单，不覆盖用户对象。
- 脱敏报告：`artifacts/extension-s3-validation/report.json`；`permissionMode=isolated-manifest-pregrant`，不将原生权限点击或真实撤销记为已验收。
- 图片 PUT requestId：`fcfc2b04-7427-4130-aa14-d00ad742eaee`；GET：`e476df0b-e3cc-4053-a6cb-ed3fc397f412`。

待人工补验：正式包中未预授权的域名 → 保存时点击允许 → 测试连接 → 撤销该域名 → 验证提示重新授权。完整图库目录映射的真实验收沿用 Web/BFF 已完成记录；本轮插件特有验收覆盖直连传输，不新增真实图库上传。
