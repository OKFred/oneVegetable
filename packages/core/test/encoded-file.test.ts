import { describe, expect, it } from 'vitest';

import { PHOTO_CONTENT_TYPES, validateEncodedFile } from '../src/encoded-file';

describe('validateEncodedFile', () => {
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
});
