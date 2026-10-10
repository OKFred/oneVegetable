import { describe, expect, it, vi } from 'vitest';
import config from '../../../mock/data/template-library-s3.json';
import fixture from '../../../mock/data/template-library.json';
import { MemoryProductDescriptionTemplateClient } from '../../core/src/product-description-template-client';
import { importTemplateBundle, parseTemplateBundle } from '../../core/src/template-library';
import type { S3StorageControl } from '../../core/src/s3-storage';
import {
  prepareTemplateBackup,
  assertTemplateBackupContext,
  verifyTemplateBackup
} from '../src/lib/template-s3';

function storage() {
  return {
    s3StorageConfiguration: vi
      .fn<S3StorageControl['s3StorageConfiguration']>()
      .mockResolvedValue({ ...config }),
    getS3Object: vi.fn<S3StorageControl['getS3Object']>(),
    putS3Object: vi.fn<S3StorageControl['putS3Object']>(),
    listS3Objects: vi.fn<S3StorageControl['listS3Objects']>(),
    updateS3StorageConfiguration: vi.fn<S3StorageControl['updateS3StorageConfiguration']>(),
    clearS3StorageConfiguration: vi.fn<S3StorageControl['clearS3StorageConfiguration']>(),
    testS3StorageConnection: vi.fn<S3StorageControl['testS3StorageConnection']>()
  };
}
async function templates() {
  const client = new MemoryProductDescriptionTemplateClient();
  await importTemplateBundle(
    client,
    parseTemplateBundle(new TextEncoder().encode(JSON.stringify(fixture))),
    'skip'
  );
  return (await client.list()).items;
}
describe('S3 template packages', () => {
  it('uses a unique relative package path and refuses unconfigured/invalid destinations', async () => {
    const s3 = storage();
    const values = await templates();
    const first = await prepareTemplateBackup(s3, values, 'templates');
    const second = await prepareTemplateBackup(s3, values, 'templates');
    expect(first.key).toMatch(/^templates\/[a-f0-9-]+\/templates.json$/u);
    expect(first.key).not.toBe(second.key);
    expect(s3.putS3Object).not.toHaveBeenCalled();
    await expect(prepareTemplateBackup(s3, values, '../secret')).rejects.toThrow('TEMPLATE_PREFIX_INVALID');
    s3.s3StorageConfiguration.mockResolvedValue({ ...config, configured: false });
    await expect(prepareTemplateBackup(s3, values, 'templates')).rejects.toThrow('S3_NOT_CONFIGURED');
  });
  it('checks identity and S3 revision before writing or verifying', async () => {
    const s3 = storage();
    const plan = await prepareTemplateBackup(s3, await templates(), 'templates');
    await expect(assertTemplateBackupContext(s3, plan, () => false)).rejects.toThrow(
      'TEMPLATE_CONTEXT_CHANGED'
    );
    s3.s3StorageConfiguration.mockResolvedValue({ ...config, revision: 2 });
    await expect(verifyTemplateBackup(s3, plan, () => true)).rejects.toThrow('TEMPLATE_CONTEXT_CHANGED');
    expect(s3.getS3Object).not.toHaveBeenCalled();
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });
  it('requires exact bytes on readback and never resends an unknown write', async () => {
    const s3 = storage();
    const plan = await prepareTemplateBackup(s3, await templates(), 'templates');
    s3.getS3Object.mockResolvedValue({
      key: plan.key,
      bytes: new Uint8Array([1]),
      contentType: 'application/json',
      etag: null
    });
    await expect(verifyTemplateBackup(s3, plan, () => true)).rejects.toThrow('TEMPLATE_BACKUP_UNCONFIRMED');
    s3.getS3Object.mockResolvedValue({
      key: plan.key,
      bytes: plan.bytes,
      contentType: 'application/json',
      etag: null
    });
    await verifyTemplateBackup(s3, plan, () => true);
    expect(s3.putS3Object).not.toHaveBeenCalled();
  });
});
