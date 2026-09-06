import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import {
  GatewayException,
  sanitizeDiagnosticMessage,
  type OperationId,
  type ProductGroup,
  type RequestOf,
  type ResponseOf
} from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_PRODUCT_GROUP_SMOKE !== '1') {
  throw new Error(
    '真实商品分组新增 Smoke 必须显式设置 ONE_VEGETABLE_REAL_PRODUCT_GROUP_SMOKE=1；测试分组会保留在当前国际站账号中'
  );
}

const credentialFile = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const credentialProvider = createNodeAlibabaCredentialProvider(
  { ...process.env, ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile },
  { workingDirectory: process.cwd() }
);
const gateway = new AlibabaReadGatewayClient(credentialProvider.requireCredentials(), { maxAttempts: 1 });
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_PRODUCT_GROUP_OUTPUT ??
    'artifacts/real-smoke/product-group-create-20260906.json'
);
const groupName =
  nonEmpty(process.env.ONE_VEGETABLE_REAL_PRODUCT_GROUP_NAME) ?? 'oneVegetable Smoke 2026-09-06';
const configuredParentId = optionalInteger(process.env.ONE_VEGETABLE_REAL_PRODUCT_GROUP_PARENT_ID);
let targetParentId = configuredParentId ?? -1;
const requests: { operation: OperationId; requestId: string; outcome: 'success' | 'error' }[] = [];

await main();

async function main(): Promise<void> {
  try {
    const existing = await findExistingGroup();
    if (existing) {
      targetParentId = existing.parentId;
      await writeReport('passed-existing', existing.group, false);
      process.stdout.write(`商品分组已存在并通过列表回读：${existing.group.name} (${existing.group.id})。\n`);
      process.stdout.write(`脱敏报告：${reportPath}\n`);
      return;
    }

    await writeReport('create-started', null, true);
    let created: ProductGroup;
    try {
      created = await call('createProductGroup', { name: groupName, parentId: targetParentId });
    } catch (error: unknown) {
      if (configuredParentId !== null || !isTopLevelLimit(error)) throw error;
      targetParentId = await selectFallbackParentId();
      const childExisting = await findGroup(targetParentId);
      if (childExisting) {
        await writeReport('passed-existing', childExisting, false);
        process.stdout.write(
          `根分组已满；子分组已存在并通过列表回读：${childExisting.name} (${childExisting.id})。\n`
        );
        process.stdout.write(`脱敏报告：${reportPath}\n`);
        return;
      }
      created = await call('createProductGroup', { name: groupName, parentId: targetParentId });
    }
    if (created.name !== groupName || !Number.isSafeInteger(created.id) || created.id <= 0) {
      throw new Error('商品分组新增响应与请求不一致');
    }

    const verified = await pollForGroup(created.id);
    await writeReport('passed', verified, true);
    process.stdout.write(`真实商品分组新增与列表回读通过：${verified.name} (${verified.id})。\n`);
    process.stdout.write('按约定保留该测试分组，不执行删除。\n');
    process.stdout.write(`脱敏报告：${reportPath}\n`);
  } catch (error: unknown) {
    const recovered = await findGroup(targetParentId).catch(() => null);
    if (recovered) {
      await writeReport('passed-after-uncertain-response', recovered, true);
      process.stdout.write(`请求结果不确定，但列表已回读到测试分组：${recovered.name} (${recovered.id})。\n`);
      process.stdout.write(`脱敏报告：${reportPath}\n`);
      return;
    }
    await atomicWriteJson(reportPath, {
      schemaVersion: 1,
      capturedAtUtc: new Date().toISOString(),
      status: 'failed',
      groupName,
      parentId: targetParentId,
      mutationAttempted: true,
      retained: false,
      requests,
      error: errorRecord(error)
    });
    throw new Error(`真实商品分组新增 Smoke 失败；脱敏报告：${reportPath}`, { cause: error });
  }
}

async function findExistingGroup(): Promise<{ group: ProductGroup; parentId: number } | null> {
  if (configuredParentId !== null) {
    const group = await findGroup(configuredParentId);
    return group ? { group, parentId: configuredParentId } : null;
  }
  const rootMatch = await findGroup(-1);
  if (rootMatch) return { group: rootMatch, parentId: -1 };
  const roots = await listGroups(-1);
  for (const root of roots) {
    const childMatch = await findGroup(root.id);
    if (childMatch) return { group: childMatch, parentId: root.id };
  }
  return null;
}

async function findGroup(parentId: number): Promise<ProductGroup | null> {
  const groups = await listGroups(parentId);
  return groups.find((group) => group.name === groupName) ?? null;
}

function listGroups(parentId: number): Promise<ProductGroup[]> {
  return call('listProductGroups', { parentId });
}

async function selectFallbackParentId(): Promise<number> {
  const roots = await listGroups(-1);
  if (roots.length === 0) throw new Error('一级分组已满，但平台未返回可用于新增子分组的父级');
  const candidates = await Promise.all(
    roots.map(async (root) => ({
      id: root.id,
      preferred: /one.?vegetable|smoke|test/iu.test(root.name),
      childCount: (await listGroups(root.id)).length
    }))
  );
  const selected = candidates.toSorted(
    (left, right) =>
      Number(right.preferred) - Number(left.preferred) ||
      left.childCount - right.childCount ||
      left.id - right.id
  )[0];
  if (!selected) throw new Error('没有找到可用于新增测试子分组的父级');
  return selected.id;
}

async function pollForGroup(expectedId: number): Promise<ProductGroup> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const group = await findGroup(targetParentId);
    if (group?.id === expectedId) return group;
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 2_000));
  }
  throw new Error('商品分组已返回成功，但未在限定时间内通过列表回读');
}

async function call<K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> {
  const requestId = randomUUID();
  try {
    const result = await gateway.request(operation, payload, { requestId });
    requests.push({ operation, requestId, outcome: 'success' });
    return result;
  } catch (error: unknown) {
    requests.push({ operation, requestId, outcome: 'error' });
    throw error;
  }
}

async function writeReport(
  status: string,
  group: ProductGroup | null,
  mutationAttempted: boolean
): Promise<void> {
  await atomicWriteJson(reportPath, {
    schemaVersion: 1,
    capturedAtUtc: new Date().toISOString(),
    status,
    groupName,
    parentId: targetParentId,
    groupId: group?.id ?? null,
    mutationAttempted,
    retained: group !== null,
    requests
  });
}

function isTopLevelLimit(error: unknown): boolean {
  return error instanceof GatewayException && error.gatewayError.subCode === 'GROUP_TOP_COUNT_TOO_MORE';
}

function errorRecord(error: unknown): Record<string, unknown> {
  if (error instanceof GatewayException) {
    return {
      code: error.gatewayError.code,
      subCode: error.gatewayError.subCode ?? null,
      traceId: error.gatewayError.traceId ?? null,
      message: sanitizeDiagnosticMessage(error.gatewayError.message)
    };
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: sanitizeDiagnosticMessage(error instanceof Error ? error.message : '未知错误')
  };
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function optionalInteger(value: string | undefined): number | null {
  const normalized = nonEmpty(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < -1) {
    throw new Error('商品分组父级 ID 必须为不小于 -1 的安全整数');
  }
  return parsed;
}
