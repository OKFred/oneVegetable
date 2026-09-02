export const feedback = {
  launcher: '提交反馈',
  title: '提交产品反馈',
  description: '填写反馈并截取当前页面，然后前往公开的 GitHub Issue 检查并提交。',
  kind: {
    label: '反馈类型',
    bug: '问题',
    experience: '体验建议',
    feature: '功能建议',
    formValue: {
      bug: '问题 / Bug',
      experience: '体验建议 / UX feedback',
      feature: '功能建议 / Feature request'
    }
  },
  fields: {
    title: '标题',
    titlePlaceholder: '简要描述问题或建议',
    details: '详细说明',
    detailsPlaceholder: '发生了什么？你期望看到什么？',
    reproduction: '复现步骤（选填）',
    reproductionPlaceholder: '1. 打开…\n2. 点击…\n3. 出现…'
  },
  screenshot: {
    title: '当前页面截图',
    description: '仅在你点击后截取当前应用视口；反馈窗口和已标记的敏感内容不会进入截图。',
    capture: '截取当前页面',
    capturing: '正在截图…',
    retake: '重新截取',
    remove: '移除截图',
    previewAlt: '待提交的页面截图',
    metadata: '{width} × {height} · {size}',
    required: '请先截取并检查截图。',
    failed: '截图失败，请重试。',
    tooLarge: '截图超过大小限制，请缩小浏览器窗口后重试。'
  },
  privacy: {
    title: '公开内容提醒',
    description:
      'GitHub Issue 和其中的截图将公开可见。请确认截图与文字不包含密码、App Secret、Token、买家隐私或其他不应公开的数据。',
    acknowledge: '我已检查文字和截图，可以公开提交。'
  },
  actions: {
    openGitHub: '复制截图并前往 GitHub粘贴',
    opening: '正在准备 GitHub…'
  },
  readiness: {
    title: '还需填写至少 3 个字的标题。',
    details: '还需填写至少 10 个字的详细说明。',
    screenshot: '还需截取并检查当前页面。',
    acknowledgement: '还需勾选“可以公开提交”。',
    ready: '已准备好，可以复制截图并前往 GitHub粘贴。'
  },
  status: {
    clipboardReady: '截图已复制。请在 GitHub 的截图区域按 Ctrl+V 粘贴。',
    downloaded: '浏览器未允许复制图片，截图已下载，请在 GitHub 手工上传。',
    popupBlocked: 'GitHub 页面被浏览器拦截，请允许弹窗后重试。'
  },
  errors: {
    invalid: '请填写标题和详细说明。',
    urlTooLong: '反馈内容过长，无法安全预填 GitHub，请缩短详细说明或复现步骤。'
  }
} as const;
