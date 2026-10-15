export const gatewayCredentials = {
  title: 'Alibaba credentials',
  dualTitle: 'TOP + IOP authorizations',
  acquireCredentials: 'Get credentials',
  chooseAcquireProtocol: 'Choose an authorization to acquire',
  chooseRenewProtocol: 'Choose an authorization to renew',
  chooseProtocolDescription:
    'IOP and legacy TOP are authorized and stored separately. Their credentials cannot be mixed. Choose one to begin.',
  chooseProtocolIop: 'New IOP (recommended)',
  chooseProtocolIopHelp: 'For new Open Platform applications, with authorization and renewal support.',
  chooseProtocolTop: 'Legacy TOP',
  chooseProtocolTopHelp:
    'For existing legacy TOP applications. Your original authorization remains supported.',
  protocolToolUnavailable:
    'This version has no authorization tool for this protocol. Update the extension or import its credential bundle.',
  authorizationToolFailed: 'Could not open the authorization tool. Please try again.',
  automaticRouting: 'Capability-based routing is enabled automatically',
  singleRouting: 'Using the {protocol} authorization',
  routingOwnership:
    'Both grants should belong to the same merchant; the system does not verify store ownership for you.',
  dualDescription:
    'Merchants with both app types should authorize TOP and IOP for broader capability coverage. Each grant is stored separately and never replaces the other; a single app type is still supported.',
  profileTop: 'TOP authorization (legacy)',
  profileIop: 'IOP authorization (new)',
  profileHelpTop:
    'Use a complete legacy TOP credential set. Get it with the authorization tool, import it, or enter it manually; a new IOP app cannot replace it.',
  profileHelpIop:
    'Apps at i.alibaba.com/explore/open-api use IOP. Authorize with the IOP tool, export JSON, then import it into this profile.',
  selectProfile: 'Select the authorization profile to configure',
  configureProfile: 'Configure {protocol}',
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
    'Choose new IOP under Get credentials. The tool tries the new Application Center and starts authorization; you can also paste a complete authorization JSON bundle in its advanced settings. Export JSON, then import and save it here. TOP is preserved.',
  extensionGuideTop:
    'Choose legacy TOP under Get credentials. The tool tries an already-open legacy app page and reports unreadable details without opening a retired URL. You can also paste a complete authorization JSON bundle in its advanced settings. IOP is preserved.',
  renewGuideIop:
    'Try refreshing the IOP token first. If unavailable or rejected, choose new IOP under Get credentials to reauthorize, then import and save the complete authorization JSON bundle. TOP credentials cannot renew IOP.',
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
    'The extension does not auto-renew. Under Get credentials, choose the matching TOP or IOP authorization and save it again when expiry approaches or access fails. Keep your existing vault.',
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
  refreshAvailable: 'Try Refresh Token; if rejected, reconnect in settings.',
  renewSettings: 'Credential settings',
  clear: 'Clear configuration',
  reload: 'Refresh status',
  noRefresh: 'Refresh unavailable. Reauthorize and import.',
  renewTitle: 'How do I reconnect after authorization fails?',
  renewGuide:
    'Try refreshing the TOP token first. If unavailable or rejected, choose legacy TOP under Get credentials to reauthorize, then import and save the complete authorization JSON bundle. IOP credentials cannot renew TOP.',
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
