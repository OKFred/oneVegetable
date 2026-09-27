export const logs = {
  title: '日志',
  description: '集中查看请求诊断、操作审计，以及本机诊断与数据。',
  navigation: '日志分类',
  sections: { requests: '请求诊断', audit: '操作审计', local: '诊断与数据' },
  checking: '正在检查日志访问权限…',
  accessFailed: '日志访问权限检查失败，请重新登录后再试。',
  retry: '重新检查',
  adminOnly: '服务端请求诊断和操作审计仅管理员可查看。',
  localOnly: '当前模式提供本机诊断与数据管理；服务端请求诊断和操作审计需登录 BFF 管理员账号。'
} as const;
