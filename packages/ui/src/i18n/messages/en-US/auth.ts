export const auth = {
  errors: {
    bootstrapStatus: 'Unable to confirm administrator setup status',
    passkeyUnsupported: 'This browser does not support passkeys. Use the latest Chrome, Edge, or Safari.',
    authenticationFailed: 'Authentication failed',
    copyRecoveryCodes: 'Copy failed. Select and save the recovery codes manually.',
    passkeyClientUnsupported: 'This client version does not support passkeys. Refresh the page.'
  },
  audit: {
    firstLocalAdmin: 'First local administrator',
    firstPasskey: 'First passkey',
    recoveryDevice: 'Recovery device',
    invitedDevice: 'Invited device'
  },
  recoveryCodes: {
    title: 'Save your one-time recovery codes',
    description: 'Use these codes to register a new passkey if a device is lost or the domain changes',
    warning:
      'These recovery codes are shown only once and each can be used once. Save them in a password manager, not in project notes or screenshots.',
    copy: 'Copy recovery codes',
    continue: 'I saved them securely — open the workspace'
  },
  title: 'Sign in to the operations workspace',
  subtitle: {
    passkey: 'Cloudflare self-hosted · Passkey',
    local: 'Local account · Opaque session · ABAC'
  },
  identityNotice:
    'This is your oneVegetable workspace identity, not your Alibaba.com account. Import Alibaba OpenAPI credentials from Administration after signing in.',
  modes: {
    passkeyLogin: 'Passkey sign-in',
    recovery: 'Recover access',
    login: 'Sign in',
    bootstrap: 'Set up administrator'
  },
  status: {
    checking: 'Checking setup status…',
    initializedPasskey: 'The workspace is initialized. Sign in with a registered passkey.',
    initializedLocal: 'The workspace is initialized. Sign in with a registered local account.',
    missingBootstrapToken:
      'The workspace is not initialized and no one-time administrator bootstrap token is configured.'
  },
  fields: {
    bootstrapToken: 'Administrator bootstrap token',
    username: 'Workspace username',
    recoveryCode: 'One-time recovery code',
    password: 'Workspace password',
    passwordHint: 'Use at least about 12 characters; a password manager is recommended'
  },
  submit: {
    working: 'Follow the browser prompt…',
    createPasskey: 'Create administrator passkey',
    recoverPasskey: 'Register a new passkey with a recovery code',
    enrollPasskey: 'Accept invitation and register passkey',
    loginPasskey: 'Sign in with a passkey',
    login: 'Sign in',
    createAdmin: 'Create administrator'
  },
  onboarding: {
    eyebrow: 'First use',
    title: 'Confirm data and API boundaries',
    introduction:
      'You can browse the capability catalog and edit locally without OpenAPI credentials. Real reads require your own credentials. Gallery group management, image upload, and external-image transfer are enabled; other real writes remain disabled.',
    steps: {
      application:
        'Create or select an Online application in Alibaba Application Center, then obtain its App Key and App Secret.',
      oauth: 'Complete OAuth authorization to obtain an Access Token for the account.',
      settings:
        'Open Settings, choose a local protection passphrase, then enter or import those three credentials.'
    },
    vault: {
      title: 'Credentials are encrypted on this device',
      description:
        'App Key, App Secret, and Access Token are encrypted with your passphrase and stored in chrome.storage.local. The passphrase is never stored and content scripts cannot read it. The unlocked state stays only in the current Chrome session, so a page refresh or background suspension does not require it again.'
    },
    permissions: {
      title: 'Host access is requested when needed',
      description:
        'The official gateway is required. Chrome asks for custom gateway and external-image origins only when needed, and you can revoke them from Settings.'
    },
    verification: {
      title: 'Local validation is not platform authorization',
      description:
        'Local demos, contract validation, and browser regression tests do not mean Alibaba.com granted API access. Availability depends on the current account, business qualifications, and platform response.'
    },
    localData: {
      title: 'Inspect and clear local data',
      description:
        'Settings provides an inventory and full-clear action. Redacted diagnostics stay only in the current browser session and contain no request payloads or response bodies.'
    },
    acknowledgement:
      'I understand that API availability depends on account permissions and business qualifications, and I understand the purposes of local data, real writes, and host access.',
    privacy: 'View privacy notice',
    browseOnly: 'Later — browse only',
    configure: 'Configure credentials',
    readError: 'Unable to read first-use status',
    saveError: 'Unable to save first-use status'
  }
} as const;
