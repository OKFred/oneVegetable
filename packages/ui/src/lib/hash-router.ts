export const PAGE_IDS = [
  'dashboard',
  'products',
  'photos',
  'rfqs',
  'orders',
  'logistics',
  'insights',
  'capabilities',
  'admin',
  'settings'
] as const;

export type PageId = (typeof PAGE_IDS)[number];

const pageIds = new Set<string>(PAGE_IDS);

export function pageHash(page: PageId): `#/${PageId}` {
  return `#/${page}`;
}

export function parsePageHash(hash: string): PageId | null {
  const rawPath = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] ?? '';
  const path = rawPath.replace(/\/+$/, '');
  if (!path.startsWith('/')) return null;

  const page = path.slice(1);
  return pageIds.has(page) ? (page as PageId) : null;
}
