export const shell = {
  brand: '一根青菜',
  documentTitle: '一根青菜 · 国际站运营工作台',
  workspaceTitle: '国际站开放平台运营工作台',
  checkingSession: '正在检查本地会话…',
  primaryNavigation: '主导航',
  openNavigation: '打开主导航',
  closeNavigation: '关闭导航',
  openWorkspace: '打开运营工作台',
  popupDescription: '开发模式由 WXT 自动重载；真实 API 请求由扩展 service worker 发起。',
  logout: '退出',
  identity: {
    extensionAdmin: '本机管理员',
    localDemo: '本地演示用户',
    avatarLabel: '当前用户：{name}'
  },
  navigation: {
    dashboard: '总览',
    products: '商品',
    photos: '图库',
    rfqs: 'RFQ',
    orders: '订单',
    logistics: '国际物流',
    insights: '数据洞察',
    capabilities: 'API 能力',
    admin: '管理后台',
    releases: '版本更新',
    settings: '设置'
  },
  dashboard: {
    title: '运营总览',
    descriptions: {
      bff: '国际站商品、素材与订单工作台。真实请求由本地 BFF 代理。',
      extension: '国际站商品、素材与订单工作台。真实请求由扩展 service worker 发起。',
      mock: '国际站商品、素材与订单工作台。当前使用本地契约演示数据。'
    },
    metrics: {
      products: '商品',
      productsDescription: 'Schema 发品与更新',
      photos: '图库',
      photosDescription: '图库素材总数',
      orders: '订单总数',
      ordersDescription: '订单摘要、资金与物流',
      capabilities: '已启用能力',
      capabilitiesDescription: '项目内已启用的合格能力'
    },
    todo: {
      title: '本地待办',
      description: '仅保存在当前浏览器，不会同步到后端。',
      placeholder: '添加待办事项…',
      add: '添加',
      empty: '还没有待办事项',
      remaining: '{count} 项未完成',
      markCompleted: '将“{text}”标记为已完成',
      markActive: '将“{text}”标记为未完成',
      delete: '删除“{text}”',
      clearCompleted: '清除已完成（{count}）',
      storageError: '无法写入浏览器本地存储，本次更改可能在刷新后丢失。',
      limitReached: '最多保留 {count} 项待办，请完成或删除一些项目后再添加。'
    }
  }
} as const;
