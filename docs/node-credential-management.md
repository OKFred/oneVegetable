# Node 凭据配置与即时生效

Node 工作台管理员现在可以在 `#/settings` 的「Alibaba 凭据配置」操作，管理后台也提供设置入口。这里是当前 BFF 服务所有用户共用的开放平台配置，不是 Alibaba 网站登录密码；普通用户没有配置权限。

## 使用

1. 默认使用「导入授权 JSON」，支持 `credentials.json`、`credentialInfo.json`，最大 1 MiB；文件名不影响识别，内容必须是有效 V1 授权包。
2. 也可展开「高级选项」手动填写 AppKey、AppSecret、Access Token。AppName、Refresh Token、到期时间和备注可选。没有到期时间显示「未知」，没有 Refresh Token 无法自动续期。
3. 二次确认后整套替换并立即生效，不需要重启，不沿用旧 Token，也不会回填已保存的密钥。
4. 主动点击「测试连接」只查询第一页的一条商品，不修改商品，不自动重试。成功仅代表商品列表接口可用，不代表所有能力都有权限。显示 requestId、耗时和分类结果，不返回商品内容。
5. 「清除配置」也需要确认。清除后停止真实业务调用，但不会撤销 Alibaba 平台授权，也不会回退旧文件或环境变量。

配置区支持中英文、暗色模式、敏感输入截图遮罩。导入、保存、清除均影响当前服务的所有用户。更换时本机查询缓存失效，进行中的图库传输停止后续调度；旧请求的迟到结果不会重新写入新账号页面。其他设备须刷新状态；传输任务仍执行服务端上下文校验。

最近连接测试仅保留在当前页面内存；刷新页面后重新显示未测试，避免把历史成功当成当前可用。首次引导仍优先展示。

## 启动、兼容与备份

```powershell
pnpm dev:api:real
```

没有授权包也能启动真实 Node 服务并登录工作台，在设置中完成配置。尚未通过界面接管时，兼容原来的授权文件优先、环境变量后备模式；首次保存或清除后持久记录接管状态，此后凭据缺失、过期、解密失败均不回退。

本地默认数据库是 `apps/api/.data/one-vegetable.sqlite`；加密密钥默认复用仓库 `.data/local-credential-encryption-key`，也可显式设置 `ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY`。Node 直接启动或非本地部署需显式配置密钥；本轮没有修改部署策略或真实写入白名单。

- 备份数据库时同时备份原加密密钥，分别妥善保管。数据库备份包含加密凭据及其他业务配置，不能提交到 Git。
- 已有加密数据但密钥文件丢失时，开发启动器会拒绝自动生成替代密钥。应恢复原密钥，不应删除数据库「解决」错误。
- migration 13 与 SQLite/D1 共用，保留旧 V1 密文及其 AES-GCM AAD。后续保存写内部 V2 文档，手动输入不伪造 OAuth Callback 或 state 证据。
- 正常 Token 刷新保留配置身份；更换/清除改变配置身份。revision 和刷新租约阻止并发覆盖。
- Cloudflare 复用配置面板、加密层及管理接口，继续保留原 Passkey、Browser Run 与手工导入流程。

## 接口与验证

全部保持 POST、JSON Body、requestId，管理员授权及 CSRF：

- `/admin/gateway-credentials/get|import|refresh|clear`：兼容原接口。
- `/admin/gateway-credentials/save`：手动整套替换，提交预期 revision。
- `/admin/gateway-credentials/test`：对当前生效凭据执行明确的只读测试；Mock/replay 环境拒绝真实连接测试。

OpenAPI JSON 是请求/摘要契约来源；新增 standalone AJV validator 和类型化校验入口。测试结果区分成功、合法空结果、无权限、凭据无效、网络失败与响应契约漂移。

离线 UI 回归（不会请求 Alibaba）：

```powershell
pnpm test:e2e:node-credentials
pnpm test:worker
```

显式真实只读验收（需现有本地授权包、运行中的真实 Web 开发服务）：

```powershell
$env:ONE_VEGETABLE_REAL_CREDENTIAL_SMOKE = '1'
pnpm smoke:node-credentials:real
```

可用 `OPEN_API_OUTPUT` 指定授权包、`CREDENTIAL_SMOKE_WEB_URL` 指定 Web Origin；`CREDENTIAL_SMOKE_UI=0` 仅做 API 验收。脚本创建独立 SQLite 与随机加密密钥，不改日常数据库或源授权文件；仅一次商品只读查询，清除后再测会在出网前拒绝。报告、脱敏摘要和截图放在忽略目录 `artifacts/node-credential-management/`。临时库的密钥不落盘，脚本结束后不可恢复，不应用作日常配置。

已知 Token 到期时间不足 10 分钟时，脚本要求先刷新源授权包，避免在临时数据库里轮换正式 Refresh Token。

2026-09-11 本地真实验收通过：空配置启动/登录、JSON 导入即时生效、单条商品读取、手动替换、重启保留、清除后重启不回退、重新导入，以及真实 Web 设置/确认交互。未执行 Alibaba 商品、图库或其他业务写入；未部署 Worker、合入 master 或发布商店。
