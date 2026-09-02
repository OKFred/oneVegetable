export const rfqs = {
  title: 'RFQ 工作台',
  description: 'RFQ 搜索、推荐、详情、已读状态与报价草稿均使用类型化契约。',
  status: {
    demo: '契约演示',
    denied: '当前账号无 RFQ 权限',
    ready: 'RFQ 权限预检通过',
    checking: '正在检查 RFQ 权限'
  },
  permissions: {
    deniedTitle: '当前应用未获得 RFQ API 包权限',
    deniedDescription:
      'Alibaba 返回 {code} / {subCode}。页面已停止继续请求搜索、推荐、详情和已读状态，避免重复失败。',
    checking: '检测中…',
    retry: '重新检测权限',
    marketplace: '前往 Alibaba.com RFQ 市场',
    docs: '查看 RFQ 接口文档',
    failedTitle: 'RFQ 权限检查失败',
    retryLater: '请稍后重试。',
    retryShort: '重新检测'
  },
  mutation: {
    unavailable: '真实附件上传或报价提交未开放',
    uploadUnavailable: '当前环境未开放附件上传',
    submitUnavailable: '当前环境未开放真实报价提交',
    submitting: '报价正在提交，请稍候',
    fillFirst: '请先填写：{fields}',
    closedTitle: '真实报价写操作保持关闭',
    closedDescription: '{reason}；本地报价草稿不受影响。',
    localAvailable: '可保存本地草稿；{reason}。'
  },
  fields: {
    rfq: 'RFQ',
    message: '给买家留言',
    itemName: '商品名称',
    unitPrice: '单价',
    quantity: '数量',
    port: '装运港',
    expiresAt: '有效期',
    currency: '币种',
    quantityUnit: '数量单位',
    shippingTerms: '贸易条款',
    paymentTerms: '付款条款',
    remark: '备注'
  },
  feedback: {
    submitted: 'RFQ 报价已提交。',
    attachmentUploaded: '报价附件已上传并写入当前草稿。'
  },
  errors: { attachmentRead: '附件读取失败' },
  columns: {
    demand: '采购需求',
    quantity: '数量',
    country: '国家/地区',
    remaining: '剩余报价',
    status: '状态',
    deadline: '截止'
  },
  read: '已读',
  unread: '未读',
  notProvided: '未提供',
  equity: {
    quotes: '剩余报价权益',
    topQuotes: '剩余置顶权益',
    score: '市场表现分'
  },
  market: 'RFQ 市场',
  recommended: '推荐 RFQ',
  searchPlaceholder: '搜索采购标题或描述',
  countryPlaceholder: '国家代码',
  unquotedOnly: '仅看可报价',
  search: '查询',
  noMatch: '没有匹配的 RFQ',
  view: '查看 RFQ {subject}',
  detailTitle: 'RFQ 详情',
  sidebarDescription: '详情与报价草稿集中在当前侧栏',
  detail: {
    label: 'RFQ 详情',
    description: '采购要求、贸易条款和买家附件',
    noDescription: '文档响应未提供详细描述。',
    category: '类目',
    destinationPort: '目的港',
    paymentTerms: '付款条款',
    shippingTerms: '运输条款',
    attachments: '买家附件'
  },
  draft: {
    title: '报价草稿',
    description: '草稿仅保存在当前浏览器，不会提前出网。',
    saved: '已保存',
    save: '保存草稿',
    attachment: '报价附件',
    submit: '提交报价',
    missing: '提交前还需填写：{fields}。',
    demoSuccess: '演示报价提交成功',
    success: '报价提交成功',
    quotationId: '{message}，报价 ID：{id}'
  }
} as const;
