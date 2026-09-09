import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openNodeDatabase } from '../apps/api/src/db/node-database';
import {
  SqlS3StorageConfigurationRepository,
  S3StorageConfigurationCipher
} from '../apps/api/src/storage/s3-configuration';
import { parseS3StorageConfiguration, S3ObjectStorageClient } from '../packages/core/src/s3-storage';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_GALLERY_OSS_SMOKE !== '1')
  throw new Error('Explicit OSS smoke opt-in required');
const directory = resolve('artifacts/gallery-transfer-2.6/oss');
const database = openNodeDatabase(resolve('artifacts/s3-live-validation/ui.sqlite'));
const saved = await new SqlS3StorageConfigurationRepository(database.executor).find();
database.connection.close();
if (!saved) throw new Error('Existing encrypted OSS configuration is missing');
const key = (await readFile('.data/local-credential-encryption-key', 'utf8')).trim();
const stored = await (await S3StorageConfigurationCipher.create(key)).decrypt(saved);
if (stored.endpoint !== 'https://oss-s3.this-time.com' || stored.bucket !== 'dev')
  throw new Error('Unexpected remote smoke target');
const configuration = { ...stored, rootPrefix: `${stored.rootPrefix}/task-260-${crypto.randomUUID()}` };
await atomicWriteJson(resolve(directory, 'configuration.json'), configuration);
const source = parseS3StorageConfiguration(
  JSON.parse(await readFile('artifacts/gallery-transfer-2.6/rustfs-config.json', 'utf8')) as unknown
);
const sourceClient = new S3ObjectStorageClient(source);
const target = new S3ObjectStorageClient(configuration);
const files = (await sourceClient.listObjects({ prefix: 'source/', maximum: 10 })).items
  .filter((item) => item.key.endsWith('.png'))
  .slice(0, 2);
if (files.length !== 2) throw new Error('Verified local test sources are missing');
const receipts: { key: string; requestId: string; state: string; sha256: string | null }[] = [];
for (const file of files) {
  const data = await sourceClient.getObject(file.key);
  const requestId = crypto.randomUUID();
  receipts.push({ key: file.key, requestId, state: 'sending', sha256: null });
  await atomicWriteJson(resolve(directory, 'provision.json'), {
    endpoint: configuration.endpoint,
    bucket: configuration.bucket,
    prefix: configuration.rootPrefix,
    receipts
  });
  await target.putObject({
    key: file.key,
    bytes: data.bytes,
    contentType: data.contentType ?? 'image/png',
    requestId
  });
  const actual = await target.getObject(file.key);
  const sha256 = createHash('sha256').update(data.bytes).digest('hex');
  if (createHash('sha256').update(actual.bytes).digest('hex') !== sha256)
    throw new Error('Remote readback failed');
  receipts.push({ key: file.key, requestId, state: 'confirmed', sha256 });
}
await atomicWriteJson(resolve(directory, 'provision.json'), {
  status: 'passed',
  endpoint: configuration.endpoint,
  bucket: configuration.bucket,
  prefix: configuration.rootPrefix,
  receipts,
  deleted: false
});
console.log(
  'Two isolated OSS test objects verified. Configuration and receipts are in ignored artifacts/gallery-transfer-2.6/oss.'
);
