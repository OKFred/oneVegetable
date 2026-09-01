export const settings = {
  page: {
    title: 'Connection settings',
    description:
      'Credentials never enter page requests. In extension mode, only the MV3 service worker reads them and signs requests.'
  },
  confirmation: {
    revokeTitle: 'Revoke host access?',
    clearDiagnosticsTitle: 'Clear diagnostics?',
    revokeDescription: 'After revoking {origin}, Chrome will ask again the next time this host is accessed.',
    clearDiagnosticsDescription: 'This will clear the {count} redacted diagnostic records currently stored.',
    continue: 'Continue',
    clearDiagnosticsDetail:
      'Diagnostics are redacted, but cannot be recovered after clearing. Account credentials and product drafts are not deleted.',
    revokeDetail:
      'Only the selected additional host is revoked. Required access to the official Alibaba gateway is unaffected.'
  },
  diagnostics: {
    busy: 'Processing diagnostic records',
    emptyDisabled: 'There are no diagnostic records to clear',
    loadError: 'Unable to load diagnostics',
    clearError: 'Unable to clear diagnostics',
    exported: 'Exported {count} redacted diagnostic records.',
    cleared: 'Diagnostic records cleared.',
    title: 'Redacted diagnostics',
    description:
      'Stores only the latest 100 operation names, request IDs, durations, error codes, and trace IDs. Request payloads, credentials, and response bodies are never recorded.',
    countLabel: 'Diagnostic record count',
    count: '{count} records',
    latestError: 'Latest error:',
    refresh: 'Refresh',
    export: 'Export diagnostics',
    clear: 'Clear diagnostics'
  },
  vault: {
    title: 'Open Platform credential protection',
    description:
      'Credentials are encrypted on this device. Once unlocked, refreshing the page or suspending the MV3 background does not require the passphrase again. A browser restart, extension update, manual lock, or selected idle timeout locks it again.',
    status: {
      loading: 'Loading',
      unlocked: 'Unlocked',
      legacy: 'Migration required',
      empty: 'Not created',
      invalid: 'Invalid format',
      locked: 'Locked'
    },
    activity: 'Last activity: {time}; status snapshot has about {minutes} minutes remaining.',
    legacyTitle: 'Legacy plaintext credentials found',
    legacyDescription:
      'Real requests no longer read this record. After you set a new passphrase, the service worker encrypts it in place. The page never receives the old App Secret or Access Token.',
    lockReason: {
      idle: 'Open Platform credentials were locked after the idle timeout',
      sessionEnded: 'The Chrome session ended — unlock again',
      manual: 'Open Platform credentials were locked manually'
    },
    lockDescription: {
      sessionEnded:
        'Restarting Chrome, updating, or reloading the extension clears session unlock material held only in memory. Locally encrypted credentials remain stored safely.',
      other:
        'The page and background unlock state has been cleared. Enter the passphrase again before making real queries.'
    },
    passphrase: 'Protection passphrase',
    unlock: 'Unlock',
    invalidTitle: 'The local credential record is invalid',
    invalidDescription:
      'Automatic repair is disabled to avoid overwriting unrecoverable data. Back up your browser profile, then use the full clear action below to start over.',
    lockNow: 'Lock now',
    idleTitle: 'Automatic idle lock',
    idleDescription:
      'Idle locking is disabled by default and is enabled only after you choose a duration. MV3 background suspension does not clear the unlocked state in the current Chrome session.',
    idleLabel: 'Automatic idle lock duration',
    neverLock: 'Do not lock automatically (default)',
    minutes: '{minutes} minutes',
    savePolicy: 'Save lock policy',
    rotateTitle: 'Change the local protection passphrase',
    rotateDescription:
      'A new salt and key are generated to re-encrypt the record; the old passphrase is not needed again.',
    newPassphrase: 'New protection passphrase',
    confirmNewPassphrase: 'Confirm new protection passphrase',
    setPassphrase: 'Set protection passphrase',
    confirmPassphrase: 'Confirm protection passphrase',
    minimumCharacters: 'At least {count} characters',
    enterAgain: 'Enter again',
    rotate: 'Change passphrase',
    migrate: 'Encrypt and migrate legacy credentials',
    saveEncrypted:
      'Credentials and settings were encrypted and will remain available in the current Chrome session.',
    savedToast: 'Credentials and settings saved',
    unlockedFeedback:
      'Credentials unlocked. A page refresh or background suspension will not ask for the passphrase again.',
    migratedFeedback:
      'Legacy plaintext credentials were encrypted in place and remain available in the current Chrome session.',
    lockedFeedback: 'Credentials locked. The unlocked state in the current Chrome session was cleared.',
    rotatedFeedback: 'Credentials were re-encrypted with a new salt and passphrase.',
    idleDisabledFeedback:
      'Automatic idle locking is off. Credentials remain available in the current Chrome session.',
    idleEnabledFeedback:
      'Open Platform credentials will lock after {minutes} consecutive minutes without use.',
    statusError: 'Unable to read credential protection status',
    unlockError: 'Unable to unlock credentials',
    migrateError: 'Unable to encrypt legacy credentials',
    lockError: 'Unable to lock credentials',
    rotateError: 'Unable to change the protection passphrase',
    policyError: 'Unable to save the idle lock policy',
    mismatchError: 'The two local protection passphrases do not match'
  },
  credentials: {
    title: 'Alibaba.com Open Platform credentials',
    guideTitle: 'Connect real APIs in three steps',
    guideDescription:
      'The extension assistant can reuse your current Chrome sign-in, read an existing application, and complete OAuth. Handle a slider, CAPTCHA, or secret-view confirmation in the Alibaba tab it opens. You can also enter credentials manually or import a credential bundle.',
    acquire: 'Get Open Platform credentials',
    openCenter: 'Open Alibaba Application Center',
    importBundle: 'Import credential bundle JSON',
    importLabel: 'Import credential bundle JSON',
    encryptedPlaceholder: 'Encrypted value saved; leave blank to keep it',
    gateway: 'HTTPS gateway',
    signMethod: 'Signature algorithm',
    saving: 'Saving…',
    save: 'Save settings',
    mockSavedFeedback: 'Demo settings were saved in this browser.',
    encryptedSavedFeedback: 'Settings were encrypted and written to chrome.storage.local again.',
    mockSavedToast: 'Demo settings saved',
    savedToast: 'Settings saved',
    saveError: 'Unable to save settings',
    bundleTooLarge: 'Credential bundle JSON cannot exceed 256 KiB',
    bundleLoaded:
      'App Key, App Secret, and Access Token were read from the bundle but are not saved yet. Set a local protection passphrase and confirm save.',
    bundleImportError: 'Unable to import credential bundle',
    acquired:
      'Alibaba Open Platform credentials were acquired, encrypted, and can be used in the current Chrome session.',
    bundleMissing: 'The credential bundle is missing an App Key, App Secret, or Access Token'
  },
  security: {
    title: 'Security boundary',
    description:
      'Encryption reduces exposure from local static storage, but an unlocked browser or malicious extension may still expose the App Secret. Higher-security deployments should use a BFF you control.'
  },
  socialBackend: {
    title: 'Social publishing backend',
    description:
      'Pair the extension with your own oneVegetable backend to publish through the official Facebook and Instagram APIs.',
    defaultDeviceName: 'Chrome extension',
    states: {
      loading: 'Loading',
      paired: 'Paired',
      pending: 'Waiting for administrator approval',
      expired: 'Expired',
      unconfigured: 'Not configured'
    },
    pairCreated: 'Pairing code created. Approve it from backend Administration.',
    pairSucceeded: 'Social publishing backend paired',
    pairPending: 'The administrator has not approved it yet. Try again later.',
    disconnected: 'Social publishing backend authorization removed from the extension',
    connectionHealthy: 'Connection is healthy: {total} destinations found, {publishable} can publish',
    codeCopied: 'Pairing code copied',
    operationFailed: 'Social publishing backend operation failed',
    baseUrl: 'Backend URL',
    deviceName: 'Device name',
    extensionId: 'Extension ID',
    approveTitle: 'Approve this pairing code in Administration',
    copyCode: 'Copy pairing code',
    expires: 'The pairing code expires at {time}. Return here to check after approval.',
    openAdmin: 'Open Administration',
    authorizationExpires:
      'Authorization expires at {time}. The token is stored only in trusted extension storage and is never displayed.',
    expiredTitle: 'Device authorization expired',
    expiredDescription:
      'The 30-day validity period may have ended, or an administrator may have revoked the device. Pairing again issues a new token and never restores the old one.',
    pairAgain: 'Pair again',
    startPairing: 'Start pairing',
    checkApproval: 'Check approval',
    checkConnection: 'Check connection',
    disconnect: 'Disconnect',
    disconnectTitle: 'Disconnect the social publishing backend?',
    disconnectDescription:
      'This removes the device token from the extension. To invalidate the server-side token immediately, also revoke this device in backend Administration.',
    disconnectConfirm: 'Disconnect'
  },
  alibabaLanguage: {
    title: 'Alibaba API language',
    description:
      'Only affects Schema, official guidance, and Alibaba requests that support the language parameter. It does not change the interface language.',
    interfaceHint: 'Use the “中 / EN” button in the top-right corner to change the interface language.',
    label: 'Platform request language',
    chinese: 'Simplified Chinese (zh_CN)',
    english: 'English (en_US)',
    saved: 'Alibaba API language saved as {language}.'
  },
  permissions: {
    title: 'Host access',
    description:
      'The official gateway is required by the extension. This list contains only hosts granted on demand for custom gateways or external-image transfers.',
    empty: 'No additional hosts are currently authorized.',
    revoke: 'Revoke',
    revokeLabel: 'Revoke {origin}',
    refresh: 'Refresh access',
    loadError: 'Unable to load host access',
    revokeError: 'Unable to revoke host access',
    revoked: 'Revoked {origin}. Access will be requested again when needed.',
    notGranted: '{origin} is not currently authorized.'
  },
  localData: {
    title: 'Local data and privacy',
    description:
      'The inventory contains only categories and estimated sizes. It does not export App Secrets, Access Tokens, draft content, or diagnostic details.',
    columns: {
      category: 'Category',
      storage: 'Storage',
      count: 'Count',
      size: 'Size',
      retention: 'Retention'
    },
    sensitive: 'Sensitive',
    empty: 'No local data',
    refresh: 'Refresh inventory',
    export: 'Export inventory',
    exported: 'Exported a local data inventory without stored values.',
    loadError: 'Unable to load the local data inventory',
    dangerTitle: 'Clear all extension local data',
    dangerDescription:
      'This cannot be undone. Enter “{phrase}” to delete credentials, settings, drafts, diagnostics, first-use status, and revoke additional host access.',
    clearLabel: 'Clear confirmation phrase',
    clearPhrase: 'clear all data',
    clear: 'Clear everything',
    cleared:
      'Extension local data and additional host access were cleared. The first-use notice will appear again after reload.',
    clearError: 'Unable to clear extension local data'
  }
} as const;
