export const feedback = {
  launcher: '提交反馈',
  title: '提交产品反馈',
  description:
    '可在这里截图、预览并复制，然后到 GitHub 手工填写反馈、粘贴截图并提交。也可以直接前往 GitHub。',
  screenshot: {
    title: '当前页面截图（选填）',
    description: '仅在你点击后截取当前应用视口；反馈窗口和已标记的敏感内容不会进入截图。',
    capture: '截取当前页面',
    capturing: '正在截图…',
    retake: '重新截取',
    remove: '移除截图',
    previewAlt: '待提交的页面截图',
    metadata: '{width} × {height} · {size}',
    failed: '截图失败，可重试或直接前往 GitHub 手工反馈。',
    tooLarge: '截图超过大小限制，请缩小浏览器窗口后重试。',
    copyFailed: '未能复制或下载截图，请重试。'
  },
  privacy: {
    title: '公开内容提醒',
    description:
      '截图仅在本机处理，不会自动上传。GitHub Issue 为公开内容，请先检查并移除密码、App Secret、Token、买家隐私等信息，再手工粘贴和提交。'
  },
  actions: {
    copy: '复制截图',
    copying: '正在复制…',
    openGitHub: '前往 GitHub 反馈'
  },
  status: {
    clipboardReady: '截图已复制。请到 GitHub 手工填写反馈，并按 Ctrl+V 粘贴截图。',
    downloaded: '浏览器未允许复制图片，截图已下载，请在 GitHub 手工上传。'
  }
} as const;
