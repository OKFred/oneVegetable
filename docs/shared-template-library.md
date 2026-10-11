# 商品详情模板库 / Description template library

## 入口与存储

左侧“模板 / Templates”进入 `#/templates`。模板语言独立选择，不改变 Alibaba 接口语言或界面语言。公司、物流、包装、服务和自定义模板均可预览和可视化编辑；原始安全 HTML 在折叠区内。

| 模式             | 自定义模板存储                                     | 共享范围                   |
| ---------------- | -------------------------------------------------- | -------------------------- |
| Node BFF         | SQLite `product_description_templates`             | 当前站点的有效登录用户     |
| Cloudflare       | D1，同一张表和现有接口                             | 当前站点的有效登录用户     |
| 独立 Chrome 插件 | IndexedDB `one-vegetable:description-templates:v1` | 本机、同一扩展；不要求 BFF |
| Web Mock         | 内存                                               | 演示会话；刷新不保留       |

内置模板只读；自定义模板支持编辑、归档及恢复，没有硬删除。共享写操作保留会话、CSRF、revision 和审计保护。本地写入使用事务校验同语言名称冲突和 revision，跨标签页不能静默覆盖旧版本；本地最多 1000 条。独立扩展的日志 → 本地数据清理也会删除本机模板，**不删除服务器共享模板或 S3 备份**。

## 在商品中使用

商品详情中的“商品详情模板 / Product description templates”合并内置与当前模式的自定义模板。插入光标处、追加末尾，或对照预览并确认覆盖全文。插入后就是普通富文本；内容必须按实际公司、物流及商品情况修改，模板不执行变量、脚本或自动平台更新。智能详情和不安全旧 HTML 仍需先确认转换。

## JSON 与 S3

选择模板后导出，或导入模板包；执行前预览并确认。包仅含 `name/category/language/html/remark`，不包含 ID、审计操作者、凭据或图片文件。图片只保留图库 URL，不复制素材，因此换账号后需要人工检查图片可用性。每包最多 100 条、5 MiB，单条 HTML 不超过 256 KiB。

同语言同名默认跳过，也可另存带 `(2)` 等后缀的副本。**不覆盖已有模板**。写入逐条进行，失败后停止，已完成项保留；结果不明时不要重复导入，应先刷新模板列表核对。

设置页已有 S3 配置时，可选择 S3 模板包；写入独立路径 `<prefix>/<uuid>/templates.json`，不覆盖已有对象。上传后精确回读字节，确认后才提示备份成功。出错后“核对结果”只执行读取，不重复 PUT；换身份或配置后重新打开、重新预览。导入先查询前缀，再读取预览指定包，不自动扫描整个桶。使用现有 S3 请求、授权及扩展域名权限机制，不增加永久权限。

S3 **不是实时模板数据库**，不自动同步、合并冲突或跨设备同步。共享以 SQLite/D1 为准，独立插件以 IndexedDB 为准；S3 用于备份、迁移或人工交换，不改变桶权限、不自动清理对象。

## English quick guide

Open **Templates** from the sidebar. Node and Cloudflare store shared templates in SQLite/D1; the independent extension stores editable templates locally in IndexedDB. Built-in templates are read-only. Active site users can edit shared templates; local templates are not synchronized across devices.

Choose company, logistics, packaging, service or custom content. Insert at the cursor, append, or confirm a full replacement in the product-description editor. Saving a template never updates an Alibaba product. Replace placeholders with accurate information before publishing.

JSON/S3 packages contain portable content only. Imports skip same-language names by default or create copies; they never overwrite. S3 backups use unique paths and require exact readback verification. An uncertain upload is verified, not automatically resent. Clearing extension local data removes local templates, so export backups first.

## 验证边界

自动验证包含契约与 UTF-8/大小限制、无敏感身份导出、冲突策略、分页、IndexedDB 事务、S3 配置变化及不重复写入、共享 SQLite/D1 审计与 revision，以及 Web/正式扩展编辑、归档、恢复和 JSON 往返。

本次本地验证已通过模板专项单元测试、隔离 Worker/D1 回归，以及 Web 模板库、正式独立扩展和原商品详情编辑三条浏览器流程。Node 本地界面也完成了共享模板保存及读回。

2026-10-11 已使用本地 RustFS 完成真实 Node/Web S3 验收：签名查询、唯一对象上传、字节与 SHA-256 回读、同名跳过/另存副本、归档恢复，以及 Web 预览和确认后导入均通过。验收使用隔离 SQLite 和测试模板内容，S3 请求与 API 为真实调用，不修改现有工作台用户或模板。

同日正式独立插件的真实 RustFS 验收也已通过：用户完成原生精确域名授权后，通过设置页加密保存配置，将真实 S3 模板包导入 IndexedDB，再确认导出并精确回读。停止 service worker、刷新工作台后，模板和 S3 配置仍可使用，回读字节保持一致；整个过程不要求 BFF，没有 Alibaba 请求或远端删除。

### 真实 S3 验收命令（Windows PowerShell）

先在设置页保存有效 S3 配置，并启动 `pnpm dev:web`。以下命令读取本机加密配置，不把密钥写入脚本或报告：

```powershell
$env:ONE_VEGETABLE_TEMPLATE_S3_SMOKE = '1'
$env:ONE_VEGETABLE_TEMPLATE_S3_UI = '1'
pnpm smoke:templates:s3:real
```

可设置 `ONE_VEGETABLE_TEMPLATE_S3_DATABASE` 指定配置来源 SQLite；默认只读访问 `apps/api/.data/one-vegetable.sqlite`。执行数据写入独立临时数据库。

添加 `$env:ONE_VEGETABLE_TEMPLATE_S3_EXTENSION = '1'` 可验证构建后的正式独立扩展，需先运行 `pnpm build:extension`，并在有头隔离浏览器中手动允许 S3 精确域名权限。验收脚本先将工作台切到前台，再触发保存，最多等待 10 分钟供用户授权。此项通过真实设置页保存、S3 导入到 IndexedDB、备份回读和 service worker 重启验证，不预授予权限或修改 Manifest。

每次运行仅向唯一测试前缀上传一个小型模板包，开启扩展验收时再备份一个包；对象保留，不自动删除。失败或结果不明不得盲目重跑 PUT，应先按报告中的 key 核对。脱敏回执及仅含测试模板的截图在 `artifacts/template-s3-validation/`；其他模板浏览器记录在 `artifacts/template-library/`，均被 Git 忽略且不进入扩展包。

本轮不部署 Worker、不发布商店、不执行 Alibaba 商品 mutation。Cloudflare 在线 D1、云 S3 及正式发布验收需分别记录，不能由本地 RustFS、隔离回放或构建通过代替。
