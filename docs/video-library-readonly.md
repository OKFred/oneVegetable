# 视频素材只读管理

## 范围与入口

- 图库 → 视频，或直接进入 `#/photos/videos`。`#/photos` 仍为原图片工作区。
- 卡片/列表、列显隐、标题/明文视频 ID 搜索、服务端分页（20/50）、手工刷新。
- 封面/查看打开右侧抽屉；原生播放器不自动播放、不预下载完整视频。关闭、切换视频或离页释放媒体，切入关联区域暂停播放。
- 关联区域按需读取主图/详情关联；每页最多解析 10 个商品，先解密再按明文 ID 精确查商品列表，不扫全店、不调用 Schema。
- 只读能力 `listVideos`、`listVideoRelatedProducts`、`resolveVideoRelatedProduct` 同时用于 Node BFF、Worker、独立 MV3 插件。没有上传、关联修改、删除或新增 mutation flag。

## 文档和契约

采用已有双源政策：TOP 详情为字段主源，国际站目录/权限标签用于准入，不使用网站私有接口代替 OpenAPI。

- [alibaba.icbu.video.query（49930）](https://open.taobao.com/api.htm?docId=49930&docType=2)
- [alibaba.icbu.video.relation.product.list（50709）](https://open.taobao.com/api.htm?docId=50709&docType=2)
- 复用 `alibaba.icbu.product.id.decrypt` 和 `alibaba.icbu.product.list` 的精确查询。
- 文档输入为 `docs/alibaba-video-api-docs.json`，统一运行时契约仍为 `openapi/one-vegetable.json`。通过现有 photo-domain 契约生成器注册方法，并生成独立的视频 DTO standalone validator。
- 两个方法进入 API 能力目录和通用调试器；文档快照离线参与漂移检查，CI 不访问实时文档或 Alibaba。

明文 `id` 与加密 `video_id` / 商品关联标识分开保存。数字 ID 必须在 JS 安全整数范围内；错误/缺失结构不解释为空列表。字段缺失显示“—”，状态、质量、关联数量口径和时长原值不猜测转换。发布人脱敏。

所有请求继续经过 NetworkManager、requestId、ABAC、凭据上下文及 AJV。三项专用操作不自动重试；错误不回退 Mock。缓存仅驻内存，按客户端、模式、账号/凭据上下文、ID、关联类型和接口语言隔离，5 分钟过期。手动刷新绕过缓存，切页/关闭/身份变化停止后续调度并丢弃迟到结果；连续解析的相邻平台请求间隔至少 300ms。

## 2026-09-13 真实交叉验收

另行验证了第二页 20 条、每页 50 条；明文视频 ID 和标题搜索均精确匹配已有样本。

官方页面与授权包以三个明文视频 ID、对应标题和精确关联商品匹配，使用既有主图关联、详情关联、无关联样本，未上传测试素材或改变关联。

| 检查                        | 结果                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| API 视频列表                | 返回 20 条，平台总数 682；不是 Mock                                                            |
| 关联接口及商品解密/精确查询 | 三个样本两类关联均读取成功；主图、详情各一条关联商品与官网一致；无关联样本两类均为空           |
| 原生播放                    | 第二个样本在官网、真实 Node BFF Web、正式 MV3 构建均实际播放；播放器时长 14.36 秒，API 原值 14 |
| 插件后台重启                | 停止 service worker 后，凭据会话恢复并再次读取视频列表成功                                     |
| Worker                      | 仅隔离 workerd 回放验收；没有部署线上 Worker                                                   |

### 平台差异处理

1. 文档示例分别要求查询 `msg_code=200`、关联 `msg_code=0`，真实成功响应未返回此字段。适配器只在成功数据结构完整时接受，返回 `result/msg_code:not-returned` 差异提示；若返回成功码则严格按方法校验，显式失败绝不接受。
2. 官网最初的 `cloud.video.taobao.com` 播放器样本出现过播放失败；换用已有第二个视频后正常播放。真实 API / 官网实际媒体来源为 `play.video.alibaba.com`，故精确加入这一 HTTPS 媒体域名。无代理、转码、远程播放器代码或额外扩展权限。
3. 官网列表与关联页大小不一致：详情关联样本分别为 3.68M / 5.99M，主图关联样本为 2.91M / 8.19M。API 对应原值分别为 3,856,257 / 3,050,950 字节。未覆盖或强行统一不同页面的数值。
4. 14.36 秒的实际播放时长与 API 原值 14 并非完全相同；当前同时展示 API 原值与播放器实际秒数，不据单个样本给全部返回值做单位换算。
5. 官网审核状态与质量分别展示；公开 API 未提供的视频分组/质量检测进度不伪造为可用功能。关联数量仍标记为“平台口径”。

脱敏回执和截图位于忽略目录 `artifacts/video-read-validation/`；不提交账号内容、完整响应、媒体文件或凭据。接口成功、关联匹配、实际播放成功分开记录，单个样本的成功不表示全部视频均可播放。

## 验证命令（Windows PowerShell）

日常离线检查仍用 `pnpm check`、`pnpm test:worker` 和 `pnpm test:e2e`。新增 Mock 全部在 `mock/data/video/`，包括隔离 Web 测试账号；不是 Alibaba 网站账号。

真实只读验证必须显式 opt-in，并事先取得忽略目录中的有效授权包：

```powershell
$env:ONE_VEGETABLE_VIDEO_SMOKE = '1'
pnpm exec tsx scripts/smoke-video-read-real.ts
pnpm exec playwright test --config playwright.video-real.config.ts
pnpm build:extension
pnpm exec tsx scripts/smoke-extension-video-real.ts
```

Web 验收启动独立本地数据库和端口，不使用用户日常工作台账号，不启用真实写操作。插件使用隔离 Chrome profile 和正式构建，不读取用户浏览器的凭据。脚本创建的 profile/数据库均在 artifacts，测试完可手工清理本地证据，不能据此删除远端素材。

为保持既有包体门槛，视频工作区及双语文案懒加载，并在构建期共享 AJV 的重复枚举比较和错误常量；不移除校验、不动态生成代码。不修改 1,500,000 字节 ZIP 和其他独立包体预算。功能验收阶段没有升级版本、合入主线、部署 Worker 或提交商店；后续主线与版本推进见 [2.9.0 发布记录](release-2.9.0-readiness.md)。
