export const IOP_VAULT_KEY = 'one-vegetable-iop-authorization-v1';
export const IOP_RECEIPT_KEY = 'one-vegetable-iop-refresh-receipt-v1';
export const TOP_VAULT_KEY = 'one-vegetable-top-authorization-v1';
export const TOP_RECEIPT_KEY = 'one-vegetable-top-refresh-receipt-v1';
// Sensitive recovery material: exclude these from non-secret inventories.
export const IOP_SESSION_KEY = 'one-vegetable-iop-authorization-session-v1';
export const TOP_SESSION_KEY = 'one-vegetable-top-authorization-session-v1';
export const IOP_APPLICATION_READER_ORIGINS = [
  'https://i.alibaba.com/*',
  'https://openapi.alibaba.com/*',
  'https://openapi-account.alibaba.com/*'
] as const;
export const TOP_APPLICATION_READER_ORIGINS = ['https://crosstrade.alibaba.com/*'] as const;
