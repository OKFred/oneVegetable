import { GatewayException } from './errors';
import type { GatewayCredentials } from './types';
import type { S3StorageConfiguration } from './s3-storage';
import { validGalleryTransferContext, type GalleryTransferContext } from './gallery-transfer-task';
import { validateGalleryTransferContext } from './generated/validators-gallery';

export interface GalleryRequestOptions {
  requestId?: string;
  galleryContext?: GalleryTransferContext;
}
export async function opaqueGalleryId(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function keyedId(secret: string, value: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret || 'unconfigured'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function galleryGatewayId(credentials: GatewayCredentials): Promise<string> {
  return keyedId(credentials.appSecret, [
    'gallery-gateway-v1',
    credentials.endpoint,
    credentials.appKey,
    credentials.galleryAccountGeneration ?? credentials.accessToken
  ]);
}
export function galleryStorageId(configuration: S3StorageConfiguration): Promise<string> {
  return keyedId(configuration.secretAccessKey, ['gallery-storage-v1', configuration]);
}
export function requireGalleryContext(value: unknown): GalleryTransferContext {
  if (!validateGalleryTransferContext(value) || !validGalleryTransferContext(value))
    throw new GatewayException({
      code: 'GALLERY_CONTEXT_INVALID',
      message: 'GALLERY_CONTEXT_INVALID',
      retryable: false
    });
  return value;
}
export function assertGalleryContextId(expected: string | null | undefined, actual: string | null): void {
  if (expected !== undefined && expected !== actual)
    throw new GatewayException({
      code: 'GALLERY_CONTEXT_CHANGED',
      message: 'GALLERY_CONTEXT_CHANGED',
      retryable: false
    });
}
