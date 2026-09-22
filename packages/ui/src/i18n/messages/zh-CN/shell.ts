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
  editing: {
    title: '放弃未保存的修改？',
    description: '离开后本次编辑不会自动恢复。已保存的配置、批量队列、平台草稿和任务记录不受影响。',
    continue: '继续编辑',
    discard: '放弃修改并离开'
  },
  startup: {
    unlockTitle: '解锁开放平台凭据',
    unlockDescription: '请输入凭据保险库口令，不是 Alibaba 网站密码。稍后解锁仍可查看设置、帮助和版本说明。',
    passphrase: '凭据保险库口令',
    later: '稍后解锁',
    unlock: '解锁',
    unlocking: '正在解锁…',
    unlocked: '凭据已解锁，正在恢复当前页面的查询。',
    unlockFailed: '解锁失败，请检查保险库口令，或前往设置检查凭据状态。',
    cleanupTitle: '清理旧版本地编辑草稿？',
    cleanupDescription:
      '新版不再自动恢复上次商品或 RFQ 编辑。确认后仅清理这些旧本地草稿；取消会保留但不再自动读取。批量队列、平台草稿、任务和列表偏好不会被删除。',
    keep: '保留旧数据',
    clear: '确认清理',
    cleanupFailed: '清理未完成，请稍后在设置的本地数据管理中重试。'
  },
  identity: {
    extensionAdmin: '本机管理员',
    localDemo: '本地演示用户',
    avatarLabel: '当前用户：{name}'
  },
  navigation: {
    dashboard: '总览',
    products: '商品',
    inventory: '库存',
    photos: '素材',
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
      photos: '图片',
      photosDescription: '图片素材总数',
      orders: '订单总数',
      ordersDescription: '订单摘要、资金与物流',
      capabilities: '已启用能力',
      capabilitiesDescription: '项目内已启用的合格能力'
    },
    todo: {
      title: '待办',
      description: '仅保存在当前浏览器，不会同步到后端。',
      placeholder: '添加待办事项…',
      add: '添加',
      empty: '还没有待办事项',
      remaining: '{count} 项未完成',
      markCompleted: '将“{text}”标记为已完成',
      markActive: '将“{text}”标记为未完成',
      delete: '删除“{text}”',
      clearCompleted: '清除已完成（{count}）',
      clearTitle: '清除已完成待办？',
      clearDescription: '将清除 {count} 项已完成待办，未完成的项目会保留。此操作无法撤销。',
      clearConfirm: '确认清除',
      storageError: '无法写入浏览器本地存储，本次更改可能在刷新后丢失。',
      limitReached: '最多保留 {count} 项待办，请完成或删除一些项目后再添加。'
    },
    shop: {
      title: '店铺链接',
      description: '手工设置当前账号的国际站店铺链接。仅保存在本机，不同步到后端，也不会修改平台配置。',
      visit: '访问店铺',
      set: '设置店铺链接',
      edit: '修改链接',
      url: 'Alibaba 店铺地址',
      urlHelp: '从官方店铺页面复制 HTTPS 地址。请移除查询参数和锚点，不填写密码或其他敏感信息。',
      invalid: '请输入 alibaba.com 或其子域名的 HTTPS 地址，不包含登录信息、查询参数、锚点或自定义端口。',
      clear: '清除链接',
      saved: '店铺链接已保存到本机',
      cleared: '店铺链接已清除',
      saveFailed: '无法保存店铺链接，请确认登录和凭据状态，以及浏览器本地存储是否可用。',
      unavailable: '暂时无法确认当前账号或读取本地设置，请解锁凭据或重新登录后再试。',
      contextChanged: '账号或凭据配置已变化，本次修改未保存。请为当前账号重新设置链接。'
    }
  }
} as const;
