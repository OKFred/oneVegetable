import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { NetworkManager } from '../packages/core/src/network';
import { S3ObjectStorageClient, parseS3StorageConfiguration } from '../packages/core/src/s3-storage';
import { atomicWriteJson } from './openapi-auth/storage';

// Local-only, opt-in provisioning. Never deletes remote objects or calls Alibaba.
if (process.env.ONE_VEGETABLE_RUSTFS_SMOKE !== '1') throw new Error('Explicit RustFS smoke opt-in required');
const configurationPath = process.env.ONE_VEGETABLE_RUSTFS_CONFIGURATION;
if (!configurationPath) throw new Error('Set the ignored local configuration path');
const raw: unknown = JSON.parse(await readFile(configurationPath, 'utf8'));
const configuration = parseS3StorageConfiguration(raw);
if (!configuration.allowInsecureLocal || !configuration.endpoint.startsWith('http://'))
  throw new Error('This provisioning command is restricted to explicitly allowed local RustFS');
if (!configuration.bucket.startsWith('onevegetable-test-'))
  throw new Error('An isolated test bucket is required');
const directory = resolve('artifacts/gallery-transfer-2.6', configuration.bucket);
const bucketUrl = `${configuration.endpoint}/${configuration.bucket}`;
const signer = new AwsClient({
  accessKeyId: configuration.accessKeyId,
  secretAccessKey: configuration.secretAccessKey,
  region: configuration.region,
  service: 's3',
  retries: 0
});
const network = new NetworkManager({
  policies: {
    s3: {
      allowedOrigins: [configuration.endpoint],
      redirect: 'error',
      cache: 'no-store'
    }
  }
});
const receipts: { action: string; requestId: string; status: string; statusCode?: number }[] = [];
async function bucketRequest(method: 'HEAD' | 'PUT') {
  const requestId = crypto.randomUUID();
  receipts.push({ action: `bucket-${method}`, requestId, status: 'sending' });
  await atomicWriteJson(resolve(directory, 'provision.json'), { bucket: configuration.bucket, receipts });
  const signed = await signer.sign(bucketUrl, { method });
  const response = await network.request({
    service: 's3',
    url: signed.url,
    method,
    headers: Object.fromEntries(signed.headers),
    responseType: 'text',
    requestId,
    maxAttempts: 1
  });
  receipts.push({
    action: `bucket-${method}`,
    requestId,
    status: response.ok ? 'confirmed' : 'failed',
    statusCode: response.status
  });
  await atomicWriteJson(resolve(directory, 'provision.json'), { bucket: configuration.bucket, receipts });
  return response;
}
const exists = await bucketRequest('HEAD');
if (exists.status === 404) {
  const created = await bucketRequest('PUT');
  if (!created.ok)
    throw new Error(`Bucket creation failed (${created.status}); inspect redacted receipts before retrying`);
} else if (!exists.ok) throw new Error(`Bucket access denied (${exists.status})`);
const client = new S3ObjectStorageClient(configuration);
const run = crypto.randomUUID();
const sources: { key: string; byteLength: number; sha256: string; etag: string | null }[] = [];
for (let index = 0; index < 2; index++) {
  const bytes = testPng();
  const key = `source/${run}/sample-${index + 1}.png`;
  const requestId = crypto.randomUUID();
  receipts.push({ action: 'source-put', requestId, status: 'sending' });
  await atomicWriteJson(resolve(directory, 'provision.json'), { bucket: configuration.bucket, receipts });
  await client.putObject({ key, bytes, contentType: 'image/png', requestId });
  const read = await client.getObject(key);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (createHash('sha256').update(read.bytes).digest('hex') !== sha256)
    throw new Error('S3 readback differs');
  sources.push({ key, byteLength: bytes.byteLength, sha256, etag: read.etag });
  receipts.push({ action: 'source-put', requestId, status: 'confirmed' });
}
await atomicWriteJson(resolve(directory, 'provision.json'), {
  capturedAtUtc: new Date().toISOString(),
  endpoint: configuration.endpoint,
  bucket: configuration.bucket,
  rootPrefix: configuration.rootPrefix,
  sources,
  receipts,
  deleted: false,
  alibabaRequests: 0
});
console.log(`RustFS bucket and ${sources.length} images verified. Report: ${directory}/provision.json`);

/** Non-sensitive, unique test pixels; no third-party imagery or account data. */
function testPng(): Uint8Array {
  const width = 400;
  const raw = Buffer.alloc((width * 3 + 1) * width);
  const seed = randomBytes(3);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw[offset] = ((seed[0] ?? 0) + x) % 256;
      raw[offset + 1] = ((seed[1] ?? 0) + y) % 256;
      raw[offset + 2] = ((seed[2] ?? 0) + x + y) % 256;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 2;
  function chunk(type: string, data: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
