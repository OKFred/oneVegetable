import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { sanitizeDiagnosticMessage, type PhotoGroupOperationRequest } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PHOTO_GROUP_SMOKE !== '1') {
  throw new Error('真实图库分组 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PHOTO_GROUP_SMOKE=1');
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
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PHOTO_GROUP_OUTPUT ?? 'artifacts/real-smoke/photobank-group.json'
);
const baseName = `one-vegetable-smoke-${Date.now()}`;
const renamedName = `${baseName}-renamed`;
const parentId = optionalNonEmpty(process.env.ONE_VEGETABLE_REAL_PHOTO_GROUP_PARENT_ID);
const requestIds: string[] = [];
let createdGroupId: string | null = null;
let cleanupSucceeded = false;

try {
  const created = await operate({
    operation: 'add',
    groupId: parentId,
    groupName: baseName
  });
  if (created.group?.name !== baseName) throw new Error('新增分组响应与请求不一致');
  createdGroupId = created.groupId;

  const renamed = await operate({
    operation: 'rename',
    groupId: createdGroupId,
    groupName: renamedName
  });
  if (renamed.groupId !== createdGroupId || renamed.group?.name !== renamedName) {
    throw new Error('重命名分组响应与请求不一致');
  }

  const deleted = await operate({
    operation: 'delete',
    groupId: createdGroupId,
    groupName: null
  });
  if (deleted.groupId !== createdGroupId) throw new Error('删除分组响应缺少目标分组 ID');
  createdGroupId = null;
  cleanupSucceeded = true;

  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    method: 'alibaba.icbu.photobank.group.operate',
    status: 'passed',
    operations: ['add', 'rename', 'delete'],
    parentKind: parentId ? 'configured-group' : 'root',
    requestIds,
    cleanupSucceeded
  });
  process.stdout.write(`真实图库分组操作通过，临时分组已删除；报告：${reportPath}\n`);
} catch (error: unknown) {
  if (createdGroupId) {
    try {
      await operate({ operation: 'delete', groupId: createdGroupId, groupName: null });
      cleanupSucceeded = true;
      createdGroupId = null;
    } catch {
      cleanupSucceeded = false;
    }
  }
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    method: 'alibaba.icbu.photobank.group.operate',
    status: 'failed',
    requestIds,
    cleanupSucceeded,
    cleanupRequired: createdGroupId !== null,
    error: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
  });
  throw new Error(`真实图库分组 Smoke 失败；脱敏报告：${reportPath}`, { cause: error });
}

async function operate(request: PhotoGroupOperationRequest) {
  const requestId = randomUUID();
  requestIds.push(requestId);
  return gateway.request('operatePhotoGroup', request, { requestId });
}

function optionalNonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}
