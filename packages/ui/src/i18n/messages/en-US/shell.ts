export const shell = {
  brand: 'oneVegetable',
  documentTitle: 'oneVegetable · Alibaba.com Operations Workspace',
  workspaceTitle: 'Alibaba.com Open Platform Operations Workspace',
  checkingSession: 'Checking your local session…',
  primaryNavigation: 'Primary navigation',
  openNavigation: 'Open primary navigation',
  closeNavigation: 'Close navigation',
  openWorkspace: 'Open operations workspace',
  popupDescription:
    'WXT reloads the extension automatically in development. Real API requests run in the extension service worker.',
  logout: 'Sign out',
  navigation: {
    dashboard: 'Dashboard',
    products: 'Products',
    photos: 'Gallery',
    rfqs: 'RFQs',
    orders: 'Orders',
    logistics: 'International logistics',
    insights: 'Insights',
    capabilities: 'API capabilities',
    admin: 'Administration',
    releases: 'What’s new',
    settings: 'Settings'
  },
  dashboard: {
    title: 'Operations dashboard',
    descriptions: {
      bff: 'Alibaba.com products, assets, and orders. Real requests are proxied by the local BFF.',
      extension:
        'Alibaba.com products, assets, and orders. Real requests run in the extension service worker.',
      mock: 'Alibaba.com products, assets, and orders. Local contract demo data is currently in use.'
    },
    metrics: {
      products: 'Products',
      productsDescription: 'Schema publishing and updates',
      photos: 'Gallery',
      photosDescription: 'Total gallery assets',
      orders: 'Total orders',
      ordersDescription: 'Order summaries, funds, and logistics',
      capabilities: 'Enabled capabilities',
      capabilitiesDescription: 'Eligible capabilities enabled in this project'
    },
    iterationStatus: 'Iteration status',
    openApiContract: 'OpenAPI 3.1 contract',
    migrated: 'Migrated',
    enabled: 'Enabled',
    schemaReplacement: 'Replaced by Schema',
    legacyPublishing: 'Legacy publishing flow'
  }
} as const;
