export const orders = {
  title: 'Trade and order workspace',
  description:
    'Orders, funds, logistics, fulfillment, and address capabilities use stable internal models. Raw Alibaba responses are handled only in adapters.',
  jushitaNotice:
    'alibaba.seller.order.get can only be called from Jushita, so full order details are explicitly unavailable. The page combines only order summaries, funds, and logistics, preserving other results if one API fails.',
  workspaceLabel: 'Trade workspace',
  workspaces: {
    orders: 'Orders and aggregated details',
    finance: 'Funds and fulfillment',
    addresses: 'Address Schema',
    assurance: 'Trade Assurance order draft'
  },
  errors: {
    selectOrder: 'Select an order first',
    createUnavailable: 'Trade Assurance order creation is unavailable in this environment',
    creating: 'The Trade Assurance order is being submitted',
    incompleteDraft: 'Complete the buyer, product ID, title, quantity, and unit price'
  },
  feedback: { created: 'Trade Assurance order created: {id}' },
  notReturned: 'Not returned',
  documentNotReturned: 'Not returned by the API',
  columns: {
    orderId: 'Order number',
    buyer: 'Buyer login',
    amount: 'Amount',
    status: 'Status',
    modifiedAt: 'Last modified',
    actions: 'Actions'
  },
  view: 'View',
  filters: {
    buyer: 'Filter by buyer login',
    allStatuses: 'All order statuses',
    unpay: 'Awaiting payment',
    paid: 'Paid',
    undeliver: 'Awaiting shipment',
    delivering: 'Shipping',
    success: 'Trade completed',
    closed: 'Trade closed',
    timeZoneWarning:
      'The documentation says only “US time” without specifying a time zone. Filter values are sent unchanged and are not converted by the app.'
  },
  noMatch: 'No matching orders',
  noMatchingOrder: 'No matching orders',
  noOrders: 'This account has no orders',
  clearFilters: 'Clear filters',
  viewOrder: 'View order {id}',
  finance: {
    channels: 'Fulfillment channels',
    available: 'Available',
    unavailable: 'Unavailable',
    serviceCharge: 'Service fees',
    currencyLabel: 'Service-fee currency',
    rateAndCap: 'Rate {rate} · Cap {cap}',
    notReturned: 'Not returned',
    serviceTypeMissing: 'Service type not returned',
    logisticsTypeMissing: 'Logistics type not returned'
  },
  addresses: {
    country: 'Destination country code',
    buyerEmail: 'Buyer email (current query only)',
    privacy: 'Email and address data are not persisted and are discarded when you leave or refresh the page.',
    schema: 'Official address form Schema',
    required: 'Required',
    addressBook: 'Address book',
    emailPrompt: 'Enter a valid email address to query.',
    writeUnavailable:
      'Only address Schema and address queries are integrated. Alibaba address writes have not passed account verification.',
    add: 'Add address'
  },
  assurance: {
    title: 'Trade Assurance order draft',
    description:
      'The local Web demo can validate draft interaction. Creation and modification remain disabled in the extension according to current capability availability.',
    buyer: 'Buyer login',
    currency: 'Currency, e.g. USD',
    productId: 'Product ID',
    subject: 'Product name',
    quantity: 'Quantity',
    unitPrice: 'Unit price',
    createDemo: 'Create demo Trade Assurance order',
    createUnavailable: 'Create Trade Assurance order (unavailable)',
    webDemo: 'Web demo',
    demoCreated: 'Demo order created: {id}'
  },
  drawer: {
    title: 'Order {id}',
    fallbackTitle: 'Order details',
    description: 'Order summary, funds, logistics, and remittance information are read-only',
    previousLabel: 'View previous order',
    previous: 'Previous',
    nextLabel: 'View next order',
    next: 'Next',
    tabsLabel: 'Order detail sections',
    overview: 'Overview',
    payment: 'TT remittance',
    overviewLabel: 'Order overview',
    orderAmount: 'Order amount',
    buyer: 'Buyer',
    createdAt: 'Created',
    modifiedAt: 'Last modified',
    funds: 'Funds',
    logistics: 'Logistics',
    apiUnavailable: 'API unavailable',
    carrierMissing: 'Carrier not returned',
    trackingMissing: 'Tracking number not returned',
    fullDetailUnavailable: 'Full order details unavailable',
    fullDetailReason:
      'alibaba.seller.order.get can only be called from Jushita. This page does not fill gaps with demo fields.',
    paymentLabel: 'TT remittance information',
    payable: 'Amount payable',
    recipient: 'Recipient',
    bank: 'Bank',
    account: 'Account number',
    hideAccount: 'Hide full remittance account',
    showAccount: 'Show full remittance account',
    sensitiveNotice:
      'The remittance account remains only in page memory and is masked again when you switch orders or close the details.'
  }
} as const;
