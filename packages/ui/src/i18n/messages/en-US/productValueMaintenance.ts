export const productValueMaintenance = {
  receiptRejectedHint:
    'The platform explicitly rejected this change. Expand the receipt diagnostics to check the reason code; this task must not be resent.',
  receiptIssueHint:
    'The platform receipt contains a diagnostic code. Check it and use read-only verification; do not resend this task.',
  traceId: 'Platform trace ID',
  methodDisabledHint:
    'This maintenance method is disabled. Check its explicit runtime switch and API permission; do not resend an attempted task.',
  baselineChangedHint:
    'The product changed after the preview. Read the task, then cancel a confirmed-unsent preview and prepare a fresh baseline. Do not resend an attempted task.',
  entityBusyHint:
    'This product or draft has an unresolved maintenance task. Read unresolved tasks to verify its result or cancel an unsent preview; do not create a duplicate submission.',
  alreadyAttemptedHint:
    'This task has already been submitted once. Read the current task and verify read-only; it cannot be sent again.',
  draftVerificationUnavailableHint:
    'Draft absence cannot currently be confirmed. This is not proof of deletion. Keep the task and check again manually; never resend the deletion.',
  technicalDetails: 'Technical details (code / request ID)',
  loadTasks: 'Read unresolved maintenance tasks',
  maintenanceTasks: 'Unresolved maintenance tasks',
  emptyTasks: 'No unresolved task matches this context, product and maintenance type.',
  selectTask: 'Open task result',
  resumedHint:
    'Restored task: read/verify only. Cancel an unsent preview before preparing new values. Nothing is sent automatically.',
  closeHint:
    'Closing preserves unfinished tasks and locks. Return to Read unresolved maintenance tasks to continue. Use Discard unsent preview explicitly to release an unsent preview.',
  backToTasks: 'Back to task list',
  permissionDenied:
    'The application API permission was denied. Request the required IOP capability before continuing; an attempted submission must not be resent.',
  priceTitle: 'Price maintenance',
  priceSafetyTitle: 'Standalone price updates are not enabled yet.',
  priceSafetyHint:
    'Controlled checks found a risk that other product fields may not be preserved. Field integrity for this operation is not yet confirmed.',
  priceEditorHint:
    'Use the existing product editor to change prices, then verify key fields after saving. Existing tasks can still be read and verified; previews do not enable submission.',
  inventoryTitle: 'Absolute inventory maintenance',
  draftsTitle: 'Verified draft receipts',
  iopHint:
    'IOP only. Prepare a persisted preview and baseline first, confirm once, then verify by readback. Unknown outcomes must never be resent.',
  unavailable: 'The maintenance service is unavailable in this runtime.',
  product: 'Product ID',
  productRequired: 'Open this tool for a specific product first.',
  priceMode: 'Price mode',
  tiered: 'USD tiered prices',
  range: 'USD price range',
  sku: 'Per SKU',
  spu: 'Whole product (SPU)',
  currency: 'Currency',
  skuCurrencyHint:
    'For SKU prices, enter the current currency. The service checks it against the baseline; it is never guessed.',
  quantity: 'Starting quantity',
  price: 'Price',
  minPrice: 'Minimum price',
  maxPrice: 'Maximum price',
  skuId: 'SKU ID',
  inventory: 'Absolute inventory',
  inventoryHint:
    'These are absolute stock counts, not increments or decrements. Zero is valid. Monetary values and counts stay as exact strings.',
  addTier: 'Add tier',
  addSku: 'Add SKU row',
  remove: 'Remove row',
  prepare: 'Create preview and read baseline',
  invalid: 'Complete the rows with valid non-negative values. IDs and quantities must be valid integers.',
  preview: 'Persisted preview',
  field: 'Field',
  before: 'Baseline',
  after: 'Target',
  type: 'Price type',
  tier: 'Tier quantity',
  draftId: 'Draft ID',
  confirm: 'Review and confirm',
  confirmTitle: 'Confirm one-time submission',
  confirmHint:
    'Send exactly the persisted preview shown here. Once attempted, do not resend even after a timeout. Verification is read-only.',
  sendOnce: 'Confirm and send once',
  verify: 'Verify by readback (read-only)',
  refresh: 'Read current task',
  cancelPreview: 'Discard unsent preview',
  status: 'Task status',
  requestId: 'Request ID',
  taskId: 'Task ID',
  fingerprint: 'Intent fingerprint',
  prepared: 'Prepared — not sent',
  dispatching: 'Dispatching — outcome not yet known',
  accepted: 'Accepted — readback still required',
  rejected: 'Rejected',
  partial: 'Partial — do not resend',
  ambiguous: 'Unknown outcome — do not resend',
  verified: 'Verified by readback',
  cancelled: 'Cancelled',
  matched: 'Readback matched',
  mismatched: 'Readback differs',
  unavailableReadback: 'Readback unavailable',
  mismatchedFields: 'Mismatched fields',
  unavailableFields: 'Unavailable fields',
  attemptedHint:
    'A submission has been attempted. Only read/verify is permitted; no retry or replacement send is offered.',
  editedHint:
    'Inputs changed after preparation. Discard the unsent preview before preparing different values.',
  loadDrafts: 'Load verified draft receipts',
  draftsHint:
    "Only current-context IOP verified saveProductDraft receipts are eligible. This is not the shop's full draft list. Formal product IDs cannot be entered for deletion.",
  emptyDrafts: 'No eligible verified draft receipts on this page.',
  prepareDelete: 'Prepare deletion',
  receipt: 'Creation receipt',
  page: 'Receipt page',
  previous: 'Previous page',
  next: 'Next page',
  deleteHint:
    'Only this single receipt-backed draft can be deleted. Absence must be established by explicit readback, never inferred from an error.',
  baselineMissing: 'A matching baseline is required before sending.',
  failed:
    'The operation could not be confirmed. Check the static code and read the task; do not resend an attempted submission.',
  close: 'Close',
  busy: 'Working…',
  previewCancelled: 'The unsent preview was cancelled.'
} as const;
