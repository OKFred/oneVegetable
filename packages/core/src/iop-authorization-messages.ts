export const zh = {
  authorizationBrandName: '一棵青菜',
  applicationName: '应用名称',
  authorizationExpiry: '授权到期',
  summaryTop: '旧版 TOP',
  summaryIop: '新版 IOP',
  authorizationAssistant: '开放平台授权',
  authorizationComplete: '授权已就绪',
  authorizationProtocol: '授权类型',
  authorizationSecretPrivacy: '密钥不会在此处展示。',
  isolationTop: '仅更新 TOP，已有 IOP 授权和默认选项不变。',
  isolationIop: '仅更新 IOP，已有 TOP 授权和默认选项不变。',
  skipWorkbench: '暂不保存，返回设置',
  themeSystem: '主题：跟随系统，点击切换为浅色',
  themeLight: '主题：浅色，点击切换为深色',
  themeDark: '主题：深色，点击切换为跟随系统',
  changeAuthorization: '更换或导入其他授权',
  workbenchNextTitle: '下一步：让工作台使用这份授权',
  workbenchNextHelp: '最后一步：保存授权并进入工作台。',
  authorizationDetails: '本次授权',
  connectionManagement: '备份与管理',
  useExistingAuthorization: '导入已有授权',
  topEntryHelp: '已有旧应用可重新授权；已有完整凭据可直接导入。无需寻找失效的旧应用管理入口。',
  newMerchantIop: '没有旧版应用？使用 IOP（推荐）',
  topApplicationHelp:
    '填写旧应用的 AppKey、AppSecret 和已登记 Callback；应用名称可留空。随后仍需在 Alibaba 登录并确认授权。',
  readApplicationBackup: '从旧授权文件读取应用资料',
  applicationBackupRead: '已填入应用资料，未导入旧 Token。请核对 Callback，再开始重新授权。',
  retryStatus: '重新检查',
  statusUnavailable: '暂时无法读取本机授权，请重新检查',
  connectionSteps: '连接账号的三个步骤',
  connectStep: '准备连接',
  approveStep: '平台授权',
  useStep: '启用工作台',
  applyWorkbench: '保存并进入工作台',
  confirmApplyWorkbench:
    '保存当前授权并进入总览？仅更新对应协议，保留另一份授权和已有默认选项；首次连接使用当前授权。不重新授权或重放任务。',
  workbenchApplied: '已保存到工作台，正在打开总览',
  otherWays: '已有授权文件？或需要手动填写？',
  connectionDetails: '查看授权详情与管理',
  callbackFallback: '已确认授权，但这里没有变化？',
  nextEmptyIop:
    '点击下方按钮，我们会打开 Alibaba 并尝试读取应用。遇到登录或验证，请在 Alibaba 页面完成后回来继续。',
  nextEmptyTop: '选择“重新授权”获取新 Token，或“导入已有授权”直接使用完整凭据。新用户推荐 IOP。',
  nextLocked: '请输入之前为本机授权文件设置的口令，不是 Alibaba 登录密码。解锁后可导出、重新授权或尝试续期。',
  nextWaiting: '请到刚打开的 Alibaba 页面检查账号和权限，再自行确认授权。保持本页打开，结果会自动更新。',
  nextReady: '点击“保存并进入工作台”直接使用；下载仅用于备份或其他部署。',
  nextImported: '下载已发起。要在本插件使用，请点击“保存并进入工作台”。',
  nextUnknown:
    '暂时无法确认上次结果，不会自动重试。若出现“再次保存”可先保存；否则请重新授权。不要反复点击续期。',
  AUTH_PROTOCOL_CHANGED: '授权类型已切换，已取消之前的操作。请在当前协议下重新开始。',
  IOP_APP_SELECTION_REQUIRED:
    '打开了多个应用中心标签页，无法安全确定目标。请保留要授权的那个应用中心，再重新读取。',
  TOP_APP_NOT_AVAILABLE:
    '无法从已打开的旧 TOP 应用页读取完整信息。旧入口可能已失效或未登记 Callback；不会改用 IOP 的密钥。请在高级模式粘贴已有 TOP 授权 JSON，或手动填写整套旧应用信息。',
  TOP_APP_SELECTION_REQUIRED:
    '旧页面有多个 TOP 应用，无法安全确定目标。请手动填写目标旧应用，或在高级模式粘贴它的 TOP 授权 JSON。',
  advancedJson: '高级模式：粘贴授权 JSON',
  jsonLabel: '当前协议的完整授权包 JSON',
  jsonHelp:
    '将示例全部替换为你已有的有效授权包（最大 64 KiB）。示例只说明格式，不代表真实授权；不会导入占位值。内容只留在本页内存，不自动保存。',
  importJson: '校验并导入 JSON',
  importPassphraseHelp:
    '请用至少 6 个字符的本机口令加密这份授权包；不是 Alibaba 网站密码。只替换本工具当前协议的包，另一协议和工作台配置不变。',
  protectAndImport: '加密并导入',
  AUTH_JSON_INVALID: 'JSON 格式或授权包字段不正确，请按示例粘贴完整有效的授权包。',
  AUTH_JSON_TOO_LARGE: '授权 JSON 不能超过 64 KiB，请移除与授权无关的内容。',
  AUTH_JSON_EXAMPLE: '请先将示例占位值全部替换为自己的有效授权信息。',
  dismissNotification: '关闭通知',
  IOP_APP_CHANGED: '读取期间当前应用或 Callback 发生了变化，已停止授权。请确认目标应用后重新读取。',
  IOP_APP_CENTER_UNAVAILABLE:
    '未能自动打开“应用中心”。请在 Alibaba 页面手动点击“应用中心”，待应用详情出现后再重新读取。',
  IOP_APP_PAGE_UNAVAILABLE:
    '无法读取应用页面，页面可能正在跳转或访问权限已变化。请等应用中心加载完成后重新读取。',
  IOP_APP_SECRET_CONTROL_UNAVAILABLE:
    '已找到应用，但未能点击“查看”密钥。请在应用中心手动点击 App Secret 旁的 View，完成可能的验证后重新读取。',
  discoverApplication: '前往 Alibaba 连接',
  discoveringApplication: '正在打开应用中心并读取当前应用，请留意页面上的指针；最多等待 30 秒。',
  applicationRead: '已读取应用及已登记 Callback，准备打开授权页。请在 Alibaba 页面自行确认授权。',
  discoverPermission: '点击“前往 Alibaba 连接”，允许访问应用中心后继续。',
  allowCallbackPermission:
    '允许访问此应用的 OAuth 与已登记 Callback 域名后，将自动打开授权页。不会修改 Callback。',
  localProtection: '本机保护',
  optionalPassphrase: '本机保护口令（可选）',
  optionalProtectionHelp:
    '留空使用本机保护；填写至少 6 个字符。授权页和设置页共用，不是 Alibaba 网站密码。复制整个浏览器配置仍可能读取凭据。',
  continueAuthorization: '继续',
  CREDENTIAL_VAULT_LOCKED: '请先使用原本机保护口令解锁，再继续授权。',
  CREDENTIAL_VAULT_INVALID: '本机保护数据已损坏，请在设置中检查，不会覆盖已有授权。',
  PASSPHRASE_TOO_SHORT: '口令至少需要 6 个字符，也可以留空。',
  PASSPHRASE_TOO_LONG: '口令不能超过 256 个字符。',
  protectBundle: '为授权文件设置保护口令',
  protectBundleHelp:
    '应用信息已自动填好。请设置至少 6 个字符的本机加密口令（不是 Alibaba 密码），随后自动开始授权。已有锁定的授权包也可取消后先解锁。',
  IOP_APP_READ_FAILED:
    '未能在 30 秒内读取完整应用信息。请检查应用中心是否显示 App Name、AppKey 和已登记 Callback，然后重新读取；不会转到旧 TOP 页面。',
  IOP_APP_SECRET_UNAVAILABLE:
    '已打开“查看密钥”，但无法读取完整 App Secret。请在应用中心检查并完成必要的验证，再重新读取或手动填写。',
  IOP_APP_SECURITY_CHECK:
    'Alibaba 要求验证码或密钥安全验证，自动操作已停止。请在 Alibaba 页面手工完成后重新读取。',
  IOP_APP_LOGIN_REQUIRED:
    '请先在打开的 Alibaba 标签页登录，再点击“前往 Alibaba 连接”。插件不会收集网站密码。',
  IOP_APP_PREREQUISITE_REQUIRED:
    '请先在 Alibaba 完成开发者审核或准备可用应用，再重新读取。插件不会提交注册、创建应用或接受协议。',
  confirmationTitle: '请确认本次操作',
  confirmationCancel: '取消',
  confirmationContinue: '确认继续',
  protocolChoice: '切换新版 / 旧版授权',
  protocolTop: '已有旧版应用（TOP）',
  protocolIop: '新版应用（IOP，推荐）',
  toolTitleTop: '连接 Alibaba · 旧版应用',
  toolTitleIop: '连接 Alibaba · 新版应用',
  dualGuide:
    '建议已有两类应用的商家分别授权，以覆盖更多能力。两套 AppKey、Secret、Token 和授权包独立保存，不可混用；只有一类也可使用。',
  topGuide:
    'TOP 需要已有旧应用；旧管理页不可用不代表 OAuth 不能授权。重新授权与导入已有凭据是两条独立流程，不使用 IOP 密钥替代。',
  manualAuthorization: '手动填写',
  manualApplication: '应用信息与本机口令',
  topManualTitle: '如何手动完成 TOP 授权？',
  topManualExisting:
    '已有旧文件：可只读取应用资料后重新授权；若要直接使用其中的 Token，请返回“导入已有授权”。',
  topManualPrepare:
    '没有备份：向原应用管理员取得旧 TOP AppKey、AppSecret 和已登记 Callback，填写下方表单。应用名称可留空，不能使用 IOP 应用信息代替。',
  topManualApprove:
    '核对应用归属及 Callback 后点击“开始授权”。插件生成官方 TOP 授权地址，请在 Alibaba 页面登录并亲自确认。本机保护沿用前一步，不重复设置口令。',
  topManualFinish: '授权成功后点击“保存并进入工作台”。下载仅用于备份，不需要 Node 服务。',
  topManualUnavailable:
    '自动读取失败不代表不能手动授权。但若没有旧 TOP 应用资料或授权包备份，请联系原应用管理员或 Alibaba 支持确认旧应用入口；插件无法从 IOP 应用生成 TOP 凭据。',
  topManualDocumentation: 'TOP 官方授权说明',
  toolGuide: '按下面三步操作，无需运行命令或部署服务。登录和授权确认在 Alibaba 官网完成。',
  boundaryTop:
    '仅处理旧 TOP 授权。不会打开已失效的 crosstrade 地址，不会把旧应用发送到 IOP，也不会自动覆盖工作台中的另一份授权。',
  reauthorize: '重新授权',
  confirmReauthorize:
    '使用已保存的当前协议应用信息重新授权，保持 Callback 和权限范围。请在 Alibaba 页面亲自确认授权协议；成功后只更换本工具的授权包。',
  switchProtocolConfirm: '切换授权类型会清空尚未提交的应用信息；已经保存的两份授权都不会删除。继续切换？',
  returnSettings: '返回设置',
  importTop: '导入旧版授权文件',
  clearTop: '清除本机 TOP 授权包',
  confirmClearTop:
    '只清除本工具中的 TOP 授权包，不删除 IOP、工作台配置、S3、模板或任务，也不撤销平台授权。确认清除？',
  TOP_REQUIRED: '当前选择 TOP，只能导入 TOP 授权包。IOP 文件请切换到 IOP；未修改任何授权。',
  TOP_TOKEN_REJECTED:
    '旧 TOP 平台拒绝换取或续期 Token。请检查旧应用、Callback 和授权有效期；不代表新版 System API 缺失，原包未被覆盖。',
  TOP_TOKEN_RESULT_UNKNOWN:
    '旧 TOP 未返回可确认的 Token 结果。不要重复换取或续期；请重新授权，原包未被覆盖。',
  title: '连接 Alibaba 开放平台',
  subtitle: '使用你自己的应用 · 新版 IOP',
  language: 'EN',
  intro: '公共页面只提供指引和回调。App Secret、Token 和口令只在插件内处理，不上传到本网站。',
  step1: '1. 准备应用',
  step1Text:
    '此国际站应用中心展示新版 IOP 应用，不是旧 TOP 应用的另一个页签。准备新版应用及所需 API 权限；已有 TOP 凭据请另存为 TOP 档案。',
  step2: '2. 登记回调',
  step2Text: '将下方地址登记为应用的 Callback URL。已有地址也可在插件工具中填写；我们不会自动修改应用。',
  step3: '3. 授权并导出',
  step3Text:
    '打开插件工具，填写应用信息，手工确认 Alibaba 授权，再导出 credentialInfo.json。续期也在同一工具中完成。',
  callback: '回调地址（Callback URL，使用应用中已登记的地址）',
  appName: '应用名称（App Name）',
  appKey: '应用编号（App Key）',
  appSecret: '应用密钥（App Secret）',
  passphrase: '本机保护口令（至少 6 个字符，不是 Alibaba 密码）',
  registered: '这是我的应用，且 Callback 已登记；此次授权由我在 Alibaba 页面确认。',
  open: '打开插件授权工具',
  install: '安装 Chrome 插件',
  center: '打开应用中心',
  copy: '复制回调地址',
  copied: '已复制',
  start: '开始授权',
  unlock: '解锁',
  refresh: '尝试延长有效期',
  export: '下载授权文件',
  lock: '锁定',
  clear: '清除本机 IOP 授权包',
  import: '导入新版授权文件',
  importConfirm: '确认替换本工具中当前所选协议的授权包？另一协议和工作台配置不会改变。',
  confirmExport: '文件包含明文 App Secret 和 Token，请勿公开或提交到 Git。确认导出？',
  confirmRefresh: '续期可能轮换 Token；将保存到本机，请同步更新使用此授权包的服务。确认续期？',
  confirmClear: '只清除本机独立 IOP 授权包，不撤销平台授权。确认清除？',
  expires: '授权到期时间',
  refreshExpires: '可续期至',
  unknownDate: '平台未返回',
  empty: '尚未配置',
  locked: '授权包已锁定',
  ready: '授权文件已安全保存',
  waiting: '请在 Alibaba 页面点击 Authorize；收到回调后会自动返回这里（10 分钟内有效）。',
  busy: '正在处理，请勿关闭',
  unknown: '结果待核对：不会自动重试，请重新授权；如仅保存失败，可再次保存。',
  cancel: '取消本次授权',
  save: '再次保存（不重新调用平台）',
  paste: '已有 Callback 无法自动接收？粘贴完整回调地址（仅插件本机处理）',
  receive: '接收回调',
  saved: '操作成功，授权包已安全保存',
  downloaded: 'JSON 下载已发起，请妥善保存',
  detected: '插件已连接',
  missing: '需要支持 IOP 授权的新版插件；安装或更新后重新打开本页。',
  received: '回调已交给插件，请回到工具页查看。此页面不显示或保存凭据。',
  invalidCallback: '回调无效或任务已过期，请在插件中重新授权。',
  clipboardError: '无法复制，请手工选择回调地址复制。',
  boundary: '新版 IOP 应用专用。保存到工作台时仅更新 IOP，保留 TOP 和已有默认选项。',
  privacy: '本服务与 alibaba.com 无官方关联。使用前请阅读平台规则。不要分享授权文件。',
  privacyLink: '隐私说明',
  rules: '平台规则',
  AUTH_ACTION_FAILED: '操作失败，请检查网络或本机存储；写入结果不明时不要重复续期。',
  AUTH_INPUT_INVALID: '请检查应用信息和口令，并使用当前所选协议的完整授权包。',
  CALLBACK_INVALID: 'Callback 必须是已登记的公共 HTTPS 地址，不含参数、片段或登录信息。',
  AUTH_PERMISSION_REQUIRED: '请允许本次所需的精确域名访问权限后重试。',
  AUTH_TASK_ACTIVE: '已有操作进行中，请等待完成或取消授权。',
  AUTH_TASK_EXPIRED: '本次授权已超过 10 分钟，请重新开始。',
  OAUTH_STATE_MISMATCH: '回调不是本次授权，请使用刚打开的授权页面重新授权。',
  OAUTH_CODE_MISSING: '回调缺少授权码，请重新授权。',
  OAUTH_PROVIDER_ERROR: 'Alibaba 未批准本次授权，请查看授权页。',
  IOP_TOKEN_REJECTED: 'Alibaba 拒绝换取或续期 Token，请检查应用权限、Callback 和授权有效期。原授权未被覆盖。',
  IOP_TOKEN_RESULT_UNKNOWN: '平台未返回可确认的结果，请重新授权，不要重复发送续期。',
  AUTH_REFRESH_RESULT_UNKNOWN: '上次换取或续期结果不明，已停止重试和导出，请重新授权。',
  AUTH_REFRESH_EXPIRED: '没有有效 Refresh Token，请重新授权。',
  AUTH_VAULT_LOCKED: '请先解锁授权包。',
  AUTH_UNLOCK_FAILED: '口令错误或授权包损坏。',
  AUTH_VAULT_INVALID: '本机授权包格式无效，请重新授权。',
  IOP_REQUIRED: '当前选择 IOP，请使用明确标识为 IOP 的授权包；旧 TOP 文件请先切换到 TOP。',
  AUTH_ORIGIN_DENIED: '此页面无权访问授权工具。'
} as const;
export const en: Record<keyof typeof zh, string> = {
  authorizationBrandName: 'oneVegetable',
  applicationName: 'App name',
  authorizationExpiry: 'Authorization expires',
  summaryTop: 'Legacy TOP',
  summaryIop: 'New IOP',
  authorizationAssistant: 'OPEN PLATFORM',
  authorizationComplete: 'Authorization ready',
  authorizationProtocol: 'Authorization type',
  authorizationSecretPrivacy: 'Secrets are not displayed here.',
  isolationTop: 'Updates TOP only. Existing IOP authorization and defaults stay unchanged.',
  isolationIop: 'Updates IOP only. Existing TOP authorization and defaults stay unchanged.',
  skipWorkbench: 'Not now, back to Settings',
  themeSystem: 'Theme: system. Switch to light',
  themeLight: 'Theme: light. Switch to dark',
  themeDark: 'Theme: dark. Switch to system',
  changeAuthorization: 'Change or import another authorization',
  workbenchNextTitle: 'Next: connect this authorization to your workbench',
  workbenchNextHelp: 'One last step: save this authorization to connect your workbench.',
  authorizationDetails: 'This authorization',
  connectionManagement: 'Backup and management',
  useExistingAuthorization: 'Import existing authorization',
  topEntryHelp:
    'Reauthorize an existing legacy app, or import complete credentials. No legacy app console is required.',
  newMerchantIop: 'No legacy app? Use IOP (recommended)',
  topApplicationHelp:
    'Enter the legacy AppKey, AppSecret and registered Callback. App Name is optional. You must still sign in and approve on Alibaba.',
  readApplicationBackup: 'Read app details from an old authorization file',
  applicationBackupRead:
    'App details filled in; the old token was not imported. Check the Callback, then start reauthorization.',
  retryStatus: 'Check again',
  statusUnavailable: 'Local authorization could not be read. Please check again.',
  connectionSteps: 'Three steps to connect your account',
  connectStep: 'Prepare',
  approveStep: 'Approve on Alibaba',
  useStep: 'Use in workbench',
  applyWorkbench: 'Save and open workbench',
  confirmApplyWorkbench:
    'Save and open the dashboard? Only this protocol is updated; the other profile and existing default stay unchanged. A first connection uses this profile. No authorization or tasks are replayed.',
  workbenchApplied: 'Saved to the workbench. Opening the dashboard.',
  otherWays: 'Have an authorization file, or prefer manual entry?',
  connectionDetails: 'Authorization details and management',
  callbackFallback: 'Approved, but this page has not changed?',
  nextEmptyIop:
    'Use the button below to open Alibaba and read your app. If asked to sign in or verify, complete it on Alibaba, then return here.',
  nextEmptyTop:
    'Choose Reauthorize to get a new token, or Import existing authorization to use complete credentials. New users should choose IOP.',
  nextLocked:
    'Enter the passphrase you set for this local authorization file, not your Alibaba password. Then you can download, reauthorize or try renewal.',
  nextWaiting:
    'Check the account and permissions on the Alibaba tab, then approve yourself. Keep this page open; it will update automatically.',
  nextReady: 'Choose Save and open workbench to connect. Download only for backups or other deployments.',
  nextImported: 'Download started. To connect this extension, choose Save and open workbench.',
  nextUnknown:
    'The previous result is uncertain; it will not be retried automatically. Retry local save if available, otherwise reauthorize. Do not repeatedly renew.',
  AUTH_PROTOCOL_CHANGED:
    'The authorization type changed, so the previous action was cancelled. Start again with the selected protocol.',
  IOP_APP_SELECTION_REQUIRED:
    'More than one Application center tab is open. Keep the intended app tab, then retry reading.',
  TOP_APP_NOT_AVAILABLE:
    'Complete details could not be read from an open legacy TOP app page. The old entry may be retired or its Callback missing. IOP keys will never be substituted. Paste an existing TOP bundle in Advanced mode or enter the complete legacy app details.',
  TOP_APP_SELECTION_REQUIRED:
    'Multiple legacy TOP apps were found, so the intended app cannot be selected safely. Enter the target legacy app manually or paste its TOP bundle in Advanced mode.',
  advancedJson: 'Advanced: paste authorization JSON',
  jsonLabel: 'Complete JSON bundle for the selected protocol',
  jsonHelp:
    'Replace the entire example with your valid authorization bundle (maximum 64 KiB). The example only documents the format; placeholders cannot be imported. Content stays in page memory and is not autosaved.',
  importJson: 'Validate and import JSON',
  importPassphraseHelp:
    'Encrypt this bundle with a local passphrase of at least 6 characters, not your Alibaba password. Only this tool’s selected bundle is replaced; the other protocol and workbench settings are unchanged.',
  protectAndImport: 'Encrypt and import',
  AUTH_JSON_INVALID:
    'Invalid JSON or credential fields. Paste a complete valid bundle using the example format.',
  AUTH_JSON_TOO_LARGE: 'Authorization JSON must not exceed 64 KiB. Remove unrelated content.',
  AUTH_JSON_EXAMPLE: 'Replace all example placeholders with your own valid authorization details first.',
  dismissNotification: 'Dismiss notification',
  IOP_APP_CHANGED:
    'The selected app or Callback changed while reading. Authorization stopped. Confirm the intended app and read again.',
  IOP_APP_CENTER_UNAVAILABLE:
    'Application center could not be opened automatically. Open it on Alibaba, wait for the app details, then read again.',
  IOP_APP_PAGE_UNAVAILABLE:
    'The app page could not be read. It may be navigating or its access permission may have changed. Wait for Application center to load, then read again.',
  IOP_APP_SECRET_CONTROL_UNAVAILABLE:
    'The app was found, but View secret could not be clicked. Click View beside App Secret on Alibaba, complete any verification, then read again.',
  discoverApplication: 'Connect on Alibaba',
  discoveringApplication:
    'Opening Application center and reading the current app. Follow the pointer; this takes at most 30 seconds.',
  applicationRead:
    'App details and the registered Callback were read. Preparing authorization; confirm the agreement yourself on Alibaba.',
  discoverPermission: 'Choose Connect on Alibaba, then allow access to the application center.',
  allowCallbackPermission:
    'Allow access to this app’s OAuth and registered Callback origins to open authorization automatically. The Callback will not change.',
  localProtection: 'Local protection',
  optionalPassphrase: 'Local passphrase (optional)',
  optionalProtectionHelp:
    'Leave blank for device protection, or enter 6+ characters. Shared by authorization and Settings, not your Alibaba password. A copied browser profile may still expose credentials.',
  continueAuthorization: 'Continue',
  CREDENTIAL_VAULT_LOCKED: 'Unlock with your existing local passphrase before continuing.',
  CREDENTIAL_VAULT_INVALID:
    'Local protection data is damaged. Check Settings; existing authorization will not be replaced.',
  PASSPHRASE_TOO_SHORT: 'Use at least 6 characters, or leave the field blank.',
  PASSPHRASE_TOO_LONG: 'Use at most 256 characters.',
  protectBundle: 'Protect your authorization file',
  protectBundleHelp:
    'App details are ready. Set a local encryption passphrase of at least 6 characters (not your Alibaba password) to start authorization. To reuse a locked bundle, cancel and unlock it first.',
  IOP_APP_READ_FAILED:
    'Complete app details could not be read within 30 seconds. Check that Application center shows App Name, AppKey and a registered Callback, then retry. No legacy TOP page will be opened.',
  IOP_APP_SECRET_UNAVAILABLE:
    'View secret was opened, but a complete App Secret could not be read. Check Application center and complete any verification, then retry or enter it manually.',
  IOP_APP_SECURITY_CHECK:
    'Alibaba requires a CAPTCHA or secret security check. Automation stopped. Complete it on Alibaba, then retry reading.',
  IOP_APP_LOGIN_REQUIRED:
    'Sign in on the opened Alibaba tab, then choose Connect on Alibaba again. The extension does not collect website passwords.',
  IOP_APP_PREREQUISITE_REQUIRED:
    'Complete developer review or prepare an available Alibaba app, then read again. The extension does not submit registration, create apps or accept agreements.',
  confirmationTitle: 'Confirm this action',
  confirmationCancel: 'Cancel',
  confirmationContinue: 'Confirm and continue',
  protocolChoice: 'Switch new / legacy authorization',
  protocolTop: 'Existing legacy app (TOP)',
  protocolIop: 'New app (IOP, recommended)',
  toolTitleTop: 'Connect Alibaba · Legacy app',
  toolTitleIop: 'Connect Alibaba · New app',
  dualGuide:
    'If you have both app types, authorize both for broader coverage. Each AppKey, secret, token and bundle is stored independently and cannot be mixed. A single app type is still supported.',
  topGuide:
    'TOP requires an existing legacy app. An unavailable app console does not disable OAuth. Reauthorization and credential import are separate flows; IOP keys cannot substitute.',
  manualAuthorization: 'Enter manually',
  manualApplication: 'Application details and local passphrase',
  topManualTitle: 'How do I authorize legacy TOP manually?',
  topManualExisting:
    'Read only the app details from an old file to reauthorize. To use its existing token instead, choose Import existing authorization.',
  topManualPrepare:
    'No backup? Obtain the legacy TOP AppKey, AppSecret and registered Callback from the app administrator. App Name is optional. IOP app details cannot substitute.',
  topManualApprove:
    'Check app ownership and the Callback, then choose Start authorization. Sign in and personally approve on Alibaba. Local protection reuses the previous step, without setting another passphrase.',
  topManualFinish:
    'After authorization, choose Save and open workbench. Download only for backups. No Node service is needed.',
  topManualUnavailable:
    'Automatic reading failure does not prevent manual authorization. Without legacy app details or a bundle backup, contact the original app administrator or Alibaba support about the legacy console. The extension cannot generate TOP credentials from an IOP app.',
  topManualDocumentation: 'Official TOP authorization guide',
  toolGuide:
    'Follow these three steps. No commands or server setup needed. Sign in and approve on Alibaba itself.',
  boundaryTop:
    'Legacy TOP only. This tool never opens the retired crosstrade URL or sends the legacy app to IOP, and never automatically replaces the other workbench authorization.',
  reauthorize: 'Reauthorize',
  confirmReauthorize:
    'Reauthorize with the saved app for this protocol, keeping its Callback and permission scope. Personally confirm the agreement on Alibaba. Only this tool’s selected bundle will be replaced on success.',
  switchProtocolConfirm:
    'Switching clears unsubmitted app details, but does not delete either saved authorization. Continue?',
  returnSettings: 'Back to Settings',
  importTop: 'Import legacy authorization file',
  clearTop: 'Clear local TOP bundle',
  confirmClearTop:
    'Clear only TOP in this tool? IOP, workbench settings, S3, templates and tasks are preserved. This does not revoke platform access.',
  TOP_REQUIRED:
    'TOP is selected. Import a TOP bundle, or switch to IOP for that file. Neither authorization was changed.',
  TOP_TOKEN_REJECTED:
    'Legacy TOP rejected token exchange or renewal. Check the legacy app, Callback and grant validity; this is not a missing new System API permission. The original bundle was preserved.',
  TOP_TOKEN_RESULT_UNKNOWN:
    'Legacy TOP returned no confirmed token result. Do not repeat exchange or renewal; reauthorize. The original bundle was preserved.',
  title: 'Connect Alibaba Open Platform',
  subtitle: 'Your own application · New IOP',
  language: '中',
  intro:
    'This public page provides guidance and a callback only. App Secrets, tokens and passphrases stay inside the extension, never on this website.',
  step1: '1. Prepare your application',
  step1Text:
    'This console shows new IOP apps, not a second tab for legacy TOP. Prepare your IOP app and required permissions; keep existing TOP credentials in a separate TOP profile.',
  step2: '2. Register the callback',
  step2Text:
    'Register the address below as your application Callback URL. You can enter an existing address in the tool instead. We never change application settings automatically.',
  step3: '3. Authorize and export',
  step3Text:
    'Open the extension tool, enter your application details, personally approve on Alibaba, then export credentialInfo.json. Renew in the same tool.',
  callback: 'Callback URL',
  appName: 'App Name',
  appKey: 'App Key',
  appSecret: 'App Secret',
  passphrase: 'Local passphrase (6+ characters, not your Alibaba password)',
  registered:
    'I own this application and have registered the Callback. I will personally approve this authorization on Alibaba.',
  open: 'Open extension authorization tool',
  install: 'Install Chrome extension',
  center: 'Open application center',
  copy: 'Copy callback URL',
  copied: 'Copied',
  start: 'Start authorization',
  unlock: 'Unlock',
  refresh: 'Try extending access',
  export: 'Download authorization file',
  lock: 'Lock',
  clear: 'Clear local IOP bundle',
  import: 'Import new authorization file',
  importConfirm:
    'Replace this tool’s selected protocol bundle? The other protocol and workbench settings stay unchanged.',
  confirmExport:
    'This file contains a plaintext App Secret and tokens. Do not publish it or commit it to Git. Export?',
  confirmRefresh:
    'Renewal may rotate tokens. They will be saved locally; update any services using this bundle. Continue?',
  confirmClear: 'Clear only the independent local IOP bundle? This does not revoke authorization on Alibaba.',
  expires: 'Authorization expires',
  refreshExpires: 'Renewable until',
  unknownDate: 'Not provided by platform',
  empty: 'Not configured',
  locked: 'Bundle locked',
  ready: 'Authorization file saved securely',
  waiting:
    'Click Authorize on Alibaba. The extension will return here after the callback (valid for 10 minutes).',
  busy: 'Processing; keep this page open',
  unknown:
    'Result unresolved. No automatic retry. Reauthorize, or retry saving if only local persistence failed.',
  cancel: 'Cancel authorization',
  save: 'Retry local save (no platform request)',
  paste: 'Cannot receive your existing Callback automatically? Paste its full URL (extension only)',
  receive: 'Receive callback',
  saved: 'Completed and saved securely',
  downloaded: 'JSON download started; keep the file private',
  detected: 'Extension connected',
  missing: 'Install or update an extension supporting IOP authorization, then reopen this page.',
  received:
    'Callback delivered to the extension. Return to its tool for the result. No credentials are displayed or stored here.',
  invalidCallback: 'Invalid callback or expired task. Start authorization again in the extension.',
  clipboardError: 'Copy failed. Select and copy the callback address manually.',
  boundary:
    'For new IOP apps only. Applying updates IOP in the workbench, keeping TOP and the existing default.',
  privacy: 'Not affiliated with alibaba.com. Read platform rules before use. Do not share credential files.',
  privacyLink: 'Privacy',
  rules: 'Platform rules',
  AUTH_ACTION_FAILED:
    'Operation failed. Check your network or local storage. Never repeat a renewal with an unknown result.',
  AUTH_INPUT_INVALID:
    'Check the app details and passphrase, and use a complete bundle for the selected protocol.',
  CALLBACK_INVALID:
    'Use a registered public HTTPS Callback without query parameters, fragments or credentials.',
  AUTH_PERMISSION_REQUIRED: 'Allow the exact required host permissions and try again.',
  AUTH_TASK_ACTIVE: 'An operation is in progress. Wait or cancel authorization.',
  AUTH_TASK_EXPIRED: 'The 10-minute authorization task expired. Start again.',
  OAUTH_STATE_MISMATCH:
    'This callback does not match the active authorization. Start from the newly opened authorization tab.',
  OAUTH_CODE_MISSING: 'No authorization code in the callback. Authorize again.',
  OAUTH_PROVIDER_ERROR: 'Alibaba did not approve authorization. Check its page.',
  IOP_TOKEN_REJECTED:
    'Alibaba rejected the token request. Check permissions, Callback and authorization expiry. The previous bundle was not replaced.',
  IOP_TOKEN_RESULT_UNKNOWN:
    'The platform result cannot be confirmed. Authorize again; do not repeat renewal.',
  AUTH_REFRESH_RESULT_UNKNOWN:
    'The previous token exchange or renewal is unresolved. Retrying and export are blocked. Authorize again.',
  AUTH_REFRESH_EXPIRED: 'No valid Refresh Token. Authorize again.',
  AUTH_VAULT_LOCKED: 'Unlock the bundle first.',
  AUTH_UNLOCK_FAILED: 'Incorrect passphrase or damaged bundle.',
  AUTH_VAULT_INVALID: 'Invalid local bundle. Authorize again.',
  IOP_REQUIRED:
    'IOP is selected. Use an explicitly marked IOP bundle, or switch to TOP before importing a legacy TOP file.',
  AUTH_ORIGIN_DENIED: 'This page cannot access the authorization tool.'
};
export type AuthorizationMessageKey = keyof typeof zh;
