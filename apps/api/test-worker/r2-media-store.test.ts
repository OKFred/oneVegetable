import { env } from 'cloudflare:workers';
import { describe, it } from 'vitest';
import { R2SocialMediaStore } from '../src/social-meta/r2-media-store';

describe('R2SocialMediaStore in workerd', () => {
  it('round-trips private social media bytes and metadata through the real R2 binding', async ({
    expect
  }) => {
    const bucket = env.SOCIAL_MEDIA;
    const store = new R2SocialMediaStore(bucket);
    const key = `social-media/workerd-${crypto.randomUUID()}.jpg`;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x01, 0x02, 0x03]);

    await store.put(key, bytes, 'image/jpeg');

    const stored = await store.get(key);
    expect(stored?.contentType).toBe('image/jpeg');
    expect(stored?.bytes).toEqual(bytes);

    const rawObject = await bucket.get(key);
    expect(rawObject?.customMetadata).toEqual({ oneVegetableAsset: 'social-media' });

    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
});
