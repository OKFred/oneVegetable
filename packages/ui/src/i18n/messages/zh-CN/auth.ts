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
    title: '四步连接 Alibaba 开放平台',
    introduction: {
      extension:
        '向导会复用当前 Chrome 的 Alibaba 登录状态，带你完成开发者注册、应用配置和 OAuth 授权；遇到验证码或平台协议时由你在 Alibaba 页面亲自处理。',
      selfHosted:
        '管理员可以先尝试云端自动连接；遇到滑块、验证码或安全确认时，改用 Chrome 插件完成授权，再将凭证安全导入当前站点。'
    },
    journey: {
      label: 'Alibaba 开放平台授权步骤',
      registration: {
        title: '注册开发者',
        description: '准备企业信息和证明材料，并亲自确认平台协议。'
      },
      review: {
        title: '等待审核',
        description: '向导识别审核状态并停止轮询，状态变化后再手工检查。'
      },
      application: {
        title: '创建应用',
        description: '配置应用、Callback 和所需权限，等待应用达到可授权状态。'
      },
      authorization: {
        title: '授权并保存',
        description: '校验 OAuth 回调与 state，然后加密保存获取到的凭证。'
      }
    },
    safety: {
      title: '敏感步骤始终由你确认',
      extension:
        '插件不读取 Alibaba 网站密码，也不会代填企业资料、上传证件、接受协议或绕过验证码；App Secret 和 Token 获取后只在插件受信环境中加密保存。',
      selfHosted:
        '云端尝试中的账号密码只存在于当前 HTTPS 请求和临时浏览器内存；若平台要求人机验证，流程会停止并引导你改用本机插件。'
    },
    acknowledgement: '我已理解接口可用性取决于账号权限与业务资格，并知晓本地数据、真实写入和主机权限的用途。',
    privacy: '查看隐私说明',
    browseOnly: '稍后，仅浏览',
    configure: '开始授权向导',
    readError: '首次使用状态读取失败',
    saveError: '首次使用状态保存失败'
  }
} as const;
