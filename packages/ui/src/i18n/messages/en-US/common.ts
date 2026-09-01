export const common = {
  actions: {
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
    empty: 'No data'
  },
  sidebar: {
    expand: 'Expand {title}',
    collapse: 'Collapse {title}'
  },
  pagination: {
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
    platformResponse: 'Platform response'
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
