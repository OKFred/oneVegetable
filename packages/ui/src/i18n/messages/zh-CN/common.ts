export const common = {
  actions: {
    cancel: '取消',
    close: '关闭',
    confirm: '确认',
    save: '保存',
    loading: '正在加载…',
    retry: '重新加载',
    processing: '正在处理…',
    copied: '已复制',
    refresh: '刷新'
  },
  data: {
    empty: '暂无数据'
  },
  sidebar: {
    expand: '展开{title}',
    collapse: '收起{title}'
  },
  pagination: {
    label: '表格分页',
    summary: '共 {total} 条，当前 {first}–{last} 条',
    perPage: '每页',
    perPageLabel: '每页条数',
    rows: '{count} 条',
    page: '第 {current} / {total} 页',
    first: '第一页',
    previous: '上一页',
    next: '下一页',
    last: '最后一页'
  },
  dialog: {
    closeNamed: '关闭{title}',
    closeDetails: '关闭详情'
  },
  imagePreview: {
    title: '图片预览',
    description: '查看图库原图，并支持切换、缩放和旋转。',
    empty: '无图片',
    noPreview: '没有可预览的图片。',
    openOriginal: '在新标签页打开原图',
    close: '关闭图片预览',
    previous: '上一张图片',
    next: '下一张图片',
    zoomOut: '缩小图片',
    zoomIn: '放大图片',
    rotateLeft: '向左旋转',
    rotateRight: '向右旋转',
    reset: '复位图片'
  },
  metric: {
    checking: '状态检测中',
    localCatalog: '本地能力目录',
    confirmedZero: '{source} · 已确认为 0',
    confirmed: '{source} · 已确认',
    upstreamUnknown: '上游未提供可确认总数{reason}',
    permissionDenied: '当前账号无权限{reason}',
    requestFailed: '接口请求失败{reason}'
  },
  dataSource: {
    mock: {
      label: '本地 Mock',
      description: '数据来自 mock/data 契约样例，不会请求 Alibaba。'
    },
    extension: {
      label: '扩展实时网关',
      description: '请求由 MV3 service worker 发起；失败时不回退 Mock。'
    },
    detecting: {
      label: 'BFF 来源检测中',
      description: '正在读取后端运行模式。'
    },
    unavailable: {
      label: 'BFF 来源不可用',
      description: '无法确认后端数据来源；业务请求不会回退 Mock。'
    },
    real: {
      label: 'Alibaba 实时数据',
      description: 'BFF 正在代理 Alibaba 实时接口；失败时不回退 Mock。'
    },
    replay: {
      label: '文档 Replay',
      description: 'BFF 使用已审计的文档回放，不连接 Alibaba。'
    },
    bffMock: {
      label: 'BFF Mock',
      description: 'BFF 返回本地契约 Mock 数据。'
    },
    disabled: {
      label: '业务网关已关闭',
      description: 'BFF 可用，但 Alibaba 业务请求已禁用。'
    }
  },
  error: {
    fallback: '操作失败',
    copyFailed: '复制失败，请手工选中 requestId。',
    diagnosticsMatched: '已导出匹配的脱敏诊断。',
    diagnosticsSummary: '已导出脱敏错误摘要。',
    multipleReasons: '返回了 {count} 条原因：',
    code: '错误码：{code}',
    copyRequestId: '复制 requestId',
    configureCredentials: '前往设置凭证',
    preparingDiagnostics: '正在整理…',
    exportDiagnostics: '导出脱敏诊断',
    platformResponse: '平台返回',
    originalResponse: '原始返回'
  },
  language: {
    switchToEnglish: '切换为英文界面',
    switchToChinese: '切换为中文界面',
    shortEnglish: 'EN',
    shortChinese: '中'
  },
  theme: {
    light: '浅色',
    dark: '深色',
    system: '跟随系统',
    switch: '界面主题：{current}；点击切换为{next}'
  }
} as const;
