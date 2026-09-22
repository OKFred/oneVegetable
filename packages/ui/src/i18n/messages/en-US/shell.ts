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
  editing: {
    title: 'Discard unsaved changes?',
    description:
      'This editing session will not be restored after you leave. Saved settings, batch queues, platform drafts and task records are unaffected.',
    continue: 'Continue editing',
    discard: 'Discard changes and leave'
  },
  startup: {
    unlockTitle: 'Unlock Open Platform credentials',
    unlockDescription:
      'Enter your credential vault passphrase, not your Alibaba website password. You can unlock later and still view Settings, help and release notes.',
    passphrase: 'Credential vault passphrase',
    later: 'Unlock later',
    unlock: 'Unlock',
    unlocking: 'Unlocking…',
    unlocked: 'Credentials unlocked. Resuming queries for the current page.',
    unlockFailed: 'Unable to unlock. Check your vault passphrase, or inspect credential status in Settings.',
    cleanupTitle: 'Clear legacy local editing drafts?',
    cleanupDescription:
      'Product and RFQ editing sessions are no longer restored automatically. Confirm to remove only these old local drafts, or keep them without restoring them. Batch queues, platform drafts, tasks and column preferences will remain.',
    keep: 'Keep old data',
    clear: 'Confirm cleanup',
    cleanupFailed: 'Cleanup did not finish. Try again in Settings under local data management.'
  },
  identity: {
    extensionAdmin: 'Local administrator',
    localDemo: 'Local demo user',
    avatarLabel: 'Current user: {name}'
  },
  navigation: {
    dashboard: 'Dashboard',
    products: 'Products',
    inventory: 'Inventory',
    photos: 'Assets',
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
      photos: 'Images',
      photosDescription: 'Total image assets',
      orders: 'Total orders',
      ordersDescription: 'Order summaries, funds, and logistics',
      capabilities: 'Enabled capabilities',
      capabilitiesDescription: 'Eligible capabilities enabled in this project'
    },
    todo: {
      title: 'To-do',
      description: 'Stored only in this browser and never synchronized to the backend.',
      placeholder: 'Add a to-do item…',
      add: 'Add',
      empty: 'No to-do items yet',
      remaining: '{count} remaining',
      markCompleted: 'Mark “{text}” as completed',
      markActive: 'Mark “{text}” as active',
      delete: 'Delete “{text}”',
      clearCompleted: 'Clear completed ({count})',
      clearTitle: 'Clear completed to-dos?',
      clearDescription: 'Remove {count} completed items and keep unfinished items. This cannot be undone.',
      clearConfirm: 'Clear completed',
      storageError: 'Browser storage is unavailable. These changes may be lost after a refresh.',
      limitReached: 'You can keep up to {count} items. Complete or delete an item before adding another.'
    },
    shop: {
      title: 'Shop link',
      description:
        'Set the Alibaba.com shop URL for this account manually. It is stored on this device only, without backend synchronization or platform changes.',
      visit: 'Visit shop',
      set: 'Set shop link',
      edit: 'Edit link',
      url: 'Alibaba shop URL',
      urlHelp:
        'Copy the HTTPS address from the official shop page. Remove query parameters and fragments; do not enter passwords or other sensitive information.',
      invalid:
        'Enter an HTTPS URL on alibaba.com or a subdomain without credentials, query parameters, fragments, or a custom port.',
      clear: 'Clear link',
      saved: 'Shop link saved on this device',
      cleared: 'Shop link cleared',
      saveFailed:
        'Unable to save the shop link. Check your sign-in, credentials, and browser storage availability.',
      unavailable:
        'Unable to identify the current account or read local settings. Unlock credentials or sign in again, then retry.',
      contextChanged:
        'The account or credential configuration changed. No changes were saved. Set a new link for the current account.'
    }
  }
} as const;
