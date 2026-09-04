export const auth = {
  alibabaIndependentNotice: {
    title: 'Independent third-party tool',
    description:
      'oneVegetable is not affiliated with, endorsed by, sponsored by, or officially associated with Alibaba.com or its affiliates. Before use, read and follow the Alibaba.com platform rules and any rules applicable to your business.',
    rulesLink: 'Read Alibaba.com platform rules'
  },
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
    title: 'Connect Alibaba Open Platform in four steps',
    introduction: {
      extension:
        'The assistant reuses your current Alibaba session in Chrome and guides developer registration, application setup, and OAuth. You personally handle CAPTCHAs and platform agreements on Alibaba.',
      selfHosted:
        'An administrator can try cloud connection first. If a slider, CAPTCHA, or security confirmation appears, finish authorization in the Chrome extension and import the credentials securely.'
    },
    journey: {
      label: 'Alibaba Open Platform authorization steps',
      registration: {
        title: 'Register as a developer',
        description:
          'Prepare company details and supporting documents, then personally accept platform agreements.'
      },
      review: {
        title: 'Wait for review',
        description: 'The assistant recognizes review status, stops polling, and waits for your manual check.'
      },
      application: {
        title: 'Create an application',
        description:
          'Configure the application, Callback, and required permissions until it is ready to authorize.'
      },
      authorization: {
        title: 'Authorize and save',
        description: 'Validate the OAuth Callback and state, then save the acquired credentials encrypted.'
      }
    },
    safety: {
      title: 'You confirm every sensitive step',
      extension:
        'The extension never reads your Alibaba password, fills company data, uploads documents, accepts agreements, or bypasses CAPTCHAs. App Secret and tokens are encrypted only in the trusted extension context.',
      selfHosted:
        'Cloud credentials exist only in the current HTTPS request and temporary browser memory. If Alibaba requires human verification, the flow stops and guides you to the local extension.'
    },
    acknowledgement:
      'I understand that API availability depends on account permissions and business qualifications, and I understand the purposes of local data, real writes, and host access.',
    privacy: 'View privacy notice',
    browseOnly: 'Later — browse only',
    configure: 'Start authorization assistant',
    readError: 'Unable to read first-use status',
    saveError: 'Unable to save first-use status'
  }
} as const;
