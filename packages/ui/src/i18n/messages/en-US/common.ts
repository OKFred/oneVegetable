export const common = {
  platformReadback: {
    inventory:
      'Inventory synchronization may be delayed, so queries can temporarily show the old quantity. Refresh later to check; do not repeat a stock adjustment for this reason.',
    accepted:
      'The platform accepted the request. Processing or synchronization may take time; the final result is not confirmed yet. Check the status later. Do not submit again.',
    unconfirmed:
      'The result is unconfirmed. This may be a synchronization delay or an error. Check the result; do not submit again. If it remains inconsistent, keep the requestId and verify on the official platform.'
  },
  fields: {
    keywords: 'Keywords',
    categoryId: 'Category ID',
    groupId: 'Group ID',
    createdAt: 'Created',
    ownerName: 'Owner',
    productType: 'Product type',
    language: 'Product language',
    model: 'Model',
    isRts: 'RTS',
    isSpecific: 'Specific product',
    smartEdit: 'Smart editing',
    imageCount: 'Main image count',
    watermark: 'Watermark',
    platformStatus: 'Platform review status',
    encryptedId: 'Obfuscated ID',
    originalName: 'Original filename',
    url: 'Original image URL',
    groupPath: 'Group path',
    currency: 'Currency',
    paidAmount: 'Paid amount',
    paymentStatus: 'Payment status',
    logisticsStatus: 'Logistics status',
    carrier: 'First shipment carrier',
    trackingNumber: 'First shipment tracking number',
    scoreIssues: 'Score issue count',
    yes: 'Yes',
    no: 'No'
  },
  columns: {
    all: 'Select all optional columns',
    moveUp: 'Move {name} up',
    moveDown: 'Move {name} down',
    persistenceFailed: 'Preferences could not be saved. Changes apply to this page only.',
    title: 'Columns',
    search: 'Search columns',
    reset: 'Reset defaults',
    selection: 'Selection',
    load: 'Load page details',
    resume: 'Continue querying',
    pending: 'Not queried',
    loading: 'Loading',
    failed: 'Query failed',
    denied: 'No permission',
    stop: 'Stop',
    retry: 'Retry failed',
    progress: '{done}/{total}',
    result: 'Queries complete: {success} succeeded, {failed} failed',
    requests: '{count} rows on this page',
    aggregate: 'Funds and logistics per order',
    missing: 'Not returned'
  },
  actions: {
    title: 'Actions',
    row: 'Actions for {name}',
    copyId: 'Copy identifier',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    save: 'Save',
    loading: 'Loading…',
    retry: 'Reload',
    processing: 'Processing…',
    copied: 'Copied',
    refresh: 'Refresh'
  },
  data: {
    selected: '{count} selected',
    selectPage: 'Select this page',
    selectRow: 'Select {name}',
    empty: 'No data'
  },
  sidebar: {
    expand: 'Expand {title}',
    collapse: 'Collapse {title}'
  },
  pagination: {
    unknown: 'Total unknown',
    unknownPage: 'Page {current}',
    label: 'Table pagination',
    summary: '{total} total, showing {first}–{last}',
    perPage: 'Per page',
    perPageLabel: 'Rows per page',
    rows: '{count} rows',
    page: 'Page {current} of {total}',
    first: 'First page',
    previous: 'Previous page',
    next: 'Next page',
    last: 'Last page'
  },
  dialog: {
    closeNamed: 'Close {title}',
    closeDetails: 'Close details'
  },
  filters: {
    title: 'Filters',
    description: 'Changes apply only after you select Apply filters.',
    apply: 'Apply filters',
    reset: 'Reset',
    server: 'Platform filters',
    page: 'This page only',
    pageHint: 'These filters apply only to the loaded page, not your entire catalog.',
    invalidRange: 'The end must not be earlier than the start.'
  },
  imagePreview: {
    title: 'Image preview',
    description: 'View original gallery images and switch, zoom, or rotate them.',
    empty: 'No images',
    noPreview: 'No images are available to preview.',
    openOriginal: 'Open original image in a new tab',
    close: 'Close image preview',
    previous: 'Previous image',
    next: 'Next image',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    rotateLeft: 'Rotate left',
    rotateRight: 'Rotate right',
    reset: 'Reset image'
  },
  metric: {
    checking: 'Checking status',
    localCatalog: 'Local capability catalog',
    confirmedZero: '{source} · Confirmed as 0',
    confirmed: '{source} · Confirmed',
    upstreamUnknown: 'The upstream response did not provide a verifiable total{reason}',
    permissionDenied: 'The current account does not have access{reason}',
    requestFailed: 'API request failed{reason}'
  },
  dataSource: {
    mock: {
      label: 'Local Mock',
      description: 'Data comes from contract examples in mock/data; Alibaba is not contacted.'
    },
    extension: {
      label: 'Live extension gateway',
      description: 'Requests run in the MV3 service worker and never fall back to Mock on failure.'
    },
    detecting: {
      label: 'Detecting BFF source',
      description: 'Reading the backend runtime mode.'
    },
    unavailable: {
      label: 'BFF source unavailable',
      description: 'The backend data source cannot be confirmed; business requests do not fall back to Mock.'
    },
    real: {
      label: 'Live Alibaba data',
      description: 'The BFF is proxying live Alibaba APIs and does not fall back to Mock on failure.'
    },
    replay: {
      label: 'Documentation Replay',
      description: 'The BFF uses audited documentation replays and does not connect to Alibaba.'
    },
    bffMock: {
      label: 'BFF Mock',
      description: 'The BFF returns local contract Mock data.'
    },
    disabled: {
      label: 'Business gateway disabled',
      description: 'The BFF is available, but Alibaba business requests are disabled.'
    }
  },
  error: {
    fallback: 'Operation failed',
    copyFailed: 'Copy failed. Select the requestId manually.',
    diagnosticsMatched: 'Exported matching redacted diagnostics.',
    diagnosticsSummary: 'Exported a redacted error summary.',
    multipleReasons: '{count} reasons were returned:',
    code: 'Error code: {code}',
    copyRequestId: 'Copy requestId',
    configureCredentials: 'Configure credentials',
    preparingDiagnostics: 'Preparing…',
    exportDiagnostics: 'Export redacted diagnostics',
    platformResponse: 'Platform response',
    originalResponse: 'Original response'
  },
  language: {
    switchToEnglish: 'Switch the interface to English',
    switchToChinese: 'Switch the interface to Chinese',
    shortEnglish: 'EN',
    shortChinese: '中'
  },
  theme: {
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    switch: 'Interface theme: {current}; switch to {next}'
  }
} as const;
