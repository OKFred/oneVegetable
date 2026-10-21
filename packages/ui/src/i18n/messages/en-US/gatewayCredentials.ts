export const gatewayCredentials = {
  topReauthorize: 'Reauthorize',
  topReauthorizeHelp:
    'Enter legacy app details or read them from a backup, then approve on Alibaba. The old token is not reused.',
  topImport: 'Import existing authorization',
  topImportHelp: 'Import complete TOP authorization JSON and save it without starting online authorization.',
  topIopRecommendation: 'New users without a legacy TOP app should use IOP. IOP keys cannot be used for TOP.',
  title: 'Alibaba credentials',
  dualTitle: 'TOP + IOP authorizations',
  acquireCredentials: 'Connect Alibaba account',
  authorizationWizard: 'Authorization guide',
  quickSetup: 'Quick setup',
  defaultAction: 'Default',
  configureAction: 'Configure',
  clearAction: 'Clear',
  onlineBackup: 'Back up online authorization',
  onlineBackupHelp:
    'Exports only a complete authorization-tool bundle matching this configuration. For manually entered details or a missing bundle, use the original file or authorize again before backing up.',
  onlineBackupTitle: 'Download an authorization file with plaintext secrets?',
  onlineBackupWarning:
    'credentialInfo.json contains plaintext App Secret, Access Token and other secrets. Store it securely and never publish or share it. This does not authorize again or call platform APIs.',
  onlineBackupConfirm: 'Download authorization file',
  onlineBackupDownloadStarted: 'Authorization download started. Keep the file secure.',
  onlineBackupFailed:
    'Authorization backup failed. Review the error details or use the original authorization file.',
  profileCleared: 'Local {protocol} authorization cleared. You can reconnect or import it again.',
  wizardContinue: 'Continue setup',
  wizardBack: 'Back',
  protectionReady:
    'Local protection is ready. Reviewing this step does not change or clear your existing passphrase or authorizations. You can continue directly.',
  chooseAcquireProtocol: 'Connect your Alibaba account',
  chooseMethodDescription:
    'Choose how to connect. File import opens no Alibaba page. IOP needs permission for its business API.',
  offlineMethod: 'Import an existing authorization file',
  offlineMethodHelp:
    'Use one authorization object, or a JSON array with one TOP and one IOP bundle. Protocols are detected automatically.',
  onlineMethod: 'Get a new authorization online',
  onlineMethodHelp: 'Choose a modern or legacy app, then sign in and approve on Alibaba.',
  offlineChooseFile: 'Choose an authorization JSON file',
  offlineReplaceHelp:
    'Confirm to save all included profiles together. Profiles not in this file stay unchanged. This validates the file, not provider expiry or permissions.',
  offlineImportSave: 'Import and save',
  offlineInvalid:
    'Invalid file. Use a complete object or array up to 256 KiB, with at most one TOP and one IOP bundle.',
  offlineDuplicate: 'A file may contain only one TOP and one IOP bundle. Duplicate protocols are not saved.',
  offlineFailed:
    'Import did not complete. Check local protection and host permission, then try again. Online authorization was not started.',
  offlineSaved: 'Authorization file imported and saved.',
  methodBack: 'Back to connection methods',
  chooseRenewProtocol: 'Which authorization do you want to renew?',
  chooseProtocolDescription:
    'New here? Start with a new app. Have a legacy app or authorization file? Choose legacy. Both are saved separately and never replace each other.',
  chooseProtocolIop: 'Connect a new app',
  chooseProtocolIopHelp:
    'Features are being added gradually. Please follow the platform’s official development updates.',
  chooseProtocolTop: 'Connect a legacy app',
  chooseProtocolTopHelp:
    'TOP offers more mature support for existing features, for users with a legacy TOP app only.',
  protocolToolUnavailable:
    'This version has no authorization tool for this protocol. Update the extension or import its credential bundle.',
  authorizationToolFailed: 'Could not open the authorization tool. Please try again.',
  protectionDescription: 'Prepare local protection, then choose file import or online authorization.',
  protectionOptional: 'Local protection passphrase (optional)',
  protectionPlaceholder: 'Leave blank, or enter at least 6 characters',
  protectionDeviceHelp:
    'Leaving it blank uses a key stored in this browser profile. Anyone with this profile may unlock it; this does not protect a compromised or shared device. You can set a passphrase later in Settings.',
  protectionOriginal: 'Original protection passphrase',
  protectionOriginalHelp:
    'This vault is locked. Enter its original passphrase; existing credentials will not be replaced.',
  protectionContinue: 'Continue',
  protectionFailed:
    'Could not prepare local protection. Check the original passphrase if locked, then try again. Nothing was replaced.',
  protectionSaved: 'Local protection saved. You can now import or enter authorization credentials.',
  protectionDeviceStatus: 'Device-local protection (no passphrase)',
  protectionBundleLoaded:
    'Bundle loaded, not saved. Confirm save; a local protection passphrase is optional for a new vault.',
  automaticRouting: 'Capability-based routing is enabled automatically',
  singleRouting: 'Using the {protocol} authorization',
  routingOwnership:
    'Both grants should belong to the same merchant; the system does not verify store ownership for you.',
  dualDescription:
    'Start with the app you already have. If the same merchant has both new and legacy apps, connect both to access more features.',
  profileTop: 'TOP authorization (legacy)',
  profileIop: 'IOP authorization (new)',
  profileHelpTop:
    'Use a complete legacy TOP credential set. Get it with the authorization tool, import it, or enter it manually; a new IOP app cannot replace it.',
  profileHelpIop:
    'Apps at i.alibaba.com/explore/open-api use IOP. Authorize with the IOP tool, export JSON, then import it into this profile.',
  selectProfile: 'Select the authorization profile to configure',
  configureProfile: 'Configure {protocol}',
  updateProfile: 'Update {protocol}',
  configurationTitle: '{protocol} authorization settings',
  configurationDescription:
    'These actions apply only to {protocol}; the other authorization is unchanged. Import a file or enter credentials, then test the connection.',
  closeConfiguration: 'Done',
  importActions: 'Configure and update',
  connectionActions: 'Check connection and renew',
  setDefault: 'Set as default',
  defaultSelected: 'Selected',
  defaultSaved:
    '{protocol} is now the saved default. Both authorizations still use capability-based routing.',
  defaultAlreadySelected: '{protocol} is already the default authorization.',
  selectedProfile: 'Editing {protocol} authorization',
  profileSelected:
    'Switched to {protocol} settings. Import or enter credentials below; the default protocol is unchanged.',
  profileAlreadySelected: 'Already configuring {protocol}. Import or enter credentials below.',
  profileIsolation: 'Import, save, test, renew and clear apply only to this profile. No automatic renewal.',
  profileMismatch:
    'This JSON belongs to the other protocol. Select its profile first, then import again. Nothing was changed.',
  profileConfirmBody:
    'Replace only {protocol} for all users of this server. The other profile is preserved. No Alibaba products are changed.',
  profileClearBody:
    'Clear only {protocol}; the other profile remains configured. This does not revoke the platform grant.',
  extensionProfileClearBody:
    'Clear {protocol} from this workbench and the local authorization tool. The other authorization and other local data are kept. You can reconnect or import later; the Alibaba platform grant is not revoked.',
  bindingConfirmed: 'User confirmed the same merchant; capability routing enabled',
  bindingRequired: 'Same-merchant confirmation required for automatic capability routing',
  bindingNeedsBoth:
    'Configure both profiles before confirming. A single authorization can still be used on its own.',
  bindingNeedsManaged:
    'A startup file or environment profile has no stable configuration ID. Import managed authorization JSON for each profile first, then confirm the pair.',
  unconfirmedRouting:
    'Until confirmed, requests keep the legacy default ({protocol}); automatic capability routing is not enabled.',
  sameMerchant: 'I confirm that both TOP and IOP authorizations belong to the same merchant.',
  confirmBinding: 'Confirm and enable capability routing',
  bindingDisclaimer:
    'This is your confirmation, not official platform verification. Replacing or clearing either profile requires confirmation again.',
  bindingTime: 'User confirmed at {time}',
  routingPolicy:
    'With both profiles configured, verified supported requests automatically prefer IOP; other supported requests use TOP. Unsupported operations stay blocked. Uncertain writes are never retried through the other protocol.',
  protocol: 'Gateway protocol',
  protocolTop: 'TOP (default)',
  protocolIop: 'IOP (explicit choice)',
  iopCompatibility:
    'IOP supports mapped reads and verified Schema publish, draft and update. Other methods open individually; failed IOP calls are never retried through TOP.',
  acquireTop: 'Get TOP Open Platform credentials',
  acquireIop: 'Open independent IOP authorization tool',
  extensionGuideIop:
    'Choose Connect Alibaba account, then a new app. Approve on Alibaba, download the authorization file, then import and save it here.',
  extensionGuideTop:
    'Choose Connect Alibaba account, then an existing legacy app. Follow the steps, download the file, then import and save it here. You can also import an existing legacy file.',
  renewGuideIop:
    'If renewal fails, choose Connect Alibaba account and a new app, authorize again and import the new file. Legacy access is preserved.',
  expiryunknown: 'Expiry unknown; this does not mean permanent access',
  expiryvalid: 'Within the recorded authorization period',
  expiryexpiring: 'Authorization expires within 7 days; prepare to renew',
  expiryexpired: 'Authorization expired; renew or reconnect',
  expiryinvalid: 'Authorization invalid or refresh failed; reconnect',
  remainingdays: 'About {count} days left',
  remaininghours: 'About {count} hours left',
  remainingminutes: 'About {count} minutes left',
  refreshWindow: 'Refresh may be attempted; the platform can still refuse',
  expiryHelp:
    'Access may be revoked early. Try refreshing, or reauthorize and import. No workbench sign-out is needed.',
  extensionRenew:
    'The extension does not auto-renew. When access expires or fails, choose Connect Alibaba account and your original new or legacy app, authorize again, then import and save. Keep your existing vault.',
  description:
    'All users of this server share these credentials. Use OpenAPI credentials, not your Alibaba website login.',
  adminOnly: 'Only administrators can manage Alibaba credentials.',
  unavailable: 'Credential management is unavailable. Configure the server encryption key and restart once.',
  configured: 'Configured (connection not yet verified)',
  empty: 'Not configured',
  source: 'Active source',
  application: 'Application name',
  key: 'AppKey suffix',
  expires: 'Access Token expires',
  refreshExpires: 'Refresh Token expires',
  unknown: 'Unknown',
  import: 'Import authorization JSON',
  manual: 'Enter manually',
  test: 'Test connection',
  refresh: 'Refresh Token',
  renew: 'Renew authorization',
  renewProtocolTitle: 'Renew {protocol} authorization',
  authorizationRemaining: 'Authorization remaining',
  compactdays: '{count} days',
  compacthours: '{count} hr',
  compactminutes: '{count} min',
  compactExpired: 'Expired',
  permissionactive: 'No expiry returned; check renewal',
  permissioninactive: 'System API inactive; check renewal',
  'permissionnot-recorded': 'System API not recorded; check renewal',
  permissionunknown: 'Permissions unconfirmed; check renewal',
  permissionSnapshot: 'Permission snapshot: {time}; not live',
  systemApiHelp:
    'System API ≠ SystemAPI; it cannot reveal old token expiry. Do not mix TOP/IOP credentials or tools.',
  unlockForExpiry: 'Unlock to view expiry',
  expiryReadFailed: 'Cannot read authorization; check settings',
  renewDescription: 'Renew API access without signing out or replaying product operations.',
  refreshAvailable:
    'Try extending access. If Alibaba declines, authorize again; no automatic retry will be made.',
  renewSettings: 'Credential settings',
  clear: 'Clear configuration',
  reload: 'Refresh status',
  noRefresh:
    'This authorization cannot be renewed directly right now. Approve again on Alibaba and import the new file.',
  renewTitle: 'How do I reconnect after authorization fails?',
  renewGuide:
    'A legacy app may not support direct renewal. If rejected, choose Connect Alibaba account and your existing legacy app, authorize again and import the new file. New app access cannot replace it.',
  legacy:
    'Startup file/environment. Saving switches to encrypted configuration; clearing never restores the old account.',
  save: 'Save and activate',
  cancel: 'Cancel',
  advanced: 'Advanced options',
  required:
    'AppKey, AppSecret and Access Token are required. Supply a complete set; old tokens are never reused.',
  optional: 'Optional',
  remark: 'Remark (no secrets)',
  confirmSave: 'Replace server credentials?',
  confirmClear: 'Clear server credentials?',
  confirmLocalClear: 'Clear this local authorization?',
  confirmBody:
    'This affects all users of this Node/BFF server. Old account queries become stale and transfers need review. Alibaba products will not be changed.',
  clearBody:
    'Real calls will stop. Old files or environment variables will not be used again. Alibaba authorization itself is not revoked.',
  saved: 'Credentials encrypted and activated. Test the connection next.',
  cleared: 'Configuration cleared; real calls stopped',
  refreshed: 'Token refreshed',
  refreshFailed: 'Renewal failed; test connection or reauthorize',
  error: 'Credential operation failed. Review the error and retry.',
  invalid: 'Check required fields, dates and authorization JSON format (maximum 1 MiB).',
  testNotice:
    'Reads one product without changing data. Success only verifies the product list endpoint, not permissions for every API.',
  notReal: 'The real gateway is disabled in this environment; a real connection test cannot run.',
  passed: 'Connection verified',
  'no-data': 'Connection verified; no products returned',
  'permission-denied': 'This application or account lacks permission for this endpoint',
  'credentials-invalid': 'Credentials invalid, expired or missing',
  'network-error': 'Gateway or network request failed',
  'contract-drift': 'Response does not match the contract',
  lastTest: 'Latest connection test',
  notTested: 'Not tested',
  refreshedAt: 'Last token refresh',
  refreshError: 'Refresh error',
  'sqlite-vault': 'Encrypted SQLite configuration',
  'd1-vault': 'Encrypted D1 configuration',
  environment: 'Environment variables',
  'credential-bundle': 'Local authorization file',
  'documentation-replay': 'Documentation replay',
  manageLink: 'Manage Alibaba credentials',
  filePreview: 'Validated file: {name}',
  changes: 'Server credentials changed. Old account tasks are paused; reload your data.'
};
