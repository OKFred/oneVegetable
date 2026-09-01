export const rfqs = {
  title: 'RFQ workspace',
  description:
    'RFQ search, recommendations, details, read status, and quotation drafts all use typed contracts.',
  status: {
    demo: 'Contract demo',
    denied: 'This account has no RFQ permission',
    ready: 'RFQ permission preflight passed',
    checking: 'Checking RFQ permission'
  },
  permissions: {
    deniedTitle: 'This app has not been granted the RFQ API package',
    deniedDescription:
      'Alibaba returned {code} / {subCode}. Further search, recommendation, detail, and read-status requests have been stopped to avoid repeated failures.',
    checking: 'Checking…',
    retry: 'Check permission again',
    docs: 'View RFQ API documentation',
    failedTitle: 'RFQ permission check failed',
    retryLater: 'Try again later.',
    retryShort: 'Check again'
  },
  mutation: {
    unavailable: 'Real attachment upload or quotation submission is unavailable',
    uploadUnavailable: 'Attachment upload is unavailable in this environment',
    submitUnavailable: 'Real quotation submission is unavailable in this environment',
    submitting: 'The quotation is being submitted',
    fillFirst: 'Complete these fields first: {fields}',
    closedTitle: 'Real quotation writes remain disabled',
    closedDescription: '{reason}; local quotation drafts remain available.',
    localAvailable: 'You can save a local draft; {reason}.'
  },
  fields: {
    rfq: 'RFQ',
    message: 'Message to buyer',
    itemName: 'Product name',
    unitPrice: 'Unit price',
    quantity: 'Quantity',
    port: 'Shipping port',
    expiresAt: 'Valid until',
    currency: 'Currency',
    quantityUnit: 'Quantity unit',
    shippingTerms: 'Trade terms',
    paymentTerms: 'Payment terms',
    remark: 'Remark'
  },
  feedback: {
    submitted: 'RFQ quotation submitted.',
    attachmentUploaded: 'Quotation attachment uploaded and added to the current draft.'
  },
  errors: { attachmentRead: 'Could not read the attachment' },
  columns: {
    demand: 'Buying request',
    quantity: 'Quantity',
    country: 'Country/region',
    remaining: 'Quotes left',
    status: 'Status',
    deadline: 'Deadline'
  },
  read: 'Read',
  unread: 'Unread',
  notProvided: 'Not provided',
  equity: {
    quotes: 'Remaining quotation quota',
    topQuotes: 'Remaining top-placement quota',
    score: 'Marketplace score'
  },
  market: 'RFQ marketplace',
  recommended: 'Recommended RFQs',
  searchPlaceholder: 'Search request title or description',
  countryPlaceholder: 'Country code',
  unquotedOnly: 'Quotable only',
  search: 'Search',
  noMatch: 'No matching RFQs',
  view: 'View RFQ {subject}',
  detailTitle: 'RFQ details',
  sidebarDescription: 'Details and the quotation draft are kept together in this panel',
  detail: {
    label: 'RFQ details',
    description: 'Buying requirements, trade terms, and buyer attachments',
    noDescription: 'The API response did not include a detailed description.',
    category: 'Category',
    destinationPort: 'Destination port',
    paymentTerms: 'Payment terms',
    shippingTerms: 'Shipping terms',
    attachments: 'Buyer attachments'
  },
  draft: {
    title: 'Quotation draft',
    description: 'The draft is stored only in this browser and does not make an early network call.',
    saved: 'Saved',
    save: 'Save draft',
    attachment: 'Quotation attachment',
    submit: 'Submit quotation',
    missing: 'Complete these fields before submitting: {fields}.',
    demoSuccess: 'Demo quotation submitted',
    success: 'Quotation submitted',
    quotationId: '{message}, quotation ID: {id}'
  }
} as const;
