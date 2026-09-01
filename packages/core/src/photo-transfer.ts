import { createRequestId, NativeFetchTransport, NetworkManager } from './network';
import {
  MAX_PHOTOBANK_IMAGE_BYTES,
  PHOTOBANK_UPLOAD_CONTENT_TYPES,
  PHOTO_CONTENT_TYPES,
  photoFileExtension,
  validatePhotoBytes
} from './encoded-file';
import { isPhotoBankUrl } from './product-description-url';
import type {
  PhotoTransferRequest,
  PhotoUploadRequest,
  ProductAssetDownloadRequest,
  ProductAssetDownloadResult
} from './types';

export const MAX_TRANSFER_IMAGE_BYTES = MAX_PHOTOBANK_IMAGE_BYTES;
const MAX_REDIRECTS = 5;
const PHOTO_UPLOAD_ACCEPT_HEADER = [...PHOTOBANK_UPLOAD_CONTENT_TYPES].join(',');

export type DownloadedPhotoUpload = PhotoUploadRequest;

export interface PhotoDownloadOptions {
  assertUrl?: (url: URL) => void;
}

export async function downloadProductAsset(
  request: ProductAssetDownloadRequest,
  fetcher: typeof fetch = globalThis.fetch
): Promise<ProductAssetDownloadResult> {
  if (!isPhotoBankUrl(request.url)) {
    throw new Error('商品资源导出仅允许国际站图库地址');
  }
  const downloaded = await downloadPhotoForUpload(
    { url: request.url, groupId: '-1', maxBytes: MAX_PHOTOBANK_IMAGE_BYTES },
    fetcher,
    {
      assertUrl(url) {
        if (!isPhotoBankUrl(url.toString())) {
          throw new Error('商品资源导出不允许跳转到图库域名之外');
        }
      }
    }
  );
  const bytes = base64ToBytes(downloaded.contentBase64);
  const contentType = validatePhotoBytes(bytes);
  if (!PHOTOBANK_UPLOAD_CONTENT_TYPES.has(contentType)) {
    throw new Error('图库图片实际格式不受支持');
  }
  return {
    fileName: canonicalImageFileName(downloaded.fileName, contentType),
    contentBase64: downloaded.contentBase64,
    contentType,
    byteLength: downloaded.byteLength,
    sha256: await sha256Hex(bytes)
  };
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
  fetcher: typeof fetch = globalThis.fetch,
  options: PhotoDownloadOptions = {}
): Promise<DownloadedPhotoUpload> {
  const maxBytes = Math.min(request.maxBytes ?? MAX_TRANSFER_IMAGE_BYTES, MAX_TRANSFER_IMAGE_BYTES);
  let url = assertPublicPhotoUrl(request.url);
  options.assertUrl?.(url);
  const requestId = createRequestId();
  const network = new NetworkManager({
    transport: new NativeFetchTransport(fetcher),
    policies: {
      alibaba: { allowedOrigins: [] },
      bff: { allowedOrigins: [] },
      'external-photo': {
        allowUrl(candidate) {
          const checked = assertPublicPhotoUrl(candidate.toString());
          options.assertUrl?.(checked);
          return true;
        },
        timeoutMilliseconds: 30_000,
        maxResponseBytes: maxBytes,
        redirect: 'manual',
        credentials: 'omit',
        defaultHeaders: {
          Accept: PHOTO_UPLOAD_ACCEPT_HEADER
        }
      }
    }
  });
  let response:
    | {
        status: number;
        ok: boolean;
        headers: Headers;
        data: unknown;
      }
    | undefined;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    response = await network.request({
      service: 'external-photo',
      url,
      requestId,
      method: 'GET',
      responseType: 'bytes',
      acceptStatuses: [301, 302, 303, 307, 308]
    });
    if (!isRedirect(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('图片下载重定向缺少 Location');
    if (redirect === MAX_REDIRECTS) throw new Error('图片下载重定向次数过多');
    url = assertPublicPhotoUrl(new URL(location, url).toString());
    options.assertUrl?.(url);
  }
  if (!response?.ok) throw new Error(`图片下载失败（HTTP ${response?.status ?? 0}）`);

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLocaleLowerCase() ?? '';
  if (!PHOTO_CONTENT_TYPES.has(contentType)) throw new Error('URL 返回内容不是支持的图片类型');
  if (!PHOTOBANK_UPLOAD_CONTENT_TYPES.has(contentType)) {
    throw new Error('URL 返回图片格式不受国际站图库上传支持');
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new Error(`图片超过 ${formatBytes(maxBytes)} 下载上限`);
  }

  if (!(response.data instanceof Uint8Array)) throw new Error('图片下载响应格式无效');
  const bytes = response.data;
  return {
    contentBase64: bytesToBase64(bytes),
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
  const third = octets[2] ?? 0;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false;
  const normalized = hostname.toLocaleLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89abcdef]/.test(normalized) || normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8') return true;
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  return mappedIpv4 !== undefined && isPrivateIpv4(mappedIpv4);
}

function ipv4FromMappedIpv6(hostname: string): string | undefined {
  const mapped = /^::ffff:(.+)$/.exec(hostname)?.[1];
  if (!mapped) return undefined;
  if (mapped.includes('.')) return mapped;
  const groups = mapped.split(':');
  if (groups.length !== 2) return undefined;
  const high = Number.parseInt(groups[0] ?? '', 16);
  const low = Number.parseInt(groups[1] ?? '', 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high > 0xffff || low > 0xffff) {
    return undefined;
  }
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
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

function canonicalImageFileName(fileName: string, contentType: string): string {
  const extension = photoFileExtension(contentType);
  const lastDot = fileName.lastIndexOf('.');
  const stem = (lastDot > 0 ? fileName.slice(0, lastDot) : fileName).trim();
  return `${stem || 'transferred-image'}.${extension}`;
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
