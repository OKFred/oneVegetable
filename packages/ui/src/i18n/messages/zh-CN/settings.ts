export const settings = {
  bffCredentials: {
    boundary: 'App Key、App Secret、Access Token 由后端保管，网页不回显。',
    cloud: 'Cloudflare 用户请由管理员导入授权包或发起授权。',
    admin: '前往管理后台配置'
  },
  page: {
    title: '设置',
    description: '管理开放平台连接、素材存储和本机偏好。'
  },
  sections: {
    credentials: '开放平台凭据',
    storage: 'S3 素材存储',
    preferences: '连接与语言',
    maintenance: '诊断与数据'
  },
  confirmation: {
    revokeTitle: '确认撤销主机权限',
    clearDiagnosticsTitle: '确认清空诊断',
    revokeDescription: '撤销 {origin} 后，Chrome 会在下次访问时重新询问。',
    clearDiagnosticsDescription: '将清除 {count} 条脱敏诊断。',
    continue: '确认继续',
    clearDiagnosticsDetail: '清空不可恢复；不删除凭证或商品草稿。',
    revokeDetail: '只撤销所选额外主机，不影响 TOP 网关必选权限。'
  },
  diagnostics: {
    busy: '正在处理诊断记录',
    emptyDisabled: '当前没有可清空的诊断记录',
    loadError: '诊断加载失败',
    clearError: '诊断清理失败',
    exported: '已导出 {count} 条脱敏诊断。',
    cleared: '诊断记录已清空。',
    title: '脱敏诊断',
    description: '最近 100 条：操作名、requestId、耗时、错误码、traceId；无参数、凭证或响应正文。',
    countLabel: '诊断记录数量',
    count: '{count} 条',
    latestError: '最近错误：',
    refresh: '刷新',
    export: '导出诊断',
    clear: '清空诊断'
  },
  vault: {
    title: '开放平台凭证保护',
    description:
      '凭证本机加密。页面刷新或 MV3 休眠不锁定；浏览器重启、扩展更新、手动锁定或所选空闲时限到期才锁定。',
    status: {
      loading: '读取中',
      unlocked: '已解锁',
      legacy: '待迁移',
      empty: '未创建',
      invalid: '格式无效',
      locked: '已锁定'
    },
    activity: '活动：{time}；快照剩余约 {minutes} 分钟。',
    legacyTitle: '发现旧版明文凭证',
    legacyDescription: '已停止读取明文。设口令后由后台加密迁移，页面不接收旧密钥或 Token。',
    lockReason: {
      idle: '开放平台凭证已因空闲超时自动锁定',
      sessionEnded: 'Chrome 会话已结束，需要重新解锁',
      manual: '开放平台凭证已手动锁定'
    },
    lockDescription: {
      sessionEnded: '浏览器重启、扩展更新或重载会清除内存解锁材料；加密凭据仍保留。',
      other: '页面及后台已锁定，请输入口令后继续查询。'
    },
    passphrase: '保护口令',
    unlock: '解锁',
    invalidTitle: '本机凭证记录无效',
    invalidDescription: '不自动修复，以免覆盖数据。先备份浏览器配置，再到日志 → 诊断与数据彻底清除重建。',
    lockNow: '立即锁定',
    idleTitle: '空闲自动锁定',
    idleDescription: '默认不自动锁定；选时长后启用。MV3 休眠不清除会话解锁状态。',
    idleLabel: '空闲自动锁定时间',
    neverLock: '不自动锁定（默认）',
    minutes: '{minutes} 分钟',
    savePolicy: '保存锁定策略',
    rotateTitle: '更换本机保护口令',
    rotateDescription: '用新 salt、密钥重新加密，无需旧口令。',
    newPassphrase: '新保护口令',
    confirmNewPassphrase: '确认新保护口令',
    setPassphrase: '设置保护口令',
    confirmPassphrase: '确认保护口令',
    minimumCharacters: '至少 {count} 位',
    enterAgain: '再次输入',
    rotate: '更换口令',
    migrate: '加密并迁移旧凭证',
    saveEncrypted: '凭证与设置已加密保存，会话内可用。',
    savedToast: '凭证与设置已保存',
    unlockedFeedback: '凭证已解锁；刷新或后台休眠无需再输口令。',
    migratedFeedback: '旧凭证已原位加密，会话内可用。',
    lockedFeedback: '凭证已锁定，会话解锁状态已清除。',
    rotatedFeedback: '已用新 salt 和口令重新加密。',
    idleDisabledFeedback: '已关闭空闲自动锁定，会话内可用。',
    idleEnabledFeedback: '开放平台凭证将在连续 {minutes} 分钟未使用后自动锁定。',
    statusError: '凭证保护状态读取失败',
    unlockError: '凭证解锁失败',
    migrateError: '旧凭证加密失败',
    lockError: '凭证锁定失败',
    rotateError: '保护口令更换失败',
    policyError: '空闲锁定策略保存失败',
    mismatchError: '两次输入的本机保护口令不一致'
  },
  credentials: {
    title: '国际站开放平台凭证',
    guideTitle: '三步完成真实接口连接',
    guideDescription:
      '新版应用请用 IOP 授权工具。TOP 使用旧应用的独立凭据，可导入或手填；不再自动打开已失效的旧地址。两份配置齐全后默认按能力选路；请确保都属于同一商家，系统不会验证店铺归属。',
    acquire: '获取旧版 TOP 凭据',
    openCenter: '打开新版 IOP 应用中心',
    importBundle: '导入授权文件',
    importLabel: '导入授权包 JSON',
    encryptedPlaceholder: '已加密保存，留空保持不变',
    gateway: 'HTTPS 网关',
    signMethod: '签名算法',
    saving: '保存中…',
    save: '保存设置',
    mockSavedFeedback: '演示设置已保存在本地浏览器。',
    encryptedSavedFeedback: '设置已重新加密保存到本机。',
    mockSavedToast: '演示设置已保存',
    savedToast: '设置已保存',
    saveError: '设置保存失败',
    bundleTooLarge: '授权包 JSON 不能超过 256 KiB',
    bundleLoaded: '授权包已读入，尚未保存；设置保护口令并确认保存。',
    bundleImportError: '授权包导入失败',
    acquired: '凭据已获取并加密保存，会话内可用。',
    bundleMissing: '授权包缺少 App Key、App Secret 或 Access Token',
    iopTool: '新版 IOP 授权与续期'
  },
  security: {
    title: '安全边界',
    description: '加密仅保护静态存储；解锁或恶意扩展仍可能泄露密钥。高安全场景请用自控 BFF。'
  },
  socialBackend: {
    title: '社交发布后端',
    description: '配对自有 oneVegetable 后端后，可用 Facebook / Instagram 官方 API 发布。',
    defaultDeviceName: 'Chrome 插件',
    states: {
      loading: '正在读取',
      paired: '已配对',
      pending: '等待管理员批准',
      expired: '已失效',
      unconfigured: '未配置'
    },
    pairCreated: '配对码已生成，请到后端管理页批准',
    pairSucceeded: '社交发布后端配对成功',
    pairPending: '管理员尚未批准，请稍后重试',
    disconnected: '已从插件移除社交发布后端授权',
    connectionHealthy: '连接正常：发现 {total} 个目标，其中 {publishable} 个可发布',
    codeCopied: '配对码已复制',
    operationFailed: '社交发布后端操作失败',
    baseUrl: '后端地址',
    deviceName: '设备名称',
    extensionId: '扩展 ID',
    approveTitle: '在管理页批准此配对码',
    copyCode: '复制配对码',
    expires: '配对码于 {time} 失效。批准后回到这里检查结果。',
    openAdmin: '打开管理页',
    authorizationExpires: '到期：{time}；Token 仅存于受信扩展，不回显。',
    expiredTitle: '设备授权已失效',
    expiredDescription: '30 天已到期或管理员已撤销。重新配对签发新令牌，不恢复旧令牌。',
    pairAgain: '重新配对',
    startPairing: '开始配对',
    checkApproval: '检查批准结果',
    checkConnection: '检查连接',
    disconnect: '断开',
    disconnectTitle: '确认断开社交发布后端',
    disconnectDescription: '删除插件令牌；如需立即撤销服务端授权，请同时在后端管理页撤销设备。',
    disconnectConfirm: '确认断开'
  },
  ...{
    s3: {
      localHttp:
        'HTTP 未加密，仅限可信局域网私有 IPv4、path-style。本地 Node 需显式开启，云端 Worker 不支持。',
      title: 'S3 素材存储',
      extensionDescription:
        '插件直连 S3：本机加密、后台签名，无额外口令，不防浏览器入侵。保存只申请存储域名权限。传输请保持工作台打开；中断先核对，不自动重传。',
      description: '连接兼容 S3 的对象存储，用于素材导入、导出和备份。密钥由后端加密保存。',
      configured: '已配置',
      notConfigured: '未配置',
      unsupported: '当前运行模式未提供服务端 S3 配置。',
      endpoint: 'Endpoint',
      region: 'Region',
      bucket: 'Bucket',
      accessKey: 'Access Key ID',
      secretKey: 'Secret Access Key',
      sessionToken: 'Session Token（可选）',
      rootPrefix: '素材根目录',
      pathStyle: '使用 Path-style 地址（Cloudflare R2、MinIO 通常需要）',
      secretHint: '已保存 Access Key 尾号 {suffix}。修改配置时请重新输入完整密钥。',
      save: '加密保存',
      test: '测试连接',
      clear: '清除配置',
      clearTitle: '确认清除 S3 配置',
      clearDescription: '将删除当前运行环境保存的加密 S3 凭据，不会删除 Bucket 中的对象。',
      saved: 'S3 配置已加密保存。',
      cleared: 'S3 配置已清除。',
      testPassed: 'S3 连接正常，探测到 {count} 个对象。',
      errors: {
        save: 'S3 配置保存失败',
        test: 'S3 连接测试失败',
        clear: 'S3 配置清除失败'
      },
      rules: {
        title: '自动导入规则',
        description: 'S3 路径按顺序匹配，首条决定图片分组；导入可创建缺失分组。规则仅存本机。',
        add: '新增规则',
        newRule: '新规则',
        enabled: '启用',
        remove: '删除规则',
        conflict: '同名冲突',
        rename: '自动重命名',
        skip: '跳过',
        name: '规则名称',
        sourcePrefix: '来源前缀',
        include: '包含 Glob',
        exclude: '排除 Glob（逗号分隔）',
        targetGroup: '目标图片分组路径',
        empty: '尚无规则；没有规则时 S3 素材不会进入导入队列。',
        save: '保存导入规则',
        saved: '图片 S3 导入规则已保存在本机。',
        invalid: '图片导入规则无效'
      }
    }
  },
  alibabaLanguage: {
    title: 'Alibaba 接口语言',
    description: '用于 Schema、官方提示及支持 language 的请求；不改界面语言。',
    interfaceHint: '界面语言：右上角“中 / EN”。',
    label: '平台请求语言',
    chinese: '简体中文（zh_CN）',
    english: 'English（en_US）',
    saved: 'Alibaba 接口语言已保存为 {language}。'
  },
  permissions: {
    title: '主机权限',
    description: 'TOP 网关为必选权限；这里只列按需授权的额外主机。',
    empty: '当前没有额外主机权限。',
    revoke: '撤销',
    revokeLabel: '撤销 {origin}',
    refresh: '刷新权限',
    loadError: '主机权限加载失败',
    revokeError: '主机权限撤销失败',
    revoked: '已撤销 {origin}；再次使用时会重新请求授权。',
    notGranted: '{origin} 当前未授权。'
  },
  extensionRuntime: {
    permissionPurposes: {
      socialBackend: '社交发布后端',
      customGateway: '自定义网关',
      credentialAcquisition: 'Alibaba 凭证获取',
      oauthCallback: 'OAuth Callback',
      productZipAsset: '商品 ZIP 图片下载',
      externalPhoto: '外部图片来源'
    },
    errors: {
      callbackStateExpired: 'Callback 确认状态已失效，请重新读取任务状态。',
      acquisitionRequestMismatch: '凭证获取响应 requestId 不匹配。',
      vaultRequestMismatch: '凭证保护响应 requestId 不匹配。',
      runtimeRequestMismatch: '扩展后台响应 requestId 不匹配。',
      productMutationSnapshotMissing: '商品更新任务缺少类目或语言快照。',
      invalidHostProtocol: '{purpose}仅允许 HTTP(S) 地址。',
      permissionDeniedHost: '未授予 {purpose} 对 {host} 的访问权限。',
      permissionDeniedPurpose: '未授予{purpose}所需的精确站点权限。',
      socialPairingRequired: '请先在设置中配对社交发布后端。',
      socialBackendRequired: '请先填写并配对社交发布后端。',
      socialHttps: '社交发布后端必须使用 HTTPS；本机 localhost 可使用 HTTP。',
      socialUrlStructure: '社交发布后端地址不能包含路径、账号、query 或 fragment。'
    },
    localData: {
      credentials: {
        label: '加密开放平台凭证与网关设置',
        retention: '保留到覆盖、清除数据或卸载'
      },
      productMutationJobs: {
        label: '商品写入本地任务',
        retention: '未完成：待核验或恢复；完成：最多 30 天、100 条'
      },
      socialBackendDevice: {
        label: '社交发布后端设备授权',
        retention: '保留到断开、清除数据、到期或卸载'
      },
      drafts: {
        label: '商品与 RFQ 本地草稿',
        retention: '保留到删除、清除数据或卸载'
      },
      diagnostics: {
        label: '脱敏会话诊断',
        retention: '仅当前浏览器会话，最多 100 条'
      },
      preferences: {
        label: '首次使用与界面偏好',
        retention: '保留到清除数据或卸载'
      }
    }
  },
  localData: {
    title: '本地数据与隐私',
    description: '清单仅含类别和估算大小，不含密钥、Token、草稿或诊断正文。',
    columns: {
      category: '类别',
      storage: '存储位置',
      count: '数量',
      size: '大小',
      retention: '保留时间'
    },
    sensitive: '敏感',
    empty: '暂无本地数据',
    refresh: '刷新清单',
    export: '导出数据清单',
    exported: '已导出清单，不含具体值。',
    loadError: '本地数据清单加载失败',
    dangerTitle: '彻底清除扩展本地数据',
    dangerDescription: '不可撤销。输入“{phrase}”删除凭证、设置、草稿、诊断、首次使用状态及额外主机权限。',
    clearLabel: '清除确认短语',
    clearPhrase: '清除全部数据',
    clear: '彻底清除',
    cleared: '本地数据及额外权限已清除；重载后显示首次使用说明。',
    clearError: '扩展本地数据清除失败'
  }
} as const;
