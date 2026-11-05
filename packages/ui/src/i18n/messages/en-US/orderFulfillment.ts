export const orderFulfillment = {
  title: 'Order fulfillment read-only tools',
  readOnly: 'Reads only after Query. Does not create orders, pay, ship, or persist business content.',
  iopHint:
    'Warehouses, freight and tracking are IOP-native capabilities. TOP-only configurations need IOP configuration and the required permissions. No automatic protocol fallback or mock results.',
  tabs: 'Fulfillment tool tabs',
  warehouses: 'Warehouses',
  freight: 'Freight',
  tracking: 'Tracking',
  warehouseKind: 'Warehouse type',
  normal: 'Standard warehouses',
  ggs: 'GGS warehouses',
  productId: 'Product ID (product_id, required)',
  countryCode: 'Country code (country_code, optional)',
  page: 'Current page (current_page)',
  previous: 'Previous page',
  next: 'Next page',
  paginationHint:
    'Standard and GGS pagination are independent. Click Query after changing pages. GGS uses 10 items per page and has no country filter.',
  freightKind: 'Freight query type',
  basic: 'Basic freight estimate',
  advanced: 'Advanced freight calculation',
  freightHint:
    'Shows only upstream cost and currency fields, without inference or conversion. Logistics determinacy is not a freight quote or a carriage or delivery guarantee.',
  quantity: 'Quantity (quantity, positive integer)',
  destinationCountry: 'Actual destination country code (destination_country, required)',
  zipCode: 'Destination postal code (zip_code, optional)',
  dispatchLocation: 'Dispatch location (dispatch_location, optional)',
  advancedHint:
    'Enter a business parameters JSON object with a real e_company_id, logistics_product_list and actual destination. Supply destination fields required by the business API. The helper fills only the current product and quantity, never a company ID or destination.',
  parameters: 'Business parameters (JSON)',
  fillProduct: 'Fill current product ID',
  tradeId: 'Real numeric order ID (trade_id, required)',
  trackingHint:
    'Only safe positive integer digits are accepted. An encrypted orderId is never converted or queried automatically. Supply the real numeric trade_id.',
  invalid:
    'Complete the required fields. IDs, pages and quantity must be safe positive integer digits; country codes must be two letters.',
  advancedInvalid:
    'Provide a valid JSON object, real e_company_id, nonempty logistics_product_list and actual destination. The read client performs full business validation.',
  query: 'Query',
  busy: 'Reading…',
  failed: 'Read failed. Check IOP configuration, permissions and business parameters.',
  warehouseResults: 'Warehouse results',
  freightResults: 'Cost results (upstream fields only)',
  trackingResults: 'Logistics tracking results',
  empty: 'No readable fields returned. This does not establish completion or the absence of tracking.',
  trace: 'Trace ID',
  nested: 'Expand nested data',
  raw: 'Expand raw data (JSON)',
  unknown: 'Unknown',
  yes: 'Yes',
  no: 'No',
  close: 'Close'
};
