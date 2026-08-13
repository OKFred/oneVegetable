import { describe, expect, it, vi } from 'vitest';

import { assertPublicPhotoUrl, downloadPhotoForUpload } from '../src/photo-transfer';

describe('PhotoBank URL transfer safety', () => {
  it.each([
    'http://localhost/image.jpg',
    'http://127.0.0.1/image.jpg',
    'http://10.0.0.2/image.jpg',
    'http://172.16.4.2/image.jpg',
    'http://192.168.1.2/image.jpg',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/image.jpg',
    'http://[fe80::1]/image.jpg',
    'http://[::ffff:127.0.0.1]/image.jpg',
    'http://[::ffff:10.0.0.1]/image.jpg',
    'http://[2001:db8::1]/image.jpg',
    'http://198.51.100.2/image.jpg',
    'http://203.0.113.2/image.jpg',
    'https://user:password@example.com/image.jpg',
    'file:///tmp/image.jpg'
  ])('rejects unsafe URL %s', (url) => {
    expect(() => assertPublicPhotoUrl(url)).toThrow();
  });

  it('rejects a redirect into a private address before following it', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private.jpg' } })
      );
    await expect(
      downloadPhotoForUpload({ url: 'https://images.example.com/public.jpg', groupId: '2002' }, fetcher)
    ).rejects.toThrow('私网');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects non-image responses and declared or streamed oversize content', async () => {
    await expect(
      downloadPhotoForUpload(
        { url: 'https://images.example.com/file', groupId: '2002' },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })
          )
      )
    ).rejects.toThrow('不是支持的图片类型');

    await expect(
      downloadPhotoForUpload(
        { url: 'https://images.example.com/large.jpg', groupId: '2002', maxBytes: 4 },
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3, 4, 5]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' }
          })
        )
      )
    ).rejects.toThrow('超过');
  });

  it('returns a bounded base64 payload for PhotoBank upload', async () => {
    const result = await downloadPhotoForUpload(
      {
        url: 'https://images.example.com/path/detail.png',
        groupId: '2002'
      },
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '4' }
        })
      )
    );
    expect(result).toEqual({
      file: 'iVBORw==',
      fileName: 'detail.png',
      groupId: '2002',
      contentType: 'image/png',
      byteLength: 4
    });
  });
});
