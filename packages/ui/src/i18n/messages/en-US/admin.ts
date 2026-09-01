export const admin = {
  operationPending: 'Reading operation availability for the current account…',
  credentialAcquisition: {
    title: 'Get Open Platform credentials',
    description:
      "Reuse Alibaba's current Chrome session. The extension never reads or stores the website password.",
    existingApplicationTitle: 'The assistant only reuses an existing application',
    existingApplicationDescription:
      'The Alibaba application center opens after you start. Complete sign-in, sliders, CAPTCHAs, MFA, or secret-view confirmation directly in that tab. The extension does not bypass security checks, create applications, or accept platform agreements.',
    callbackLabel: 'Callback URL (optional)',
    callbackPlaceholder: "Leave empty to keep the application's current Callback",
    callbackNotice:
      'The application configuration changes only after you enter and confirm a URL. example.com is never filled automatically.',
    start: 'Open Alibaba and start',
    waitingTitle: 'Waiting for the current step in Alibaba',
    waitingDescription:
      'Complete sign-in, CAPTCHA, secret-view confirmation, or OAuth authorization in the Alibaba tab that just opened. The assistant continues automatically afterward.',
    checkNow: 'Check now',
    selectApplication: 'Select an application to reuse',
    selectApplicationDescription:
      'Only the AppKey suffix is shown. Full secrets are never returned to this page.',
    applicationSummary: '{source} · AppKey suffix {suffix} · {status}',
    unknownStatus: 'Unknown status',
    callbackChangeTitle: 'Confirm Callback change',
    callbackOAuthTitle: 'Confirm OAuth Callback',
    currentUrl: 'Current URL',
    requestedUrl: 'Requested URL',
    callbackPermissionNotice:
      'Chrome will request temporary site access only for the actual Callback host, so it can capture this OAuth code and validate state.',
    keepCallback: 'Keep current URL and continue',
    confirmCallback: 'Confirm change and continue',
    continueAuthorization: 'Continue authorization',
    completedTitle: 'Credentials acquired',
    completedSummary: '{appName} · AppKey suffix {suffix} · {count} permissions',
    saveToExtension: 'Save encrypted in the extension',
    vaultLocked:
      'Local credentials are locked. Close this assistant, unlock them in Settings, and start the acquisition flow again.',
    passphrasePlaceholder: 'Set a local passphrase (at least 6 characters)',
    passphraseConfirmationPlaceholder: 'Enter the passphrase again',
    saveEncrypted: 'Save encrypted',
    plaintextTitle: 'Export plaintext credentialInfo.json',
    plaintextDescription:
      'The file contains the App Secret, Access Token, and Refresh Token for importing into a self-hosted backend. Delete it immediately after import and do not sync it to cloud storage or Git.',
    plaintextAcknowledgement:
      'I understand that this file contains plaintext secrets and will keep it secure.',
    exportPlaintext: 'Export credentialInfo.json',
    errors: {
      passphraseLength: 'Enter at least 6 characters for the local passphrase',
      passphraseMismatch: 'The two local passphrases do not match',
      acquisition: 'Alibaba credential acquisition failed',
      operation: 'Credential assistant operation failed'
    },
    feedback: {
      saved: 'Credentials saved encrypted in the extension.',
      exported:
        'credentialInfo.json downloaded. Store it securely and delete the plaintext file after import.'
    },
    restart: 'Start again',
    extensionRequired:
      'This is already running in the production extension. Restart the local assistant. Reason: {reason}',
    close: 'Close'
  },
  cloudAcquisition: {
    title: 'Connect Alibaba automatically',
    description:
      'Cloudflare Browser Run tries first. Use the production Chrome extension when a security check appears.',
    errors: {
      start: 'Cloud acquisition is temporarily unavailable',
      continue: 'The credential flow could not continue',
      status: 'Could not read credential acquisition status',
      acquisition: 'Credential acquisition failed'
    },
    fallback: {
      browserUnavailable: 'The cloud browser is currently unavailable.',
      browserQuotaExhausted: "Today's free Browser Run quota is exhausted.",
      botRejected: 'Alibaba identified the cloud browser as automated traffic.',
      captcha: 'Alibaba requires a CAPTCHA.',
      slider: 'Alibaba requires slider verification.',
      mfa: 'Alibaba requires multi-factor authentication.',
      secretVerification: 'Viewing the App Secret requires a security confirmation.',
      layoutUnsupported: 'The Alibaba page layout or authorization agreement requires manual confirmation.',
      sessionExpired: 'The cloud browser session expired.'
    },
    sensitiveTitle: 'Sensitive data handling',
    sensitiveDescription:
      'The account and password exist only in this HTTPS request and temporary browser memory. They are not written to D1, logs, audit records, or screenshots. The system only reuses an existing application; it does not create an application, request permissions, or accept agreements.',
    quotaNotice:
      'Browser Run has limited free quota. Use the local extension directly if a CAPTCHA, slider, or multi-factor check appears.',
    account: 'Alibaba sign-in account',
    password: 'Alibaba sign-in password',
    callback: 'Callback URL (optional)',
    callbackPlaceholder: "Leave empty to keep the application's current URL",
    callbackNotice:
      'example.com is never filled automatically. Existing and requested URLs are shown again before an explicit change.',
    cancel: 'Cancel',
    useExtension: 'Use local extension',
    connecting: 'Connecting securely…',
    automatic: 'Acquire in the cloud',
    runningTitle: 'Reading applications and completing OAuth authorization…',
    runningDescription:
      'The task lasts at most 10 minutes and switches to the extension option if a security check appears.',
    selectApplication: 'Select an existing application',
    selectApplicationDescription:
      'Multiple applications were found. Only names, status, and AppKey suffixes are shown.',
    legacyApplicationCenter: 'Legacy application center',
    applicationCenter: 'Application center',
    unknownStatus: 'Unknown status',
    callbackConfirmation: 'Confirm Callback change',
    currentUrl: 'Current URL',
    newUrl: 'New URL',
    keepUrl: 'Keep current URL',
    confirmUrl: 'Confirm change and continue',
    extensionTitle: 'Use the local Chrome extension',
    extensionNoQuota: 'The local extension does not consume Browser Run quota.',
    extensionDescription:
      "The extension reuses Alibaba's current Chrome session, never reads the website password, and lets you complete human verification directly.",
    extensionSteps: {
      install: 'Install or open the production oneVegetable extension.',
      authorize:
        'Select “Get Open Platform credentials” in extension settings and complete the authorization assistant.',
      import: 'Export credentialInfo.json, return here, and use “Import credentials” to store it encrypted.'
    },
    back: 'Back',
    close: 'Close',
    openStore: 'Open Chrome Web Store',
    completedTitle: 'Credentials saved encrypted',
    completedDescription: '{appName} · AppKey suffix {suffix}. Secrets are never revealed on this page.',
    done: 'Done',
    failedTitle: 'Automatic acquisition did not complete',
    restart: 'Start again'
  },
  selfHosted: {
    confirmation: {
      importTitle: 'Confirm Alibaba credential import',
      clearTitle: 'Confirm Alibaba credential removal',
      removePasskeyTitle: 'Confirm Passkey removal',
      recoveryTitle: 'Confirm recovery-code reset',
      pauseTitle: 'Pause all real writes',
      resumeTitle: 'Resume verified real writes',
      importDescription:
        '{file} will be imported and encrypted. Neither the page nor the API will reveal its secrets.',
      clearDescription: 'Real Alibaba capabilities stop immediately after clearing and require a new import.',
      removePasskeyDescription:
        'This device will no longer be able to sign in. The only login credential cannot be removed.',
      recoveryDescription:
        'All existing recovery codes become invalid immediately. New codes are shown only once.',
      pauseDescription:
        'The emergency stop overrides every operation flag, rejecting all verified real writes before network access.',
      resumeDescription: 'Only verified writes in the fixed allowlist are resumed.'
    },
    errors: {
      load: 'Could not load self-hosted settings',
      fileSize: 'The credential file must not exceed 1 MiB.',
      invalidFile: 'Invalid credentials.json',
      passkeyRegistration: 'Passkey registration failed',
      tokenRefresh: 'Token refresh failed',
      reselect: 'Select the credential file again.',
      pauseUnsupported: 'This backend does not support the real-write emergency stop.',
      passkeyUnsupported: 'This backend does not support Passkey management.',
      recoveryUnsupported: 'This backend does not support recovery-code management.',
      operation: 'Admin operation failed',
      copy: 'Copy failed. Select the text manually.',
      panel: 'Self-hosted settings operation failed'
    },
    feedback: {
      passkeyRegistered: 'New Passkey registered.',
      tokenRefreshed: 'Alibaba Token refreshed.',
      importRemark: 'Imported from {file}',
      imported: 'Alibaba credentials imported and encrypted.',
      cleared: 'Alibaba credentials cleared.',
      pauseRemark: 'Emergency pause by administrator',
      resumeRemark: 'Resume confirmed by administrator',
      paused: 'All real writes paused.',
      resumed: 'Verified real writes resumed.',
      passkeyRemoved: 'Passkey removed.',
      recoveryCopied: 'Recovery codes copied.'
    },
    title: 'Cloudflare self-hosted settings',
    description:
      'Secrets are decrypted only inside the Worker. Admin APIs return only completeness and expiry status.',
    credentials: 'Alibaba Open Platform credentials',
    configured: 'Configured',
    notConfigured: 'Not configured',
    expires: 'Access Token expires',
    lastRefreshError: 'Latest refresh error',
    connect: 'Connect automatically',
    import: 'Import credentials.json',
    refreshToken: 'Refresh Token',
    clear: 'Clear',
    emergency: 'Real-write emergency stop',
    allPaused: 'All paused',
    allowlistOpen: 'Allowlist enabled',
    emergencyDescription:
      'The emergency stop overrides all operation flags. Administrators still cannot bypass unverified capabilities, eligibility restrictions, or contract validation.',
    resume: 'Resume verified writes',
    pause: 'Pause all real writes',
    passkeys: 'My Passkeys',
    add: 'Add',
    remove: 'Remove',
    regenerateRecovery: 'Regenerate recovery codes',
    recoveryTitle: 'Save new recovery codes',
    recoveryDescription:
      'All previous recovery codes are invalid. New codes will not be shown again after closing.',
    copy: 'Copy',
    saved: 'I have saved them'
  }
} as const;
