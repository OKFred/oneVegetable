export const capabilities = {
  title: 'API capabilities',
  description:
    'Free catalog totals come from the audit snapshot. Article-only Schema publishing APIs are listed separately and excluded from the free API count.',
  catalogCount: 'Catalog {count}',
  articleCount: 'Articles {count}',
  sources: { catalog: 'API catalog', article: 'Documentation article' },
  businessScopes: { general: 'General business', conditional: 'Requires business qualifications' },
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
    '{snapshot} Integration and documentation do not prove account permission. The current-environment column shows the data source and call guard, not a successful live verification. API failures are reported; successful results are never fabricated.',
  noMatch: 'No matching APIs',
  clearFilters: 'Clear filters',
  viewApi: 'View API {method}',
  detailsTitle: 'API capability details',
  detailsDescription: 'Capability definition, call parameters, and response',
  checkedAndUpdated: 'Checked {checked} · Docs updated {updated}',
  unknown: 'Unknown',
  documentVerification: 'Docs: {verification}',
  matrixNames: {
    contract: 'Integration / contract',
    documentation: 'Documentation evidence',
    replay: 'Replay',
    account: 'Account snapshot',
    current: 'Current environment'
  },
  deprecatedNotice:
    'This API is deprecated. Retained read calls remain available when the other guards allow them; deprecation is a warning, not proof of current support or permission.',
  unlistedNotice:
    'This API is unlisted. Check its documentation and business scope; lifecycle status does not grant call permission.',
  metadata: {
    title: 'Permission and business metadata',
    permissionGroups: 'Documented permission groups',
    businessScope: 'Business scope',
    notice:
      'Catalog metadata only. These groups and scopes do not indicate permissions granted to the current account.'
  },
  restrictedFallback: 'This capability requires a dedicated business context.',
  requestSchema: 'request: {schema}',
  responseSchema: 'response: {schema}',
  responseExample: 'Documented response example',
  documentedErrors: 'Documented error codes',
  exampleNotice: 'Documentation only, not a call result or evidence of account authorization.',
  readonlyExample: 'Read-only documented parameter example',
  parameters: 'Call parameters JSON',
  driftTitle: 'Response contract drift · traceId {traceId}',
  driftRaw: 'The raw response remains below for diagnosis with the traceId.',
  call: 'Call capability',
  disabled: {
    select: 'Select an API capability first',
    restricted: 'This capability requires dedicated business eligibility or context',
    unavailable: 'This capability is not enabled',
    catalogFailed: 'The capability catalog failed to load; retry before calling',
    running: 'The capability call is running',
    definitionFailed: 'Capability definition failed to load: {error}',
    definitionLoading: 'Capability definition is loading'
  },
  errors: {
    select: 'Select an API',
    validJson: 'Parameters must be valid JSON',
    jsonObject: 'Parameters must be a JSON object',
    invalidParameters: 'Invalid parameter format',
    definitionFailed: 'Capability definition failed to load',
    definitionMismatch: 'The returned capability definition does not match the selected API'
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
    contract: 'Integration',
    documentation: 'Documentation',
    replay: 'Replay',
    account: 'Account snapshot',
    current: 'Current environment',
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
    documentation: {
      documented: [
        'Documented',
        'Platform documentation is recorded. This does not prove integration, account authorization, or live-call success.'
      ],
      accountRecorded: [
        'Verification recorded',
        'The catalog records historical account verification. See the account snapshot for its result and date; this is not verification of the current environment.'
      ]
    },
    replay: {
      covered: [
        'Replay candidate',
        'This active, integrated, read-only method is eligible for documentation replay. Eligibility is not evidence of a successful live call.'
      ],
      ineligible: [
        'Not applicable',
        'This method is not an active, read-only, real-call-enabled Replay candidate.'
      ]
    },
    account: {
      passed: ['Account passed', 'Historical account verification returned valid data.'],
      noData: [
        'Valid empty result',
        'Historical account verification succeeded, but the account had no data at the time.'
      ],
      denied: ['Permission denied', 'Historical account verification was denied by platform permissions.'],
      drift: [
        'Contract drift',
        'The historical account-verification response did not match the current contract.'
      ],
      provider: [
        'Provider error',
        'Historical account verification encountered a platform or network error.'
      ],
      prerequisite: [
        'Missing prerequisite',
        'Historical account verification lacked prerequisite data for the call.'
      ],
      notTested: ['Not tested', 'This method is absent from the redacted account verification snapshot.']
    },
    current: {
      unavailable: [
        'Calls disabled',
        'Calls are not enabled for this method; registered contracts and examples remain viewable.'
      ],
      restricted: ['Restricted', 'This method requires additional business eligibility or context.'],
      mutationClosed: [
        'Writes disabled',
        'The generic debugger is read-only in Web BFF and the extension. Only explicit mock mode may run write examples.'
      ],
      realClosed: [
        'Real calls disabled',
        'Real calls for this capability are disabled in Web BFF and the extension. Only explicit mock mode may run its example.'
      ],
      replayReadOnly: ['Replay is read-only', 'Documentation replay does not allow write calls.'],
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
