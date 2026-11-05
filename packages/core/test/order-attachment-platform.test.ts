import { describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../src/encoded-file';
import {
  ORDER_ATTACHMENT_LIMIT,
  uploadOrderAttachmentPlatform,
  validateOrderAttachmentFile
} from '../src/order-attachment-platform';

function file(
  contentType = 'application/pdf',
  fileName = 'test.pdf',
  bytes = Uint8Array.of(37, 80, 68, 70, 45, 49)
) {
  return { fileName, contentType, contentBase64: encodeBase64(bytes), byteLength: bytes.length };
}
describe('order attachment file boundary', () => {
  it('sends one native file part and reports a filepath, not an order association', async () => {
    const callWithFile = vi.fn().mockResolvedValue({
      method: '/alibaba/order/attachment/upload',
      data: { code: '0', value: 'attachments/fixture.pdf', request_id: 'fixture-trace' }
    });
    await expect(uploadOrderAttachmentPlatform({ callWithFile }, file())).resolves.toEqual({
      reference: 'attachments/fixture.pdf',
      traceId: 'fixture-trace'
    });
    expect(callWithFile).toHaveBeenCalledExactlyOnceWith(
      '/alibaba/order/attachment/upload',
      { file_name: 'test.pdf' },
      expect.objectContaining({ fieldName: 'data', fileName: 'test.pdf', contentType: 'application/pdf' })
    );
  });
  it.each([
    { code: '1', value: 'path' },
    { code: '0' },
    { code: '0', value: '' },
    { code: '0', value: 'https://example.com/secret?token=private' },
    { code: '0', value: '../escape' }
  ])('does not infer success or retry ambiguous responses %j', async (data) => {
    const callWithFile = vi.fn().mockResolvedValue({ method: '/alibaba/order/attachment/upload', data });
    await expect(uploadOrderAttachmentPlatform({ callWithFile }, file())).rejects.toThrow(
      'ORDER_ATTACHMENT_RESPONSE_INVALID'
    );
    expect(callWithFile).toHaveBeenCalledTimes(1);
  });
  it('accepts the documented types with matching extensions and signatures', () => {
    expect(validateOrderAttachmentFile(file()).length).toBe(6);
    expect(
      validateOrderAttachmentFile(
        file('image/png', 'test.png', Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10))
      ).length
    ).toBe(8);
    expect(
      validateOrderAttachmentFile(file('image/jpeg', 'test.jpeg', Uint8Array.of(255, 216, 255, 224))).length
    ).toBe(4);
    expect(
      validateOrderAttachmentFile(
        file('application/msword', 'test.doc', Uint8Array.of(208, 207, 17, 224, 161, 177, 26, 225))
      ).length
    ).toBe(8);
  });
  it.each([
    { fileName: 'test.jpg' },
    { contentType: 'text/html' },
    { byteLength: 9 },
    { contentBase64: 'data:application/pdf;base64,AAAA' },
    { contentBase64: 'AAAA', byteLength: 3 },
    { fileName: '../test.pdf' },
    { fileName: 'test\r\n.pdf' },
    { fileName: ' test.pdf' },
    { contentBase64: '', byteLength: 0 }
  ])('rejects mismatched, empty and unsafe payloads %j', (change) => {
    expect(() => validateOrderAttachmentFile({ ...file(), ...change })).toThrow(
      'ORDER_ATTACHMENT_FILE_INVALID'
    );
  });
  it('rejects files above 5 MB', () => {
    const bytes = new Uint8Array(ORDER_ATTACHMENT_LIMIT + 1);
    bytes.set([37, 80, 68, 70, 45]);
    expect(() => validateOrderAttachmentFile(file('application/pdf', 'test.pdf', bytes))).toThrow(
      'ORDER_ATTACHMENT_FILE_INVALID'
    );
  });
  it('accepts exactly 5 MB rather than failing its Base64 scan', () => {
    const bytes = new Uint8Array(ORDER_ATTACHMENT_LIMIT);
    bytes.set([37, 80, 68, 70, 45]);
    expect(validateOrderAttachmentFile(file('application/pdf', 'boundary.pdf', bytes)).length).toBe(
      ORDER_ATTACHMENT_LIMIT
    );
  });
});
