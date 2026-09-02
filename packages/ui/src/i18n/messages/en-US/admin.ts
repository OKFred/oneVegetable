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
  meta: {
    title: 'Social accounts',
    description:
      'Configure one Meta application and connect multiple Facebook identities, Pages, and Instagram professional accounts.',
    refresh: 'Refresh',
    runtime: {
      r2: 'Private R2 media storage',
      filesystem: 'Private local media directory',
      unavailable: 'Media storage unavailable',
      storageIssue:
        'Temporary media storage is missing, so Facebook and Instagram publishing tasks cannot be prepared.',
      serviceIssue:
        'The publishing service has not finished initializing. Check credential encryption and runtime bindings.',
      ready: 'Social publishing runtime components are ready.',
      incomplete: 'The backend did not return complete social publishing runtime status.',
      readyBadge: 'Publishing ready',
      actionRequired: 'Action required'
    },
    confirmation: {
      saveTitle: 'Confirm Meta application configuration',
      clearTitle: 'Confirm Meta application configuration removal',
      approveTitle: 'Confirm extension device approval',
      revokeTitle: 'Confirm extension device revocation',
      disconnectTitle: 'Confirm Meta account disconnection',
      replaceSecret:
        'The new App Secret will be encrypted and never shown again. Disconnect existing accounts before changing the App ID or public origin.',
      keepSecret:
        'The current App Secret will be retained. Disconnect existing accounts before changing the App ID or public origin.',
      firstSave:
        'The App Secret will be encrypted and never shown again. Confirm that the App ID and public origin are correct.',
      clear: 'Disconnect all Meta accounts before clearing the application configuration.',
      approve:
        'The Chrome extension holding this one-time pairing code will receive a 30-day social publishing device token.',
      revoke:
        'After revoking {name}, this extension can no longer read publishing destinations or create social publishing tasks.',
      disconnect: 'Disconnecting {name} also removes its Facebook Page and Instagram publishing destinations.'
    },
    errors: {
      unsupportedConfig: 'This backend does not support Meta application configuration',
      noConfiguration: 'There is no Meta application configuration to clear',
      unsupportedDisconnect: 'This backend does not support disconnecting Meta accounts',
      unsupportedPairing: 'This backend does not support extension pairing',
      unsupportedRevoke: 'This backend does not support extension device revocation',
      operation: 'Meta configuration operation failed'
    },
    feedback: {
      deviceClaimed: 'The extension claimed authorization and the device list updated automatically',
      configurationSaved: 'Meta application configuration saved encrypted',
      configurationCleared: 'Meta application configuration cleared',
      disconnected: 'Disconnected {name}',
      pairingApproved: 'Extension pairing approved; waiting for the extension to claim authorization',
      deviceRevoked: 'Revoked {name}',
      callbackCopied: 'Callback URL copied',
      connected: 'Meta account connected',
      connectionFailed: 'Meta account connection failed: {reason}',
      unknownReason: 'Unknown reason'
    },
    configuration: {
      title: 'Meta application configuration',
      configured: 'Configured ···{suffix}',
      notConfigured: 'Not configured',
      appId: 'App ID',
      appSecret: 'App Secret',
      keepSecretPlaceholder: 'Leave empty to keep the current secret',
      requiredSecretPlaceholder: 'Required for initial configuration',
      publicOrigin: 'Public origin',
      publicOriginDescription: 'Instagram temporarily reads pending images from this HTTPS origin.',
      remark: 'Remark',
      optional: 'Optional',
      callbackCopyAria: 'Copy Callback URL',
      save: 'Save configuration',
      connectFacebook: 'Connect Facebook Page',
      connectBoth: 'Facebook + Instagram',
      clear: 'Clear configuration'
    },
    connections: {
      title: 'Connected accounts and publishing destinations',
      description: 'Only destinations with content-creation tasks and the required permissions can publish.',
      empty: 'No Meta accounts connected.',
      summary: '{count} destinations · Updated {time}',
      connected: 'Connected',
      reconnect: 'Reconnect required',
      disconnectAria: 'Disconnect {name}',
      canPublish: 'Can publish',
      unavailable: 'Unavailable'
    },
    devices: {
      title: 'Extension devices',
      description:
        'Extensions receive only destination-read and social-publishing permissions, never the Meta App Secret or platform Token.',
      activeCount: '{count} active',
      pairingCode: 'One-time pairing code shown by the extension',
      approve: 'Approve pairing',
      waiting: 'Waiting for extension authorization claim',
      notClaimed: 'The extension has not claimed authorization',
      waitingDescription:
        'Return to the extension and select “Check approval result.” The device list updates automatically after the claim.',
      timeoutDescription:
        'Pairing was approved. Check the result in the extension, then return here to refresh the device list automatically.',
      empty: 'No paired extension devices.',
      expires: 'Expires: {time}',
      lastUsed: 'Last used: {time}',
      active: 'Active',
      expired: 'Expired',
      revoked: 'Revoked',
      revokeAria: 'Revoke {name}'
    }
  },
  view: {
    eyebrow: 'Access control',
    title: 'Administration',
    description:
      'Manage local accounts, the read-only policy matrix, requestId diagnostics, and append-only audit records. Hiding a page is not an authorization boundary; the BFF authorizes every request again.',
    refresh: 'Refresh',
    confirmation: {
      defaultTitle: 'Confirm admin operation',
      purgeTitle: 'Confirm request diagnostic cleanup',
      disableTitle: 'Confirm user deactivation',
      enableTitle: 'Confirm user activation',
      demoteTitle: 'Confirm administrator demotion',
      promoteTitle: 'Confirm administrator promotion',
      passwordTitle: 'Confirm password reset',
      sessionsTitle: 'Confirm all session revocation',
      purgeDescription:
        'Request diagnostic records older than the {days}-day retention period will be deleted.',
      disableDescription:
        'After deactivating {username}, current and future requests from this user are rejected.',
      enableDescription: '{username} can sign in again after activation.',
      demoteDescription:
        '{username} will become a regular read-only user. The last active administrator cannot be demoted.',
      promoteDescription:
        '{username} will become an administrator with access to user, audit, and system management.',
      passwordDescription:
        'The password for {username} will be reset. The generated one-time password is shown only once.',
      sessionsDescription:
        'All sessions for {username} will be revoked immediately, requiring the user to sign in again.',
      configured: 'configured',
      confirm: 'Confirm and continue',
      auditNotice: 'The BFF rechecks administrator authorization and records the requestId and audit event.'
    },
    errors: {
      load: 'Could not load administration data',
      usersLoad: 'Could not load users',
      auditLoad: 'Could not load audit events',
      requestsLoad: 'Could not load request diagnostics',
      filter: 'requestId filtering failed',
      purge: 'Could not clean up request diagnostics',
      enrollmentUnsupported: 'This backend does not support Passkey user invitations.',
      createUser: 'Could not create user',
      updateUser: 'Could not update user',
      resetPassword: 'Could not reset password',
      revokeSessions: 'Could not revoke sessions',
      operation: 'Administration operation failed',
      copyPassword: 'Copy failed. Select the one-time password manually.',
      copyEnrollment: 'Copy failed. Select the registration link manually.'
    },
    feedback: {
      purgedNotice: 'Cleaned {count} request diagnostic records; the latest {days} days are retained.',
      purgedToast: 'Cleaned {count} expired request diagnostic records.',
      userCreated: 'User {username} created.',
      passwordReset: 'Password for {username} reset.',
      sessionsRevoked: 'All sessions for {username} were revoked',
      sessionsRevokedToast: 'All sessions for {username} were revoked.',
      passwordCopied: 'One-time password copied. Share it through a secure channel.',
      enrollmentCopied: 'Registration link copied.'
    },
    localAdmin: {
      title: 'Local administrator',
      description:
        'The extension always uses a local administrator identity. It is not a BFF administrator session, so user management, server audit, and session revocation are unavailable.'
    },
    system: {
      runtime: 'Runtime / environment',
      database: 'Database / Schema',
      apiPrefix: 'API prefix',
      gateway: 'Alibaba gateway',
      gatewayCredentials: 'Credentials {credential} · Real read calls {read}',
      galleryMutations: 'Gallery groups / upload / URL transfer {status}',
      complete: 'complete',
      notConfigured: 'not configured',
      enabled: 'enabled',
      disabled: 'disabled',
      retention: 'Request diagnostics retained for {days} days'
    },
    users: {
      title: 'User management',
      empty: 'No users',
      createTitle: 'Create user',
      username: 'Username',
      initialPassword: 'Initial password',
      passwordPlaceholder: 'Password of at least 12 bytes',
      role: 'Role',
      userRole: 'Regular user (read-only)',
      adminRole: 'Administrator',
      remarkOptional: 'Remark (optional)',
      remarkPlaceholder: 'Up to 500 characters',
      createEnrollment: 'Create and generate registration link',
      create: 'Create',
      columns: {
        user: 'User',
        remark: 'Remark',
        save: 'Save',
        role: 'Role',
        status: 'Status',
        actions: 'Actions',
        disable: 'Deactivate',
        enable: 'Activate',
        resetPassword: 'Reset password',
        revokeSessions: 'Revoke sessions',
        active: 'Active',
        disabled: 'Disabled'
      }
    },
    policy: {
      title: 'Policy matrix (read-only)',
      capabilityTitle: 'Capability status',
      total: 'Catalog total',
      readable: 'Readable active',
      mutationsLocked: 'Debugger writes disabled',
      restricted: 'Eligibility restricted',
      notice: 'Administrators cannot bypass capability, eligibility, Jushita, or mutation-flag restrictions.'
    },
    requests: {
      title: 'Request diagnostics',
      description:
        'Correlate runtime, route, status code, and duration precisely by requestId. Request bodies, passwords, Tokens, Cookies, and file Base64 are not stored.',
      filterAria: 'Filter by requestId',
      query: 'Search',
      purge: 'Clean by retention period',
      empty: 'No request diagnostics'
    },
    audit: {
      title: 'Operation audit',
      description:
        'Records actor, action, outcome, and denial reason using the same requestId as request diagnostics.',
      empty: 'No operation audit records'
    },
    columns: {
      time: 'Time',
      actor: 'Actor',
      runtimeRoute: 'Runtime / route',
      result: 'Result',
      statusDuration: 'Status / duration',
      action: 'Action',
      reason: 'Reason'
    },
    temporaryPassword: {
      title: 'One-time temporary password',
      description:
        'The password for {username} was reset. It will not be shown again after this dialog closes.',
      userFallback: 'User',
      warning:
        'Copy and share it through a secure channel. Do not put the password in remarks, logs, or screenshots.',
      copy: 'Copy password',
      close: 'Saved, close'
    },
    enrollment: {
      title: 'One-time Passkey registration link',
      description: 'The registration link for {username} expires at {time}.',
      warning:
        'The link is shown only once. Share it through a secure channel. The user registers a Passkey and receives personal recovery codes after opening it.',
      copy: 'Copy link',
      close: 'Saved, close'
    }
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
