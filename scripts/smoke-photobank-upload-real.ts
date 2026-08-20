import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { MAX_PHOTOBANK_IMAGE_BYTES } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_SMOKE !== '1') {
  throw new Error('真实图库上传 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PHOTO_UPLOAD_SMOKE=1');
}

const sourcePath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_FILE ?? 'apps/extension/public/icon.png'
);
const bytes = await readFile(sourcePath);
if (bytes.byteLength > MAX_PHOTOBANK_IMAGE_BYTES) {
  throw new Error('真实图库上传 Smoke 文件不能超过 5 MiB');
}

const credentialFile = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const credentialProvider = createNodeAlibabaCredentialProvider(
  {
    ...process.env,
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile
  },
  { workingDirectory: process.cwd() }
);
const gateway = new AlibabaReadGatewayClient(credentialProvider.requireCredentials(), { maxAttempts: 1 });
const extension = extname(sourcePath).toLocaleLowerCase();
const contentType = contentTypeForExtension(extension);
const fileName = `one-vegetable-smoke-${Date.now()}${extension}`;
const requestId = randomUUID();
if (process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_RECOVER === '1') {
  const recent = await gateway.request(
    'listPhotos',
    { page: 1, pageSize: 100, groupId: '-1' },
    { requestId }
  );
  const recovered = recent.items.find((photo) => photo.name.startsWith('one-vegetable-smoke-'));
  if (!recovered) throw new Error('没有找到可恢复的 one-vegetable-smoke 图库素材');
  await saveReport(recovered, requestId, 'recovered');
  process.stdout.write(`已恢复上一次真实上传结果，fileId=${recovered.id}\n`);
} else {
  const photo = await gateway.request(
    'uploadPhoto',
    {
      fileName,
      contentBase64: bytes.toString('base64'),
      contentType,
      byteLength: bytes.byteLength,
      ...(process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_GROUP_ID
        ? { groupId: process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_GROUP_ID }
        : {})
    },
    { requestId }
  );

  await saveReport(photo, requestId, 'passed');
  const reportPath = reportFilePath();
  process.stdout.write(`真实图库上传通过，fileId=${photo.id}；报告：${reportPath}\n`);
}

async function saveReport(
  photo: { id: string; name: string; url: string; fileSize: number },
  savedRequestId: string,
  status: 'passed' | 'recovered'
): Promise<void> {
  if (!photo.id || !photo.url.startsWith('https://')) {
    throw new Error('图库上传响应缺少 fileId 或 HTTPS URL');
  }
  await atomicWriteJson(reportFilePath(), {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    requestId: savedRequestId,
    method: 'alibaba.icbu.photobank.upload',
    status,
    createdAsset: {
      fileId: photo.id,
      fileName: photo.name,
      url: photo.url,
      byteLength: photo.fileSize
    }
  });
}

function reportFilePath(): string {
  return resolve(
    process.cwd(),
    process.env.ONE_VEGETABLE_REAL_PHOTO_UPLOAD_OUTPUT ?? 'artifacts/real-smoke/photobank-upload.json'
  );
}

function contentTypeForExtension(extension: string): string {
  const contentTypes: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif'
  };
  const contentType = contentTypes[extension];
  if (!contentType) throw new Error(`不支持用于真实 Smoke 的图片扩展名：${extension || '(none)'}`);
  return contentType;
}
