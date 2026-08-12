import type { PhotoTransferRequest, PhotoUploadRequest } from './types';

export const MAX_TRANSFER_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp'
]);

export interface DownloadedPhotoUpload extends PhotoUploadRequest {
  contentType: string;
  byteLength: number;
}

export function assertPublicPhotoUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('图片 URL 无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('图片 URL 仅允许 HTTP(S) 协议');
  }
  if (url.username || url.password) throw new Error('图片 URL 不允许包含凭据');

  const hostname = url.hostname.replace(/^\[(.*)]$/, '$1').toLocaleLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error('图片 URL 不允许访问本机或本地域名');
  }
  if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error('图片 URL 不允许访问回环、私网或 link-local 地址');
  }
  return url;
}

export async function downloadPhotoForUpload(
  request: PhotoTransferRequest,
  fetcher: typeof fetch = fetch
): Promise<DownloadedPhotoUpload> {
  const maxBytes = Math.min(request.maxBytes ?? MAX_TRANSFER_IMAGE_BYTES, MAX_TRANSFER_IMAGE_BYTES);
  let url = assertPublicPhotoUrl(request.url);
  let response: Response | undefined;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp' }
    });
    if (!isRedirect(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('图片下载重定向缺少 Location');
    if (redirect === MAX_REDIRECTS) throw new Error('图片下载重定向次数过多');
    url = assertPublicPhotoUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`图片下载失败（HTTP ${response?.status ?? 0}）`);

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLocaleLowerCase() ?? '';
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) throw new Error('URL 返回内容不是支持的图片类型');
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new Error(`图片超过 ${formatBytes(maxBytes)} 下载上限`);
  }

  const bytes = await readResponseBytes(response, maxBytes);
  return {
    file: bytesToBase64(bytes),
    fileName: sanitizeFileName(request.fileName ?? inferFileName(url, contentType)),
    groupId: request.groupId,
    contentType,
    byteLength: bytes.byteLength
  };
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false;
  const normalized = hostname.toLocaleLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mappedIpv4 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : undefined;
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`图片超过 ${formatBytes(maxBytes)} 下载上限`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      total += result.value.byteLength;
      if (total > maxBytes) throw new Error(`图片超过 ${formatBytes(maxBytes)} 下载上限`);
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function inferFileName(url: URL, contentType: string): string {
  const pathName = decodeURIComponent(url.pathname.split('/').at(-1) ?? '').trim();
  if (pathName.includes('.') && pathName.length > 0) return pathName;
  return `transferred-image.${extensionFor(contentType)}`;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = Array.from(fileName, (character) =>
    character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '-' : character
  )
    .join('')
    .trim()
    .slice(0, 255);
  return sanitized || 'transferred-image.jpg';
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  return contentType.slice('image/'.length);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.floor(bytes / (1024 * 1024))} MiB`
    : `${Math.floor(bytes / 1024)} KiB`;
}
