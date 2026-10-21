export const settings = {
  bffCredentials: {
    boundary: 'Credentials stay on the backend and are not displayed here.',
    cloud: 'Cloudflare admins can import a bundle or start authorization.',
    admin: 'Open admin configuration'
  },
  page: {
    title: 'Settings',
    description: 'Manage platform connections, asset storage and local preferences.'
  },
  sections: {
    credentials: 'API credentials',
    storage: 'S3 asset storage',
    preferences: 'Connections & language',
    maintenance: 'Diagnostics & data'
  },
  confirmation: {
    revokeTitle: 'Revoke host access?',
    clearDiagnosticsTitle: 'Clear diagnostics?',
    revokeDescription: 'Revoke {origin}; Chrome will ask again on next access.',
    clearDiagnosticsDescription: 'Clear {count} redacted diagnostics.',
    continue: 'Continue',
    clearDiagnosticsDetail: 'Clearing is irreversible; credentials and product drafts remain.',
    revokeDetail: 'Only the selected extra host is revoked; required TOP access remains.'
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
      'Latest 100: operation, requestId, duration, error code, traceId. No payloads, credentials or response bodies.',
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
      'Unlocking survives browser restarts and extension updates. No idle lock. Manual locking only hides sensitive information; background APIs continue working. Unlock to view or manage credentials. Legacy records without a local recovery key need their original passphrase once.',
    status: {
      loading: 'Loading',
      unlocked: 'Unlocked',
      legacy: 'Migration required',
      empty: 'Not created',
      invalid: 'Invalid format',
      locked: 'Locked'
    },
    legacyTitle: 'Legacy plaintext credentials found',
    legacyDescription:
      'Plaintext reads stopped. Set a passphrase for background encryption; old secrets and tokens never reach the page.',
    lockReason: {
      existing: 'Existing Open Platform credentials are still locked',
      manual: 'Open Platform credentials were locked manually'
    },
    lockDescription: {
      existing: 'Enter the original passphrase once to unlock existing credentials.',
      other:
        'This legacy record has no recoverable local key. Unlock once with the original passphrase to restore API access.',
      gatewayAvailable:
        'Background APIs and safe authorization summaries remain available. Unlock to view, configure, renew or back up sensitive credentials.'
    },
    passphrase: 'Protection passphrase',
    unlock: 'Unlock',
    invalidTitle: 'The local credential record is invalid',
    invalidDescription:
      'No automatic repair: it could overwrite data. Back up the browser profile, then use full clear in Logs → Diagnostics & data to rebuild.',
    lockNow: 'Lock now',
    rotateTitle: 'Change the local protection passphrase',
    rotateDescription: 'Re-encrypt with a new salt and key; no old passphrase needed.',
    newPassphrase: 'New protection passphrase',
    confirmNewPassphrase: 'Confirm new protection passphrase',
    setPassphrase: 'Set protection passphrase',
    saveHere: 'Save',
    passphraseSaved:
      'Passphrase saved. Next, import an authorization file or enter your platform credentials.',
    confirmPassphrase: 'Confirm protection passphrase',
    minimumCharacters: 'At least {count} characters',
    enterAgain: 'Enter again',
    rotate: 'Change passphrase',
    migrate: 'Encrypt and migrate legacy credentials',
    saveEncrypted: 'Credentials saved; this device stays unlocked.',
    savedToast: 'Credentials and settings saved',
    unlockedFeedback: 'Unlocked and remembered on this device.',
    migratedFeedback: 'Legacy credentials encrypted; this device stays unlocked.',
    lockedFeedback: 'Sensitive information hidden. Background API calls are unaffected.',
    rotatedFeedback: 'Re-encrypted with a new salt and passphrase.',
    statusError: 'Unable to read credential protection status',
    unlockError: 'Unable to unlock credentials',
    migrateError: 'Unable to encrypt legacy credentials',
    lockError: 'Unable to lock credentials',
    rotateError: 'Unable to change the protection passphrase',
    mismatchError: 'The two local protection passphrases do not match'
  },
  credentials: {
    title: 'Alibaba.com Open Platform credentials',
    guideTitle: 'Connect real APIs in three steps',
    guideDescription:
      'Use the IOP tool for new applications. TOP needs separate legacy-app credentials: import or enter them manually; the retired URL is never opened automatically. Configure both grants for automatic capability routing. Ensure they belong to the same merchant; store ownership is not verified by the system.',
    acquire: 'Get legacy TOP credentials',
    openCenter: 'Open new IOP Application Center',
    importBundle: 'Import authorization file',
    importLabel: 'Import credential bundle JSON',
    encryptedPlaceholder: 'Encrypted value saved; leave blank to keep it',
    gateway: 'HTTPS gateway',
    signMethod: 'Signature algorithm',
    saving: 'Saving…',
    save: 'Save settings',
    mockSavedFeedback: 'Demo settings were saved in this browser.',
    encryptedSavedFeedback: 'Settings re-encrypted and saved locally.',
    mockSavedToast: 'Demo settings saved',
    savedToast: 'Settings saved',
    saveError: 'Unable to save settings',
    bundleTooLarge: 'Credential bundle JSON cannot exceed 256 KiB',
    bundleLoaded: 'Bundle loaded, not saved. Set a protection passphrase and confirm save.',
    bundleImportError: 'Unable to import credential bundle',
    acquired: 'Credentials acquired and saved; this device stays unlocked.',
    bundleMissing: 'The credential bundle is missing an App Key, App Secret, or Access Token',
    iopTool: 'IOP authorization and renewal'
  },
  security: {
    title: 'Security boundary',
    description:
      'This profile stores the unlock key: anyone copying it may decrypt credentials. Lock before sharing this device. For stronger protection, use your own BFF.'
  },
  socialBackend: {
    title: 'Social publishing backend',
    description: 'Pair your oneVegetable backend to publish via official Facebook / Instagram APIs.',
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
    authorizationExpires: 'Expires: {time}. Token stays in trusted extension storage; never displayed.',
    expiredTitle: 'Device authorization expired',
    expiredDescription:
      'Expired after 30 days or revoked by an admin. Pair again for a new token; old tokens stay invalid.',
    pairAgain: 'Pair again',
    startPairing: 'Start pairing',
    checkApproval: 'Check approval',
    checkConnection: 'Check connection',
    disconnect: 'Disconnect',
    disconnectTitle: 'Disconnect the social publishing backend?',
    disconnectDescription:
      'Removes the extension token. For immediate server revocation, also revoke the device in backend Administration.',
    disconnectConfirm: 'Disconnect'
  },
  ...{
    s3: {
      localHttp:
        'HTTP is unencrypted: trusted LAN, private IPv4 and path-style only. Local Node requires opt-in; cloud Workers do not support it.',
      title: 'S3 asset storage',
      extensionDescription:
        'Direct S3: local encryption, background signing, no extra password; cannot protect a compromised browser. Save requests storage-host access only. Keep the workbench open during transfers; check interrupted results before retrying. No automatic resume.',
      description:
        'Connect S3-compatible object storage for asset imports, exports, and backups. Secrets are encrypted by the backend.',
      configured: 'Configured',
      notConfigured: 'Not configured',
      unsupported: 'Server-side S3 configuration is unavailable in this runtime.',
      endpoint: 'Endpoint',
      region: 'Region',
      bucket: 'Bucket',
      accessKey: 'Access Key ID',
      secretKey: 'Secret Access Key',
      sessionToken: 'Session Token (optional)',
      rootPrefix: 'Asset root prefix',
      pathStyle: 'Use path-style addressing (usually required by Cloudflare R2 and MinIO)',
      secretHint:
        'Access Key ending in {suffix} is saved. Enter the full credentials again when changing settings.',
      save: 'Save encrypted',
      test: 'Test connection',
      clear: 'Clear configuration',
      clearTitle: 'Clear S3 configuration?',
      clearDescription:
        'This deletes encrypted S3 credentials from the current runtime. Objects in the bucket are not deleted.',
      saved: 'S3 configuration saved encrypted.',
      cleared: 'S3 configuration cleared.',
      testPassed: 'S3 connection is healthy. The probe found {count} object.',
      errors: {
        save: 'Unable to save the S3 configuration',
        test: 'S3 connection test failed',
        clear: 'Unable to clear the S3 configuration'
      },
      rules: {
        title: 'Automatic import rules',
        description:
          'First matching S3 path rule selects the image group; import can create missing groups. Rules stay local.',
        add: 'Add rule',
        newRule: 'New rule',
        enabled: 'Enabled',
        remove: 'Remove rule',
        conflict: 'Name conflicts',
        rename: 'Rename automatically',
        skip: 'Skip',
        name: 'Rule name',
        sourcePrefix: 'Source prefix',
        include: 'Include glob',
        exclude: 'Exclude globs (comma-separated)',
        targetGroup: 'Target image group path',
        empty: 'No rules. S3 assets will not enter the import queue until a rule is added.',
        save: 'Save import rules',
        saved: 'Image S3 import rules saved locally.',
        invalid: 'Image import rules are invalid'
      }
    }
  },
  alibabaLanguage: {
    title: 'Alibaba API language',
    description:
      'For Schema, official guidance and requests supporting language; not the interface language.',
    interfaceHint: 'Interface language: “中 / EN” at top right.',
    label: 'Platform request language',
    chinese: 'Simplified Chinese (zh_CN)',
    english: 'English (en_US)',
    saved: 'Alibaba API language saved as {language}.'
  },
  permissions: {
    title: 'Host access',
    description: 'TOP access is required. This list shows only extra hosts authorized on demand.',
    empty: 'No additional hosts are currently authorized.',
    revoke: 'Revoke',
    revokeLabel: 'Revoke {origin}',
    refresh: 'Refresh access',
    loadError: 'Unable to load host access',
    revokeError: 'Unable to revoke host access',
    revoked: 'Revoked {origin}. Access will be requested again when needed.',
    notGranted: '{origin} is not currently authorized.'
  },
  extensionRuntime: {
    permissionPurposes: {
      socialBackend: 'social publishing backend',
      customGateway: 'custom gateway',
      credentialAcquisition: 'Alibaba credential acquisition',
      oauthCallback: 'OAuth Callback',
      productZipAsset: 'product ZIP image download',
      externalPhoto: 'external image source'
    },
    errors: {
      callbackStateExpired: 'The Callback confirmation state expired. Refresh the task status.',
      acquisitionRequestMismatch: 'The credential acquisition response requestId does not match.',
      vaultRequestMismatch: 'The credential protection response requestId does not match.',
      runtimeRequestMismatch: 'The extension background response requestId does not match.',
      productMutationSnapshotMissing: 'The product update job is missing its category or language snapshot.',
      invalidHostProtocol: '{purpose} only supports HTTP(S) addresses.',
      permissionDeniedHost: 'Access to {host} for {purpose} was not granted.',
      permissionDeniedPurpose: 'The exact site access required for {purpose} was not granted.',
      socialPairingRequired: 'Pair the social publishing backend in Settings first.',
      socialBackendRequired: 'Configure and pair the social publishing backend first.',
      socialHttps: 'The social publishing backend must use HTTPS. localhost may use HTTP.',
      socialUrlStructure:
        'The social publishing backend URL cannot contain a path, credentials, query, or fragment.'
    },
    localData: {
      credentials: {
        label: 'Encrypted Open Platform credentials and gateway settings',
        retention: 'Until replaced, data cleared or uninstalled'
      },
      productMutationJobs: {
        label: 'Local product mutation jobs',
        retention: 'Incomplete: until verified/recovered. Completed: max 30 days, 100 entries'
      },
      socialBackendDevice: {
        label: 'Social publishing backend device authorization',
        retention: 'Until disconnected, data cleared, expired or uninstalled'
      },
      drafts: {
        label: 'Local product and RFQ drafts',
        retention: 'Until deleted, data cleared or uninstalled'
      },
      diagnostics: {
        label: 'Redacted session diagnostics',
        retention: 'Current browser session only, up to 100 entries'
      },
      preferences: {
        label: 'First-use state and interface preferences',
        retention: 'Until data cleared or uninstalled'
      }
    }
  },
  localData: {
    title: 'Local data and privacy',
    description: 'Categories and estimated sizes only; no secrets, tokens, draft or diagnostic content.',
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
    exported: 'Inventory exported; no stored values.',
    loadError: 'Unable to load the local data inventory',
    dangerTitle: 'Clear all extension local data',
    dangerDescription:
      'Irreversible. Enter “{phrase}” to delete credentials, settings, drafts, diagnostics, first-use status and extra host access.',
    clearLabel: 'Clear confirmation phrase',
    clearPhrase: 'clear all data',
    clear: 'Clear everything',
    cleared: 'Local data and extra access cleared. Reload to see the first-use notice.',
    clearError: 'Unable to clear extension local data'
  }
} as const;
