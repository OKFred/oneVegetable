export const capabilities = {
  title: 'API 能力目录',
  description: '免费目录按审计快照统计；Schema 发品文章接口单列，不计入免费 API 数量。',
  catalogCount: '目录 {count}',
  articleCount: '文章 {count}',
  sources: { catalog: 'API 目录', article: '文档文章' },
  businessScopes: { general: '通用业务', conditional: '需业务资格' },
  search: '搜索 API 方法',
  allDomains: '全部业务域',
  accountSnapshot: '账号验证快照',
  allAccountResults: '全部账号结果',
  accountStatuses: {
    passed: '账号通过',
    noData: '合法空结果',
    permissionDenied: '账号无权限',
    contractDrift: '契约漂移',
    providerError: '上游错误',
    skippedPrerequisite: '缺前置数据',
    notTested: '未测试'
  },
  accountSummary: {
    passed: '账号通过/空结果 {count}',
    denied: '无权限 {count}',
    notTested: '未测试 {count}',
    current: '当前：{source}'
  },
  snapshotExtension: '扩展发布包不内置历史账号验证结果；请在 Web + BFF 模式查看脱敏快照。',
  snapshotChecked: '账号快照检查于 {date}，只表示当时验证凭据的结果，不代表当前配置凭据。',
  snapshotMissing: '账号快照尚未生成。',
  runtimeNotice:
    '{snapshot} 已接入和有文档不代表账号有权限；当前环境列只展示数据源和调用门禁，不代表实时验证成功。接口失败会明确报错，不会展示虚假的成功结果。',
  noMatch: '没有匹配的 API',
  clearFilters: '清除筛选',
  viewApi: '查看 API {method}',
  detailsTitle: 'API 能力详情',
  detailsDescription: '能力定义、调用参数与响应结果',
  checkedAndUpdated: '检查日期 {checked} · 文档更新 {updated}',
  unknown: '未知',
  documentVerification: '文档：{verification}',
  matrixNames: {
    contract: '接入 / 契约',
    documentation: '文档证据',
    replay: 'Replay',
    account: '账号快照',
    current: '当前环境'
  },
  deprecatedNotice:
    '该接口已 deprecated；保留的只读能力在其他门禁允许时仍可调用。废弃状态仅为警告，不代表当前仍受支持或账号已授权。',
  unlistedNotice: '该接口未列出，请核对文档与业务范围；生命周期状态本身不授予调用权限。',
  metadata: {
    title: '权限与业务元数据',
    permissionGroups: '文档权限组',
    businessScope: '业务范围',
    notice: '仅为目录元数据；权限组和业务范围不代表当前账号已获得授权。'
  },
  restrictedFallback: '该能力需要专用业务上下文。',
  requestSchema: 'request: {schema}',
  responseSchema: 'response: {schema}',
  responseExample: '文档响应示例',
  documentedErrors: '文档错误码',
  exampleNotice: '仅为文档示例，不是调用结果，也不代表账号已授权。',
  readonlyExample: '只读文档参数示例',
  parameters: '调用参数 JSON',
  driftTitle: '响应契约漂移 · traceId {traceId}',
  driftRaw: '原始响应仍保留在下方，便于结合 traceId 排查。',
  call: '调用能力',
  disabled: {
    select: '请先选择 API 能力',
    restricted: '该能力需要专用业务资格或上下文',
    unavailable: '该能力当前未启用',
    catalogFailed: '能力目录加载失败，请重试后再调用',
    running: '能力调用正在执行',
    definitionFailed: '能力定义加载失败：{error}',
    definitionLoading: '能力定义仍在加载'
  },
  errors: {
    select: '请选择 API',
    validJson: '参数必须是合法 JSON',
    jsonObject: '参数必须是 JSON 对象',
    invalidParameters: '参数格式错误',
    definitionFailed: '能力定义加载失败',
    definitionMismatch: '返回的能力定义与所选 API 不匹配'
  },
  notices: {
    urlUpload: '该接口只返回普通文件 URL，不返回图片银行 fileId，因此不会用于商品主图、SKU 图或详情图入库。',
    riskSend:
      '这是天鹿风控协议能力。本项目不采集 WUA、UMID、IMEI、IMSI、MAC 等设备环境信息，也不提供发送入口。',
    taskNotify: '这是 URL 爬取供应商的状态回调，不是卖家操作。没有平台下发的真实任务上下文时禁止调用。'
  },
  columns: {
    method: 'API 方法',
    domain: '业务域',
    lifecycle: '生命周期',
    risk: '风险',
    contract: '接入状态',
    documentation: '文档证据',
    replay: 'Replay',
    account: '账号快照',
    current: '当前环境',
    docs: '文档'
  },
  lifecycle: { active: '有效', deprecated: '已废弃', unlisted: '未列出' },
  risk: { mutation: '写操作', read: '只读' },
  matrix: {
    contract: {
      unavailable: ['未接入', '该方法尚未进入可调用契约。'],
      incomplete: ['契约不完整', '缺少请求或响应 Schema。'],
      typed: ['已类型化', '请求、响应 Schema 和生成类型均已登记。']
    },
    documentation: {
      documented: ['已有文档', '已登记平台文档，不代表已接入、账号已授权或实时调用成功。'],
      accountRecorded: [
        '有验证记录',
        '目录记录了历史账号验证；结果与日期请查看账号快照，不代表当前环境已验证。'
      ]
    },
    replay: {
      covered: [
        'Replay 候选',
        '该方法已接入、处于 active、只读且满足文档 Replay 条件；符合条件不代表实时调用成功。'
      ],
      ineligible: ['不适用', '该方法不属于 active、只读且允许真实调用的 Replay 候选。']
    },
    account: {
      passed: ['账号通过', '历史账号验证返回有效数据。'],
      noData: ['合法空结果', '历史账号验证成功，但账号当时没有数据。'],
      denied: ['账号无权限', '历史账号验证被平台权限拒绝。'],
      drift: ['契约漂移', '历史账号验证响应不符合当前契约。'],
      provider: ['上游错误', '历史账号验证遇到平台或网络错误。'],
      prerequisite: ['缺前置数据', '历史账号验证缺少可用于调用的真实前置数据。'],
      notTested: ['未测试', '当前脱敏账号验证快照中没有该方法。']
    },
    current: {
      unavailable: ['调用关闭', '该方法尚未开放调用；已登记的契约与示例仍可查看。'],
      restricted: ['能力受限', '该方法需要额外业务资格或上下文。'],
      mutationClosed: [
        '写入关闭',
        'Web BFF 和扩展的通用调试器均仅允许只读调用；仅显式 Mock 模式可运行写操作示例。'
      ],
      realClosed: ['真实关闭', 'Web BFF 和扩展均未开放该能力的真实调用；仅显式 Mock 模式可运行示例。'],
      replayReadOnly: ['Replay 只读', '文档 Replay 不允许写操作。'],
      mock: 'Mock 数据',
      replay: 'Replay 数据',
      real: ['实时入口开放', '当前 BFF 使用 Alibaba 实时网关；单次调用仍可能被账号权限拒绝。'],
      extension: ['扩展入口开放', '调用由扩展 service worker 发起；是否成功取决于本机凭据和平台权限。'],
      unavailableGateway: '网关不可用',
      detecting: '来源检测中'
    },
    reasonCode: '原因码：{code}',
    checkedAt: '检查时间：{time}'
  }
} as const;
