export const auth = {
  errors: {
    bootstrapStatus: '无法确认管理员初始化状态',
    passkeyUnsupported: '当前浏览器不支持 Passkey，请更换最新版 Chrome、Edge 或 Safari。',
    authenticationFailed: '认证失败',
    copyRecoveryCodes: '复制失败，请手工选择并保存恢复码。',
    passkeyClientUnsupported: '当前客户端版本不支持 Passkey，请刷新页面。'
  },
  audit: {
    firstLocalAdmin: '首个本地管理员',
    firstPasskey: '首个 Passkey',
    recoveryDevice: '恢复设备',
    invitedDevice: '受邀设备'
  },
  recoveryCodes: {
    title: '保存一次性恢复码',
    description: '设备丢失或域名更换时用于注册新 Passkey',
    warning: '这些恢复码只显示一次，每个只能使用一次。请保存到密码管理器，不要放入项目备注或截图。',
    copy: '复制恢复码',
    continue: '我已安全保存，进入工作台'
  },
  title: '登录运营工作台',
  subtitle: {
    passkey: 'Cloudflare 自托管 · Passkey',
    local: '本地账号 · 不透明会话 · ABAC'
  },
  identityNotice:
    '这是 oneVegetable 工作台身份，不是 Alibaba 国际站登录账号。Alibaba OpenAPI 凭据需在登录后的管理后台导入。',
  modes: {
    passkeyLogin: 'Passkey 登录',
    recovery: '恢复访问',
    login: '登录',
    bootstrap: '初始化管理员'
  },
  status: {
    checking: '正在检查初始化状态…',
    initializedPasskey: '工作台已经初始化，请使用已登记的 Passkey 登录。',
    initializedLocal: '工作台已经初始化，请使用已登记的本地账号登录。',
    missingBootstrapToken: '工作台尚未初始化，且服务端未配置一次性管理员引导令牌。'
  },
  fields: {
    bootstrapToken: '管理员引导令牌',
    username: '工作台用户名',
    recoveryCode: '一次性恢复码',
    password: '工作台密码',
    passwordHint: '至少 12 个字符左右，建议使用密码管理器生成'
  },
  submit: {
    working: '请按浏览器提示操作…',
    createPasskey: '创建管理员 Passkey',
    recoverPasskey: '使用恢复码登记新 Passkey',
    enrollPasskey: '接受邀请并登记 Passkey',
    loginPasskey: '使用 Passkey 登录',
    login: '登录',
    createAdmin: '创建管理员'
  },
  onboarding: {
    eyebrow: '首次使用',
    title: '先确认数据与调用边界',
    introduction:
      '无需开放平台凭证即可查看能力目录和本地编辑；真实查询需要用户自己的凭证，平台草稿、正式发品、商品上下架、图库分组管理、图片上传和外部图片转存已开放，其他未经验收的真实写操作保持关闭。',
    steps: {
      application: '在 Alibaba 应用中心创建或选择 Online 应用，取得 App Key 和 App Secret。',
      oauth: '完成 OAuth 授权，取得该账号的 Access Token。',
      settings: '前往设置，设置本机保护口令并填写或导入以上三项凭证。'
    },
    vault: {
      title: '凭证在本机加密保存',
      description:
        'App Key、App Secret 和 Access Token 使用用户口令加密后存入 chrome.storage.local；口令不保存，内容脚本不能读取。解锁状态仅在当前 Chrome 会话内存中保留，刷新页面或后台休眠无需重复输入口令。'
    },
    permissions: {
      title: '主机权限按用途申请',
      description: '正式网关为必选权限；自定义网关和外部图片来源只在使用时向 Chrome 请求，可随时从设置撤销。'
    },
    verification: {
      title: '本地验证不等于平台授权',
      description:
        '本地演示、契约验证和浏览器回归不代表国际站已授予接口权限；实际可用能力以当前账号、业务资格和平台响应为准。'
    },
    localData: {
      title: '本地数据可查看和清除',
      description:
        '设置页提供数据清单与彻底清除入口；脱敏诊断仅保留在当前浏览器会话，不包含请求参数或响应正文。'
    },
    acknowledgement: '我已理解接口可用性取决于账号权限与业务资格，并知晓本地数据、真实写入和主机权限的用途。',
    privacy: '查看隐私说明',
    browseOnly: '稍后，仅浏览',
    configure: '前往设置凭证',
    readError: '首次使用状态读取失败',
    saveError: '首次使用状态保存失败'
  }
} as const;
