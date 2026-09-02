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
  'releases',
  'settings'
] as const;

export type PageId = (typeof PAGE_IDS)[number];

export interface AppHashRoute {
  page: PageId;
  segments: string[];
}

const pageIds = new Set<string>(PAGE_IDS);

export function pageHash(page: PageId): `#/${PageId}` {
  return `#/${page}`;
}

export function parsePageHash(hash: string): PageId | null {
  return parseAppHash(hash)?.page ?? null;
}

export function appHash(page: PageId, ...segments: string[]): string {
  const suffix = segments.length === 0 ? '' : `/${segments.map(encodeURIComponent).join('/')}`;
  return `#/${page}${suffix}`;
}

export function parseAppHash(hash: string): AppHashRoute | null {
  const rawPath = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] ?? '';
  const path = rawPath.replace(/\/+$/, '');
  if (!path.startsWith('/')) return null;

  const [page, ...encodedSegments] = path.slice(1).split('/');
  if (!page || !pageIds.has(page)) return null;
  try {
    return { page: page as PageId, segments: encodedSegments.map(decodeURIComponent) };
  } catch {
    return null;
  }
}
