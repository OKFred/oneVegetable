export const insights = {
  columns: {
    product: '历史采购商品',
    productId: '商品 ID',
    categoryId: '类目 ID',
    price: '历史价格区间',
    publishedAt: '发布时间'
  },
  notReturned: '未返回',
  documentNotReturned: '文档未返回',
  workspaces: {
    performance: '经营排名',
    suppliers: '采购供应商',
    partner: '合作方能力'
  },
  title: '数据与供应商洞察',
  description:
    '整合供应商全站排名和历史信保采购关系；原始响应只在适配层转换，长 ID 不转为 JavaScript number。',
  disclaimer:
    '本页结果仅按官方字段展示，不把排名百分比解释成官方经营诊断，也不推断供应商质量。采购供应商接口需要买家授权身份；未获得权限时仅提供本地契约演示。',
  workspaceLabel: '洞察工作区',
  latestRank: '最新全站排名百分比',
  rankExplanation:
    '官方仅返回日期与 percent，没有定义趋势含义。本项目保留原值，不生成“提升”“下降”或评级结论。',
  timeline: '排名时间序列',
  noRank: '暂无排名数据。',
  historicalSuppliers: '历史信保供应商',
  supplierCount: '{count} 个',
  encryptedOnly: '官方仅返回加密供应商 ID，不补造公司名称。',
  dateFilter: '历史下单时间筛选',
  startDate: '开始日期',
  endDate: '结束日期',
  selectSupplier: '从左侧选择一个加密供应商 ID 查看曾经下过订单的商品。',
  currentSupplier: '当前供应商：',
  noProducts: '暂无历史采购商品',
  partnerTitle: 'CGS 小满签约客户数据查询',
  disabled: '默认关闭',
  partnerDescription:
    '官方标记为免费且不需要用户授权，但接口名称和说明限定 CGS 小满签约客户，请求还要求独立业务 app_secret。因此本项目只保留类型、演示契约和审计记录，不提供调用表单，也不会把密钥放入页面或普通设置。',
  partnerMock: '本地演示模式不模拟真实企业数据。',
  partnerExtension: '扩展 service worker 会在通用调试入口阻止该方法。'
} as const;
