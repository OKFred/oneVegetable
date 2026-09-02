export const logistics = {
  title: 'International logistics workspace',
  description:
    'Addresses, product attributes, shipping quotes, logistics orders, and labels are normalized into stable types. Amounts and business IDs remain strings throughout.',
  qualification:
    'OneTouch international logistics APIs require business eligibility. No real account has completed verification in this project.',
  availability:
    'Calls follow operation availability: {reason}. Shipping templates are a free product-domain API and can be queried independently.',
  workspaceLabel: 'Logistics workspace',
  workspaces: {
    quote: 'Shipping quote',
    orders: 'Logistics orders',
    addresses: 'Addresses and templates',
    draft: 'Order draft'
  },
  errors: {
    quoteUnavailable: 'OneTouch international logistics quotes are unavailable in this environment',
    quoting: 'Requesting shipping options from the platform',
    ordersUnavailable: 'Logistics order queries are unavailable in this environment',
    ordersRefreshing: 'Refreshing logistics orders',
    createUnavailable: 'Real logistics ordering is unavailable in this environment',
    quoteFirst: 'Generate an available option in Shipping quote first',
    creating: 'The logistics order is being submitted',
    quoteSelection: 'Complete a shipping quote and select an available option first',
    addressUnavailable: 'OneTouch address dictionaries are not queried in this environment'
  },
  feedback: {
    quoteDone: 'Shipping quote completed with {count} options.',
    orderSubmitted: 'Logistics order submitted.'
  },
  documentNotReturned: 'Not returned by the API',
  columns: {
    orderNumber: 'Logistics order number',
    status: 'Status',
    freight: 'Freight',
    placedAt: 'Placed at'
  },
  quote: {
    parcel: 'Package and cargo',
    originZip: 'Origin postal code',
    destinationCountry: 'Destination country',
    destinationZip: 'Destination postal code',
    product: 'Shipping product',
    warehouse: 'Warehouse code',
    nameCn: 'Chinese cargo name',
    nameEn: 'English cargo name',
    quantity: 'Quantity',
    unitValue: 'Declared value per item (USD)',
    material: 'Material',
    specialType: 'Special product attributes',
    normal: 'Regular product',
    battery: 'Contains battery',
    length: 'Length cm',
    width: 'Width cm',
    height: 'Height cm',
    weight: 'Weight kg',
    qualificationPending: 'Business eligibility pending',
    start: 'Calculate quote',
    options: 'Available options',
    consistency: 'Order creation revalidates that the product code matches this quote.',
    available: 'Available',
    prompt: 'Complete the parameters and calculate a quote.'
  },
  orders: {
    filter: 'Filter by logistics order number',
    empty: 'No logistics orders',
    view: 'View logistics order {number}',
    noMatch: 'No matching logistics orders',
    noOrders: 'This account has no logistics orders',
    clear: 'Clear filter',
    title: 'Logistics order {number}',
    fallbackTitle: 'Logistics order details',
    description: 'Warehouse, tracking, and shipping-label data',
    information: 'Order information',
    warehouseMissing: 'Warehouse not returned',
    trackingMissing: 'Tracking number not returned',
    labelHttps: 'Label: HTTPS URL',
    labelBase64: 'Label: Base64 data returned (not persisted)',
    labelMissing: 'Label: not returned by the API'
  },
  addresses: {
    dictionary: 'Address dictionary',
    level: 'Level',
    province: 'Province',
    city: 'City',
    division: 'District/county',
    street: 'Street search',
    parentId: 'Parent ID',
    search: 'Search term',
    templates: 'Shipping templates'
  },
  draft: {
    contacts: 'Sender and recipient',
    privacy: 'Contacts, phone numbers, and addresses remain only in page memory and are cleared on refresh.',
    consignor: 'Sender',
    consignee: 'Recipient',
    contact: 'Contact',
    phone: 'Phone',
    address: 'Full address',
    disabled: 'Real ordering remains disabled',
    submit: 'Submit logistics order',
    quotePrompt: 'Generate an available option in Shipping quote first.',
    result: 'Submission result',
    demoSuccess: 'Demo order succeeded',
    noPersistence: 'This workspace does not persist personal information from the draft.'
  }
} as const;
