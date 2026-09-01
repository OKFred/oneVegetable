export const capabilities = {
  title: 'API capabilities',
  description:
    'Free catalog totals come from the audit snapshot. Article-only Schema publishing APIs are listed separately and excluded from the free API count.',
  catalogCount: 'Catalog {count}',
  articleCount: 'Articles {count}',
  search: 'Search API methods',
  allDomains: 'All domains',
  accountSnapshot: 'Account verification snapshot',
  allAccountResults: 'All account results',
  accountStatuses: {
    passed: 'Account passed',
    noData: 'Valid empty result',
    permissionDenied: 'Permission denied',
    contractDrift: 'Contract drift',
    providerError: 'Provider error',
    skippedPrerequisite: 'Missing prerequisite',
    notTested: 'Not tested'
  },
  accountSummary: {
    passed: 'Passed/empty {count}',
    denied: 'Denied {count}',
    notTested: 'Not tested {count}',
    current: 'Current: {source}'
  },
  snapshotExtension:
    'Extension packages do not include historical account verification results. Use Web + BFF mode to view the redacted snapshot.',
  snapshotChecked:
    'The account snapshot was checked on {date}. It represents the credentials used then, not the credentials currently configured.',
  snapshotMissing: 'No account snapshot has been generated.',
  runtimeNotice:
    '{snapshot} The current-runtime column shows the app data source and call guard. Actual permission is determined by each live call.',
  noMatch: 'No matching APIs',
  clearFilters: 'Clear filters',
  viewApi: 'View API {method}',
  detailsTitle: 'API capability details',
  detailsDescription: 'Capability definition, call parameters, and response',
  checkedAndUpdated: 'Checked {checked} · Docs updated {updated}',
  unknown: 'Unknown',
  documentVerification: 'Docs: {verification}',
  matrixNames: {
    contract: 'Contract',
    replay: 'Replay',
    account: 'Account snapshot',
    current: 'Current runtime'
  },
  deprecatedNotice:
    'This API is deprecated. Typed compatibility remains only in the generic debugger, and the dedicated product UI does not call it.',
  realWriteBlocked:
    'This real write capability is not enabled in the current extension. It will be rejected before any network call.',
  restrictedFallback: 'This capability requires a dedicated business context.',
  requestSchema: 'request: {schema}',
  responseSchema: 'response: {schema}',
  readonlyExample: 'Read-only documented parameter example',
  parameters: 'Call parameters JSON',
  driftTitle: 'Response contract drift · traceId {traceId}',
  driftRaw: 'The raw response remains below for diagnosis with the traceId.',
  call: 'Call capability',
  disabled: {
    select: 'Select an API capability first',
    restricted: 'This capability requires dedicated business eligibility or context',
    unavailable: 'This capability is not enabled',
    extensionWrite: 'This real write capability is not enabled in the current extension',
    running: 'The capability call is running',
    definitionFailed: 'Capability definition failed to load: {error}',
    definitionLoading: 'Capability definition is loading'
  },
  errors: {
    select: 'Select an API',
    validJson: 'Parameters must be valid JSON',
    jsonObject: 'Parameters must be a JSON object',
    invalidParameters: 'Invalid parameter format',
    definitionFailed: 'Capability definition failed to load'
  },
  notices: {
    urlUpload:
      'This API returns a regular file URL but no gallery fileId, so it is not used for product main images, SKU images, or description images.',
    riskSend:
      'This is a Tianlu risk-control protocol capability. The app does not collect WUA, UMID, IMEI, IMSI, MAC, or similar device-environment data and does not expose a send action.',
    taskNotify:
      'This is a status callback for URL crawling providers, not a seller action. Calls are blocked without a real task context issued by the platform.'
  },
  columns: {
    method: 'API method',
    domain: 'Domain',
    lifecycle: 'Lifecycle',
    risk: 'Risk',
    contract: 'Contract',
    replay: 'Replay',
    account: 'Account snapshot',
    current: 'Current runtime',
    docs: 'Docs'
  },
  lifecycle: { active: 'Active', deprecated: 'Deprecated', unlisted: 'Unlisted' },
  risk: { mutation: 'Write', read: 'Read-only' },
  matrix: {
    contract: {
      unavailable: ['Not integrated', 'This method is not in the callable contract.'],
      incomplete: ['Incomplete contract', 'The request or response Schema is missing.'],
      typed: ['Typed', 'Request and response Schemas and generated types are registered.']
    },
    replay: {
      covered: [
        'Covered by CI',
        'Documented Replay examples pass the current request and response contracts.'
      ],
      ineligible: [
        'Not applicable',
        'This method is not an active, read-only, real-call-enabled Replay candidate.'
      ]
    },
    account: {
      passed: ['Account passed', 'Historical smoke returned valid data.'],
      noData: ['Valid empty result', 'Historical smoke succeeded, but the account had no data at the time.'],
      denied: ['Permission denied', 'Historical smoke was denied by platform permissions.'],
      drift: ['Contract drift', 'The historical smoke response did not match the current contract.'],
      provider: ['Provider error', 'Historical smoke encountered a platform or network error.'],
      prerequisite: ['Missing prerequisite', 'Historical smoke lacked real prerequisite data for the call.'],
      notTested: ['Not tested', 'This method is absent from the redacted account verification snapshot.']
    },
    current: {
      unavailable: ['Not integrated', 'The current app has no callable contract for this method.'],
      restricted: ['Restricted', 'This method requires additional business eligibility or context.'],
      mutationClosed: ['Writes disabled', 'The real-write feature flag is disabled.'],
      realClosed: ['Real calls disabled', 'This method cannot use the real gateway.'],
      mock: 'Mock data',
      replay: 'Replay data',
      real: [
        'Live entry enabled',
        'The current BFF uses the live Alibaba gateway. Individual calls may still be denied by account permissions.'
      ],
      extension: [
        'Extension entry enabled',
        'Calls originate in the extension service worker. Success depends on local credentials and platform permissions.'
      ],
      unavailableGateway: 'Gateway unavailable',
      detecting: 'Detecting source'
    },
    reasonCode: 'Reason code: {code}',
    checkedAt: 'Checked: {time}'
  }
} as const;
