# 装箱预览 / Packing preview

国际物流 → 装箱预览。填写箱体**内部尺寸**和每件货物的**外包装尺寸**（cm），
以及外包装件数，再点击“生成预览”。“允许旋转及侧放”默认关闭；开启时允许六种轴向排列。
“加载示例”仅在主动点击后填入示例；有输入时替换或清空需要确认。

## 协议与数据边界

| 子能力         | TOP    | IOP    | 运行位置与证据              |
| -------------- | ------ | ------ | --------------------------- |
| 尺寸、数量校验 | 不适用 | 不适用 | 浏览器，整数 mm             |
| 自动排布、统计 | 不适用 | 不适用 | 本地 Web Worker，无平台调用 |
| 三维预览与交互 | 不适用 | 不适用 | 本地打包 Three.js / WebGL2  |

不新增接口、权限、数据库或平台写能力。无授权或无 OneTouch 资格也能使用。
未保存的箱体与货物只保留在当前物流页面内存：切换物流页签保留，离页或刷新清空。
2.26.0 起支持显式保存最多 20 份本机方案，以及不超过 64 KiB 的版本化 JSON 导入/导出。
方案不随账号同步，不自动恢复；打开或导入后由用户重新生成预览。替换输入、同名覆盖和删除需确认。
JSON 只含名称与输入（整数 mm），不信任导入的排布结果；文件为明文，分享前请检查内容。
隐藏页签或窗口时终止计算、释放三维资源；已完成的结果可在返回后重建。
主题、界面语言、视角变化不会查询平台或重新排布。

## 范围与限制

- 单箱/单柜；最多 20 种、合计 500 件；尺寸为 0.1–10,000 cm，最多一位小数。
- 体积降序、低位优先的确定性三维空位分割；固定分为右、前、上三个空间，不合并空位。
  上方空间限定在已放货物的支撑面内。放入结果校验越界、重叠、方向、计数和体积。
- “本次排布未找到可用位置”不代表一定装不下；不做多箱优化，不保证最优。
- 仅按长方体外包装尺寸估算，不计算承重、重心、缓冲及装卸通道，不保证运输安全。
- WebGL2 不可用时仍显示统计与未装入原因；不使用远程渲染或绕过浏览器安全限制。
- 示例：60×50×45 cm；A 20×15×20 cm ×12，B 10×15×10 cm ×8。
  应装入 20 件、已用体积 0.084 m³、空间利用率 62.2%。

## English

Open **International logistics → Packing preview**. Enter internal container dimensions and
the outer dimensions of each package in cm, plus package counts. Rotation and side placement
are opt-in per cargo type. Generate explicitly; editing an input invalidates the old preview.

All validation, packing and 3D rendering run locally. Neither TOP nor IOP authorization applies.
No API, database, extension permission or Alibaba mutation is added. Unsaved inputs survive switching
logistics tabs, but not leaving or refreshing the page. Up to 20 plans can be explicitly saved in this
browser, not synced or automatically restored. Versioned JSON import/export is limited to 64 KiB and
includes only names and validated millimetre inputs. Opening/importing requires a fresh preview;
replacing inputs, overwriting a saved plan and deletion require confirmation. Hidden tabs stop calculations and
dispose 3D resources; completed results are rebuilt on return.

The deterministic heuristic is not an optimal packing solver. Results ignore load limits,
center of gravity, cushioning and loading access; they are not a transport-safety assessment.
WebGL2 failure does not prevent reviewing statistics. Multi-container optimization and automatic
product/order import are not included. See [packing plan reuse](packing-plan-reuse.md) for storage and file boundaries.

Three.js and OrbitControls are bundled locally and lazy-loaded; no CDN or remote executable code.
The dedicated 3D vendor chunk is capped at 1,000,000 bytes. ZIP / unpacked budgets are 2,500,000 /
8,500,000 bytes; existing startup, background, other business chunk and security gates remain unchanged.

## 验收 / Acceptance — 2026-11-07

- 远程 Windows：全量 5,979 项单测通过；原物流试算、订单、地址和草稿测试保留。
- Web 与正式 MV3：3 项端到端测试通过，检查实际 WebGL 绘制调用、视角变化后的图像差异、
  拖动旋转、滚轮缩放、方块点击、图例键盘操作、页签释放重建、刷新清空及 WebGL 不可用降级。
- 中英文、明暗主题、390px 窄屏均检查；测试记录没有平台请求，不需 Alibaba 授权。
- 插件实测 293 个文件、解包 7,212,883 字节、内存 ZIP 2,099,636 字节。
  正式发布包未覆盖；验收不代表装载最优解或运输安全认证。
