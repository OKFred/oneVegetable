import { describe, expect, it } from 'vitest';

import { encodeBase64, readImageDimensions, validateSocialImagePayload } from '../src';

describe('social media image validation', () => {
  it('reads PNG dimensions and accepts Facebook PNG images', () => {
    const bytes = pngHeader(1200, 1000);
    expect(readImageDimensions(bytes, 'image/png')).toEqual({ width: 1200, height: 1000 });
    expect(
      validateSocialImagePayload(
        {
          fileName: 'sample.png',
          contentType: 'image/png',
          byteLength: bytes.byteLength,
          contentBase64: encodeBase64(bytes)
        },
        'facebook'
      )
    ).toMatchObject({ width: 1200, height: 1000, contentType: 'image/png' });
  });

  it('reads JPEG dimensions and enforces Instagram JPEG and ratio limits', () => {
    const bytes = jpegHeader(1080, 1350);
    expect(readImageDimensions(bytes, 'image/jpeg')).toEqual({ width: 1080, height: 1350 });
    expect(
      validateSocialImagePayload(
        {
          fileName: 'sample.jpg',
          contentType: 'image/jpeg',
          byteLength: bytes.byteLength,
          contentBase64: encodeBase64(bytes)
        },
        'instagram'
      )
    ).toMatchObject({ width: 1080, height: 1350 });

    const tooTall = jpegHeader(1080, 1600);
    expect(() =>
      validateSocialImagePayload(
        {
          fileName: 'too-tall.jpg',
          contentType: 'image/jpeg',
          byteLength: tooTall.byteLength,
          contentBase64: encodeBase64(tooTall)
        },
        'instagram'
      )
    ).toThrow('宽高比');
  });

  it('rejects PNG for Instagram before any platform call', () => {
    const bytes = pngHeader(1080, 1080);
    expect(() =>
      validateSocialImagePayload(
        {
          fileName: 'sample.png',
          contentType: 'image/png',
          byteLength: bytes.byteLength,
          contentBase64: encodeBase64(bytes)
        },
        'instagram'
      )
    ).toThrow('不支持的文件类型');
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xd9
  ]);
}
