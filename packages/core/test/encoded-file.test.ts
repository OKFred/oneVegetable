import { describe, expect, it } from 'vitest';

import {
  decodeBase64,
  detectPhotoContentType,
  encodeBase64,
  PHOTO_CONTENT_TYPES,
  photoFileExtension,
  validateEncodedFile,
  validatePhotoBytes
} from '../src/encoded-file';

describe('validateEncodedFile', () => {
  it('validates a full 5 MiB file without overflowing the Base64 checker', () => {
    const bytes = new Uint8Array(5 * 1024 * 1024);
    bytes.set([0xff, 0xd8, 0xff]);
    const result = validateEncodedFile(
      {
        fileName: 'boundary.jpg',
        contentType: 'image/jpeg',
        byteLength: bytes.length,
        contentBase64: encodeBase64(bytes)
      },
      { maxBytes: bytes.length, requireImageSignature: true }
    );
    expect(result.length).toBe(bytes.length);
  });
  it.each(['A', 'AAA', 'AAAAA', 'A===', '=AAA', 'AA=A', 'AAAA==', 'AAA===', 'AA==AAAA', 'AAAA\n'])(
    'retains strict Base64 padding and quartet checks: %j',
    (contentBase64) => {
      expect(() =>
        validateEncodedFile({
          fileName: 'test.pdf',
          contentType: 'application/pdf',
          byteLength: 1,
          contentBase64
        })
      ).toThrow('纯 Base64');
    }
  );
  it('decodes a pure Base64 image and checks its declared size and signature', () => {
    const bytes = validateEncodedFile(
      {
        fileName: 'photo.jpg',
        contentBase64: '/9j/2Q==',
        contentType: 'image/jpeg',
        byteLength: 4
      },
      { allowedContentTypes: PHOTO_CONTENT_TYPES, requireImageSignature: true }
    );
    expect(bytes.byteLength).toBe(4);
  });

  it('rejects data URLs, forged byte lengths and mismatched image headers', () => {
    const base = {
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      byteLength: 4
    };
    expect(() => validateEncodedFile({ ...base, contentBase64: 'data:image/jpeg;base64,/9j/2Q==' })).toThrow(
      '纯 Base64'
    );
    expect(() => validateEncodedFile({ ...base, contentBase64: '/9j/2Q==', byteLength: 3 })).toThrow(
      '实际大小'
    );
    expect(() =>
      validateEncodedFile(
        { ...base, contentBase64: 'iVBORw==' },
        { allowedContentTypes: PHOTO_CONTENT_TYPES, requireImageSignature: true }
      )
    ).toThrow('文件头');
  });

  it('detects archive image bytes and safely round-trips Base64', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(detectPhotoContentType(bytes)).toBe('image/jpeg');
    expect(validatePhotoBytes(bytes)).toBe('image/jpeg');
    expect(photoFileExtension('image/jpeg')).toBe('jpg');
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    expect(() => validatePhotoBytes(Uint8Array.from([1, 2, 3]))).toThrow('图片文件头');
  });
});
