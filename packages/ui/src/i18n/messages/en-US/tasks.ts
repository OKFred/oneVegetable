export const tasks = {
  title: 'Task center',
  description:
    'Receipts visible to this workbench. Viewing history never reruns a task. Verify uncertain outcomes first.',
  search: 'Search task name, identifier or requestId',
  loading: 'Loading task records…',
  empty: 'No matching tasks in the loaded records',
  loaded: '{count} records loaded. Filters apply only to these records.',
  more: 'Load more product tasks',
  partial: 'Some records could not be loaded. Other tasks remain available.',
  unavailable:
    'Cannot read tasks for this account. Check your session, credentials and connection, then search again.',
  unscoped:
    '{count} legacy queue records could not be matched to loaded receipts for this account. Their product data is hidden. Confirm the target account in the local batch queue; nothing is rebound or submitted here.',
  queue: 'Open local batch queue',
  all: 'All',
  source: 'Business area',
  status: 'Status',
  operation: 'Operation',
  updatedAt: 'Updated',
  createdAt: 'Created',
  lastCheckedAt: 'Last verified',
  notRecorded: 'Not recorded by the source task',
  dateFrom: 'Updated from',
  dateTo: 'Updated through',
  invalidRange: 'End date must not precede start date.',
  attentionFirst: 'Needs attention first',
  attention: 'Needs attention: {count}',
  details: 'View details',
  original: 'Open source task',
  association: 'View association receipt and verification',
  settings: 'Check settings and authorization',
  resource: 'Product / asset identifier',
  taskId: 'Task identifier',
  receipt: 'Platform receipt',
  rawStatus: 'Source status',
  batchLinked: 'From local batch queue',
  steps: 'Current steps and execution records',
  snapshot:
    'This is the latest source snapshot, not an inferred history. Submitted does not mean verified by platform readback.',
  step: 'Step / file',
  part: 'Part {number}',
  noSteps: 'This task has no separate step records. See its status, receipt and source task.',
  contextChanged:
    'Credentials or storage configuration changed. This record is history only. Preview a new task instead of rebinding it automatically.',
  accountUnknown: 'Historical account not confirmed',
  accountUnknownHelp:
    'This legacy receipt has no Alibaba account fingerprint, so it cannot be matched to current credentials. History is read-only; it does not authorize recovery or another execution.',
  changed: 'Account or configuration changed. Previous results were cleared. Search again.',
  copied: 'requestId copied',
  copy: 'Copy requestId',
  copyFailed: 'Copy failed. Please copy manually.',
  unknown: 'Unknown / awaiting verification',
  sources: {
    product: 'Product writes',
    gallery: 'Image transfers',
    'video-upload': 'Video uploads',
    'video-association': 'Video associations'
  },
  states: {
    pending: 'Pending',
    running: 'Running',
    submitted: 'Submitted / awaiting verification',
    confirmed: 'Confirmed',
    attention: 'Needs attention / unknown',
    failed: 'Explicit failure',
    cancelled: 'Cancelled'
  },
  operations: {
    publishProduct: 'Publish product',
    saveProductDraft: 'Platform draft',
    updateProduct: 'Update product',
    updateProductDisplay: 'Product visibility',
    'import-zip': 'ZIP import',
    'export-zip': 'ZIP export',
    'import-s3': 'S3 import',
    'export-s3': 'S3 export',
    file: 'Local video upload',
    url: 'URL video upload',
    main: 'Main video association',
    detail: 'Detail video association'
  },
  guidance: {
    none: 'Viewing this record does not execute work. To continue, open the original task and confirm its current state.',
    verify: 'The platform may still be processing. Verify in the source task. Do not upload or submit again.',
    login: 'Sign in to the workbench again, then inspect the source task. Signing in never replays writes.',
    unlock: 'Unlock the credential vault in Settings, then return to the task.',
    permission:
      'Check platform eligibility or host permission. Continue manually in the source task after authorization; no automatic retry.',
    configuration:
      'Check account credentials and S3 settings. A task with changed configuration needs a new preview, not a direct resume.',
    file: 'Open the source task and reselect the original ZIP / MP4. Its fingerprint must match before you can continue manually.',
    inspect:
      'Inspect the source task and handle the cause. Only items known not to have executed may be retried through their existing workflow.'
  }
} as const;
