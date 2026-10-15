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

商品详情中的“商品详情模板 / Product description templates”合并内置与当前模式的自定义模板。插入光标处、追加末尾，或对照预览并确认覆盖全文。插入后就是普通富文本；内容必须按实际公司、物流及商品情况修改，模板不执行脚本或自动平台更新。智能详情和不安全旧 HTML 仍需先确认转换。

### 固定占位项与组合

新建/编辑模板时，可展开“插入占位项”，在富文本光标处插入 `{{productName}}`、`{{model}}`、`{{packaging}}`、`{{leadTime}}`、`{{companyName}}` 和 `{{shippingOrigin}}`。提供中英文“商品与交付概览（可填）”内置模板，原有模板继续可用。

在商品详情选择一个模板，或勾选多个模板后点击“组合使用”。可调整顺序、移除不需要的片段，检查自动带入的商品信息，并补齐空项，再预览并确认插入、追加或覆盖。只从明确匹配且无歧义的 Schema 标量字段回填；公司信息及无单位的交期不猜测。每次最多组合 10 个模板，组合 HTML 不超过 256 KiB，单个变量最长 2000 个 Unicode 字符。

占位项仅替换正文文本，不执行表达式，不替换链接、图片 URL 或属性。未知占位项、属性中的变量、未填写项及超限内容需先修正才能确认填入；这不是商品提交预检，也不改变平台最终校验。变量值不写回模板、不保存为账号默认信息；JSON/S3 模板包仍保存原始占位项。现有图片 URL 和素材 ID 经同一白名单保留，不查询或上传图片。

确认只修改当前编辑中的详情，未调用 Alibaba 商品 mutation。批量应用到商品、翻译和动态表达式不在本轮范围内；模板图片迁移另走下述显式确认流程。

Fixed placeholders are text-only substitutions, not an executable template language. Combine up to ten templates, review the order and verified product defaults, fill missing details, then confirm insertion, append or replacement. Values remain in the current editor session; saved templates and JSON/S3 packages retain their placeholders. No product is published or updated automatically.

## JSON 与 S3

选择模板后导出，或导入模板包；执行前预览并确认。包仅含 `name/category/language/html/remark`，不包含 ID、审计操作者、凭据或图片文件。图片只保留图库 URL，不复制素材，因此换账号后需要人工检查图片可用性。每包最多 100 条、5 MiB，单条 HTML 不超过 256 KiB。

同语言同名默认跳过，也可另存带 `(2)` 等后缀的副本。**不覆盖已有模板**。写入逐条进行，失败后停止，已完成项保留；结果不明时不要重复导入，应先刷新模板列表核对。

设置页已有 S3 配置时，可选择 S3 模板包；写入独立路径 `<prefix>/<uuid>/templates.json`，不覆盖已有对象。上传后精确回读字节，确认后才提示备份成功。出错后“核对结果”只执行读取，不重复 PUT；换身份或配置后重新打开、重新预览。导入先查询前缀，再读取预览指定包，不自动扫描整个桶。使用现有 S3 请求、授权及扩展域名权限机制，不增加永久权限。

S3 **不是实时模板数据库**，不自动同步、合并冲突或跨设备同步。共享以 SQLite/D1 为准，独立插件以 IndexedDB 为准；S3 用于备份、迁移或人工交换，不改变桶权限、不自动清理对象。

### 模板与图片素材包

原有 JSON 模式保留；导出格式选 **ZIP（模板及图片文件）** 时，将图库图片下载到 `assets/<sha256>.<扩展名>`，`templates.json` 中改为相对图片路径。相同 URL 或相同内容只保存一份文件，原 fileId、图片上的账号元数据、指向原图片的链接及其签名不进入包。正文占位项保留，不代填商家资料。包不包含凭据、审计身份或模板数据库 ID。

- 限制：ZIP 50 MiB、解压总量 100 MiB、最多 500 张图片、单图 5 MiB、清单 5 MiB。仅接受 JPEG/PNG/GIF/BMP，并检查文件头、大小、SHA-256 与清单引用；拒绝路径穿越、重复条目、未声明素材和不支持的 ZIP 结构。
- 导入 JSON/ZIP 自动识别。图片包先选一个**真实图片分组**，检查上传权限并预览，再二次确认。没有图片的 ZIP 不要求 Alibaba 凭据或图库权限。
- 确认后，复用图库传输任务的持久发送记录；上传并按返回的 fileId/目标分组完整分页回读后，才将 URL 和 fileId 写入模板。不能以同名图片代替确认，也不保存缺图模板。
- 两个窗口的同包任务通过 Web Locks 原子认领。相同账号、配置、图片包及目标分组下复用已确认回执；未知上传仅核对，不自动重传。恢复时重新选择原模板 ZIP，图库任务可自动校验其确定性转换后的指纹。
- 任一模板写入失败即停止，已完成模板及图片保留。同名全部跳过时不再上传图片；部分跳过时仍可能传输整个包。图片任务与模板写入不是跨服务事务，不能承诺无孤立图片；不自动删除素材。

#### 相同图片与原分组

Alibaba 可能将相同内容的上传去重，返回已有 fileId，并保留它的原分组；上传成功响应中的请求分组不等于实际归组成功。默认仍要求在指定分组找到确切 fileId，否则停止保存模板，不自动重复上传或移动图片。

确实希望复用图片时，主动勾选 **“复用已存在图片（保留原分组）”** 并再次确认。系统只在全部图片的第一页（最多 100 条）中查找返回的确切 fileId，并下载核对字节数和 SHA-256。匹配后记录实际分组，模板使用已验证的图片；指定分组不会被伪装为实际分组。未找到、内容不符、配置变化或权限拒绝时仍然停止，不扩大为整店扫描。

遇到分组不符后，可关闭弹窗，重新选择**同一个包、同一个目标分组**并启用上述选项；会复用原任务及 requestId，仅核对已发送结果，不再次上传。没有 fileId 或结果仍不明的任务不能据此强制重传。插件会在最终确认点击时申请所需的精确图片域名权限，拒绝权限就不开始本次上传；未新增永久权限。

**Existing-image reuse:** Alibaba can return an existing file ID without moving the image into the requested group. Strict group verification remains the default. Explicitly enable reuse to verify the exact returned ID, byte length and SHA-256 while keeping its original group. Reopening the same package and target reuses the existing durable receipt rather than uploading again. Lookup is bounded to the first 100 gallery images; absence or ambiguity never proves success.

S3 勾选“备份包含图片文件”后，图片和清单分别保存到独立批次前缀，**不上传一个大 ZIP，也不放宽 S3 单对象 5 MiB 限制**。逐个 PUT 后精确 GET 核对，全部图片确认后才写 `templates.json`。结果不明的当前备份只允许读取核对，不重复 PUT；关闭/刷新后不自动续传，保留前缀供人工核查。导入先读清单并校验素材，再按同一图库流程上传；配置或身份变化停止执行，不自动换绑。

ZIP/S3 只是备份与迁移格式，模板仍存 SQLite/D1 或插件 IndexedDB。导入图片会执行真实图库上传，因此仍受管理员、现有权限、CSRF、配置上下文和 mutation 策略限制；保存模板不发布商品。生产错误不回退 Mock。

**English:** Choose ZIP to include gallery images, or enable image files for an S3 backup. Images use content-addressed relative paths; original photo IDs and image hyperlinks are removed. On import, select a real gallery group, review permissions and confirm. Only after uploads are verified by the new file IDs and target group are the templates saved with fresh URLs. Confirmed receipts are reused, uncertain uploads are checked rather than resent, and incomplete templates are not saved. S3 stores individual images and writes the manifest last; it is not a live template database or an automatic background synchronization service.

## English quick guide

Open **Templates** from the sidebar. Node and Cloudflare store shared templates in SQLite/D1; the independent extension stores editable templates locally in IndexedDB. Built-in templates are read-only. Active site users can edit shared templates; local templates are not synchronized across devices.

Choose company, logistics, packaging, service or custom content. Insert at the cursor, append, or confirm a full replacement in the product-description editor. Saving a template never updates an Alibaba product. Replace placeholders with accurate information before publishing.

JSON/S3 packages contain portable content only. Imports skip same-language names by default or create copies; they never overwrite. S3 backups use unique paths and require exact readback verification. An uncertain upload is verified, not automatically resent. Clearing extension local data removes local templates, so export backups first.

## 验证边界

2026-10-15 携图导入整改补验：真实 Node/Web 已完成 ZIP 导出、目标分组严格拒绝、显式复用已有图片、同回执再次导入，以及 RustFS 图片/清单导出、回读和导入，共七项检查。相同内容被平台去重时保留原分组，只有确切 fileId 和哈希核对通过才保存模板；同包恢复未重复上传。正式独立 MV3 的真实 ZIP 导入也已通过：精确图片域名权限检查、原分组/文件哈希回读、再次导入不重传，以及 service worker 重启后模板和回执保留；该项不代表插件 S3 携图流程也已单独真实验收。少量测试图片及备份对象保留，没有商品/库存修改或远端删除。正式发布仍暂停。详情见 [2.16.0 发布准备](release-2.16.0-readiness.md)。以下为此前各阶段的历史记录。

2026-10-15 模板图片素材包：312 个测试文件、2502 项全量单测通过，Worker/D1 隔离回归 9 个文件、24 项通过；Web 模板组合、JSON/ZIP 往返、真实代码路径的 Mock 图库上传/回读及同包回执复用，加上正式独立 MV3 本地模板/ZIP 往返与 1 MiB DEFLATE 素材解析，共 4 项浏览器回归通过。覆盖中英文、暗色、跨窗口旧预览复用未知回执、发送前落盘、配置变化、原图链接脱敏、S3 清单最后写入，以及错误后从弹窗转到任务中心。

格式、Lint（仅保留既有 warning）、i18n、OpenAPI/生成漂移、类型、静态授权页/Web/Worker dry-run/MV3 构建、包体与商店合规检查通过。Windows 全量测试固定最多 2 个 worker，原有 5 秒测试超时没有放宽。最终构建 212 个文件、解包 4,223,348 字节；按正式参数内存测量 ZIP 为 1,229,513 字节，低于现有 2,000,000/5,470,000 字节预算，未替换正式发布附件。

该阶段为离线/隔离验收，当时尚未执行新增图片迁移的真实 Alibaba、RustFS 或云 S3 上传，不能由 Mock 回读、此前 JSON-only S3 验收或构建结果代替。后续真实补验见本节首段。原来的 Node/Web 真实模式本地服务已启动；未重置账号、修改凭据、部署 Worker 或合入主线。截图位于忽略目录 `artifacts/template-materials/`、`artifacts/template-library/` 与 `artifacts/template-composition/`。

2026-10-14 固定变量/组合补验：全量 308 个测试文件、2356 项单测通过；Web 模板变量组合、原详情编辑及模板库往返，加上正式独立 MV3 的本地模板编辑/JSON 往返，共 4 项浏览器验收通过。覆盖模板顺序、商品标题回填、缺失信息、显式确认、变量不回写、中英文、暗色，以及旧模板继续使用。测试使用 `mock/data/template-composition.json` 等隔离样本，未执行 Alibaba mutation，也未重新执行真实 S3 上传。

类型、Lint、i18n、OpenAPI/生成漂移、Web/MV3 构建及商店合规检查通过。最终构建 211 个文件、解包 4,174,078 字节；按正式打包参数在内存中测得 ZIP 1,214,693 字节，未写入或替换正式发布附件。没有新增依赖、权限、数据库 migration 或公共 API。本轮未部署 Worker、合入主线或发布商店；截图位于忽略目录 `artifacts/template-composition/`。

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
