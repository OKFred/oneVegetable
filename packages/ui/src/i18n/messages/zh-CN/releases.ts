export const releases = {
  eyebrow: '新版本内容',
  title: '版本更新',
  description:
    '查看每个正式版本面向用户的新增功能、体验改进和问题修复。版本说明随应用内置，离线或 GitHub 暂时不可用时也能正常查看。',
  github: 'GitHub 发布页',
  installed: '当前安装版本',
  current: '当前版本',
  missingCurrent: '当前构建尚未发布正式版本说明',
  timeline: '正式版本更新记录',
  sourceRelease: 'GitHub Release',
  sourceTag: 'Git Tag',
  viewRelease: '查看 GitHub Release',
  viewTag: '查看代码标签',
  compare: '完整代码差异',
  changeTypes: {
    feature: '新增',
    improvement: '改进',
    fix: '修复',
    security: '安全'
  }
} as const;
