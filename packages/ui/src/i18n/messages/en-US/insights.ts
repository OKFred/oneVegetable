export const insights = {
  columns: {
    product: 'Previously purchased product',
    productId: 'Product ID',
    categoryId: 'Category ID',
    price: 'Historical price range',
    publishedAt: 'Published date'
  },
  notReturned: 'Not returned',
  documentNotReturned: 'Not returned by the API',
  workspaces: {
    performance: 'Business ranking',
    suppliers: 'Purchasing suppliers',
    partner: 'Partner capability'
  },
  title: 'Data and supplier insights',
  description:
    'Combines site-wide supplier rankings with historical Trade Assurance purchasing relationships. Raw responses are normalized only in adapters, and long IDs are never converted to JavaScript numbers.',
  disclaimer:
    'Results are shown exactly according to official fields. Ranking percentages are not interpreted as an official business diagnosis or supplier quality signal. Supplier purchasing APIs require an authorized buyer identity; without permission, only the local contract demo is available.',
  workspaceLabel: 'Insights workspace',
  latestRank: 'Latest site-wide ranking percentage',
  rankExplanation:
    'The API returns only a date and percent without defining trend semantics. The app preserves the raw value and does not generate improvement, decline, or rating conclusions.',
  timeline: 'Ranking timeline',
  noRank: 'No ranking data.',
  historicalSuppliers: 'Historical Trade Assurance suppliers',
  supplierCount: '{count}',
  encryptedOnly: 'The API returns only encrypted supplier IDs, so company names are not fabricated.',
  dateFilter: 'Historical order date filter',
  startDate: 'Start date',
  endDate: 'End date',
  selectSupplier: 'Select an encrypted supplier ID on the left to view products previously ordered from it.',
  currentSupplier: 'Current supplier:',
  noProducts: 'No historical purchased products',
  partnerTitle: 'CGS Xiaoman contracted-customer data query',
  disabled: 'Disabled by default',
  partnerDescription:
    'Although the API is marked free and does not require user authorization, its name and documentation restrict it to CGS Xiaoman contracted customers and require a separate business app_secret. The app therefore keeps only its types, demo contract, and audit record. It does not expose a call form or place the secret in the UI or ordinary settings.',
  partnerMock: 'Local demo mode does not simulate real company data.',
  partnerExtension: 'The extension service worker blocks this method in the generic debugger.'
} as const;
