import type { SocialMediaStoredObject, SocialMediaStore } from './media-store';

interface R2ObjectLike {
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

export class R2SocialMediaStore implements SocialMediaStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { oneVegetableAsset: 'social-media' }
    });
  }

  async get(key: string): Promise<SocialMediaStoredObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream'
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
