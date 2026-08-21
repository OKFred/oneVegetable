export function isPhotoBankUrl(rawUrl: string): boolean {
  try {
    const normalized = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    const url = new URL(normalized);
    const hostname = url.hostname.toLocaleLowerCase();
    return url.protocol === 'https:' && (hostname === 'alicdn.com' || hostname.endsWith('.alicdn.com'));
  } catch {
    return false;
  }
}
