export const settings = {
  page: {
    title: '连接设置',
    description: '凭证不会进入页面请求；扩展模式下仅由 MV3 service worker 读取并签名。'
  },
  confirmation: {
    revokeTitle: '确认撤销主机权限',
    clearDiagnosticsTitle: '确认清空诊断',
    revokeDescription: '撤销 {origin} 后，再次访问该主机时 Chrome 会重新询问授权。',
    clearDiagnosticsDescription: '将清除当前保存的 {count} 条脱敏诊断记录。',
    continue: '确认继续',
    clearDiagnosticsDetail: '诊断内容已经脱敏，但清空后无法恢复；该操作不会删除账号凭证或商品草稿。',
    revokeDetail: '该操作只撤销所选额外主机，不影响 Alibaba 正式网关的必选权限。'
  },
  diagnostics: {
    busy: '正在处理诊断记录',
    emptyDisabled: '当前没有可清空的诊断记录',
    loadError: '诊断加载失败',
    clearError: '诊断清理失败',
    exported: '已导出 {count} 条脱敏诊断。',
    cleared: '诊断记录已清空。',
    title: '脱敏诊断',
    description:
      '仅保留最近 100 条操作名、requestId、耗时、错误码和 traceId；不记录请求参数、凭证或响应正文。',
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
      '凭证加密保存在本机。解锁后，刷新页面或 MV3 后台休眠不会要求重复输入口令；浏览器重启、扩展更新、主动锁定或所选空闲时限到期后才会重新锁定。',
    status: {
      loading: '读取中',
      unlocked: '已解锁',
      legacy: '待迁移',
      empty: '未创建',
      invalid: '格式无效',
      locked: '已锁定'
    },
    activity: '最近活动：{time}；状态快照剩余约 {minutes} 分钟。',
    legacyTitle: '发现旧版明文凭证',
    legacyDescription:
      '真实请求已停止读取该记录。设置新口令后会在 service worker 内直接加密迁移，页面不会收到旧 App Secret 或 Access Token。',
    lockReason: {
      idle: '开放平台凭证已因空闲超时自动锁定',
      sessionEnded: 'Chrome 会话已结束，需要重新解锁',
      manual: '开放平台凭证已手动锁定'
    },
    lockDescription: {
      sessionEnded: '浏览器重启、扩展更新或重载会清除仅存于内存的会话解锁材料；本地加密凭据仍然安全保存。',
      other: '页面与后台中的解锁状态已清除，重新输入口令后才能继续真实查询。'
    },
    passphrase: '保护口令',
    unlock: '解锁',
    invalidTitle: '本机凭证记录无效',
    invalidDescription:
      '为避免覆盖无法恢复的数据，当前不提供自动修复。请先备份浏览器配置，再使用下方彻底清除功能重新开始。',
    lockNow: '立即锁定',
    idleTitle: '空闲自动锁定',
    idleDescription:
      '默认不因空闲自动锁定；只有选择时长后才会启用。MV3 后台休眠不会清除当前 Chrome 会话的解锁状态。',
    idleLabel: '空闲自动锁定时间',
    neverLock: '不自动锁定（默认）',
    minutes: '{minutes} 分钟',
    savePolicy: '保存锁定策略',
    rotateTitle: '更换本机保护口令',
    rotateDescription: '将生成新 salt 和新密钥重新加密，不需要旧口令再次参与。',
    newPassphrase: '新保护口令',
    confirmNewPassphrase: '确认新保护口令',
    setPassphrase: '设置保护口令',
    confirmPassphrase: '确认保护口令',
    minimumCharacters: '至少 {count} 位',
    enterAgain: '再次输入',
    rotate: '更换口令',
    migrate: '加密并迁移旧凭证',
    saveEncrypted: '凭证与设置已加密保存，并将在当前 Chrome 会话内保持可用。',
    savedToast: '凭证与设置已保存',
    unlockedFeedback: '凭证已解锁；刷新页面或后台休眠后无需重复输入口令。',
    migratedFeedback: '旧版明文凭证已原位加密，并在当前 Chrome 会话内保持可用。',
    lockedFeedback: '凭证已锁定，当前 Chrome 会话中的解锁状态已清除。',
    rotatedFeedback: '凭证已使用新 salt 和新口令重新加密。',
    idleDisabledFeedback: '已关闭空闲自动锁定；当前 Chrome 会话内将保持可用。',
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
      '可以用插件向导复用当前 Chrome 登录态，读取已有应用并完成 OAuth；遇到滑块、验证码或密钥安全确认时，直接在打开的 Alibaba 标签页中处理。也可以手工填写或导入授权包。',
    acquire: '获取开放平台凭证',
    openCenter: '打开 Alibaba 应用中心',
    importBundle: '一键导入授权包 JSON',
    importLabel: '导入授权包 JSON',
    encryptedPlaceholder: '已加密保存，留空保持不变',
    gateway: 'HTTPS 网关',
    signMethod: '签名算法',
    saving: '保存中…',
    save: '保存设置',
    mockSavedFeedback: '演示设置已保存在本地浏览器。',
    encryptedSavedFeedback: '设置已重新加密写入 chrome.storage.local。',
    mockSavedToast: '演示设置已保存',
    savedToast: '设置已保存',
    saveError: '设置保存失败',
    bundleTooLarge: '授权包 JSON 不能超过 256 KiB',
    bundleLoaded:
      '已从授权包读取 App Key、App Secret 和 Access Token；尚未保存，请设置本机保护口令并确认保存。',
    bundleImportError: '授权包导入失败',
    acquired: 'Alibaba 开放平台凭据已获取并加密保存，当前 Chrome 会话内可以直接使用。',
    bundleMissing: '授权包缺少 App Key、App Secret 或 Access Token'
  },
  security: {
    title: '安全边界',
    description:
      '加密可降低本地静态存储泄露风险，但已解锁或被恶意扩展控制的浏览器仍可能暴露 App Secret；高安全场景应迁移到用户控制的 BFF。'
  },
  socialBackend: {
    title: '社交发布后端',
    description: '配对你自己的 oneVegetable 后端后，插件才能通过 Facebook / Instagram 官方 API 发布。',
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
    authorizationExpires: '授权到期：{time}；Token 仅保存在受信扩展存储中，不会显示。',
    expiredTitle: '设备授权已失效',
    expiredDescription: '可能是 30 天有效期已到或管理员已撤销设备。重新配对会签发新令牌，不会恢复旧令牌。',
    pairAgain: '重新配对',
    startPairing: '开始配对',
    checkApproval: '检查批准结果',
    checkConnection: '检查连接',
    disconnect: '断开',
    disconnectTitle: '确认断开社交发布后端',
    disconnectDescription: '将从插件删除设备令牌；如需立即让服务端令牌失效，还应在后端管理页撤销该设备。',
    disconnectConfirm: '确认断开'
  },
  alibabaLanguage: {
    title: 'Alibaba 接口语言',
    description: '只影响 Schema、官方提示及支持 language 参数的 Alibaba 平台请求，不改变界面语言。',
    interfaceHint: '界面语言由右上角的“中 / EN”按钮控制。',
    label: '平台请求语言',
    chinese: '简体中文（zh_CN）',
    english: 'English（en_US）',
    saved: 'Alibaba 接口语言已保存为 {language}。'
  },
  permissions: {
    title: '主机权限',
    description: '正式网关为扩展必选权限；下面只列出曾由自定义网关或外部图片转存按需授予的主机。',
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
        retention: '保留到用户覆盖、清除扩展数据或卸载扩展'
      },
      productMutationJobs: {
        label: '商品上下架本地任务',
        retention: '未完成任务保留到核验或恢复；完成任务最多保留 30 天、100 条'
      },
      socialBackendDevice: {
        label: '社交发布后端设备授权',
        retention: '保留到用户断开社交后端、清除扩展数据、设备授权到期或卸载扩展'
      },
      drafts: {
        label: '商品与 RFQ 本地草稿',
        retention: '保留到草稿被删除、清除扩展数据或卸载扩展'
      },
      diagnostics: {
        label: '脱敏会话诊断',
        retention: '仅当前浏览器会话，最多 100 条'
      },
      preferences: {
        label: '首次使用与界面偏好',
        retention: '保留到清除扩展数据或卸载扩展'
      }
    }
  },
  localData: {
    title: '本地数据与隐私',
    description: '清单只包含类别和估算大小，不导出 App Secret、Access Token、草稿正文或诊断内容。',
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
    exported: '已导出不包含具体值的本地数据清单。',
    loadError: '本地数据清单加载失败',
    dangerTitle: '彻底清除扩展本地数据',
    dangerDescription:
      '此操作无法撤销。请输入“{phrase}”，将删除凭证、设置、草稿、诊断、首次使用状态并撤销额外主机权限。',
    clearLabel: '清除确认短语',
    clearPhrase: '清除全部数据',
    clear: '彻底清除',
    cleared: '扩展本地数据和额外主机权限已清除；重新加载后会再次显示首次使用说明。',
    clearError: '扩展本地数据清除失败'
  }
} as const;
