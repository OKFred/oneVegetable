import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { GatewayException, getCapabilityDefinition, listCapabilities } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';
import {
  collectSmokeIdentifiers,
  EMPTY_IDENTIFIERS,
  isNoData,
  planSmokeRequest,
  responseShape,
  sortSmokeMethods
} from './real-smoke/planner';

type SmokeStatus =
  'passed' | 'no-data' | 'permission-denied' | 'contract-drift' | 'provider-error' | 'skipped-prerequisite';

interface SmokeResult {
  method: string;
  domain: string;
  requestId: string;
  status: SmokeStatus;
  errorCode: string | null;
  errorSubCode: string | null;
  traceId: string | null;
  contractIssues: { instancePath: string; message: string }[];
  responseShape: unknown;
}

if (existsSync('.env')) loadEnvFile('.env');
if (process.env.ONE_VEGETABLE_REAL_SMOKE !== '1') {
  throw new Error('真实 Smoke 必须显式设置 ONE_VEGETABLE_REAL_SMOKE=1');
}

const credentialFile = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
    process.env.OPEN_API_OUTPUT ??
    'artifacts/openapi-auth/credentials.json'
);
const reportPath = resolve(
  process.cwd(),
  process.env.ONE_VEGETABLE_REAL_SMOKE_OUTPUT ?? 'artifacts/real-smoke/report.json'
);
const credentialProvider = createNodeAlibabaCredentialProvider(
  {
    ...process.env,
    ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile
  },
  { workingDirectory: process.cwd() }
);
const gateway = new AlibabaReadGatewayClient(credentialProvider.requireCredentials(), { maxAttempts: 1 });
const candidates = sortSmokeMethods(
  listCapabilities().filter(
    (capability) =>
      capability.enabled &&
      capability.lifecycle === 'active' &&
      capability.risk === 'read' &&
      capability.realCallEnabled &&
      !capability.restricted
  )
);

let identifiers = { ...EMPTY_IDENTIFIERS };
const results: SmokeResult[] = [];

for (const capability of candidates) {
  const requestId = randomUUID();
  const definition = getCapabilityDefinition(capability.method);
  if (!definition) {
    results.push(
      result(capability.method, capability.domain, requestId, 'provider-error', 'DEFINITION_MISSING')
    );
    continue;
  }
  const plan = planSmokeRequest(capability.method, definition.requestExample, identifiers);
  if (plan.kind === 'skip') {
    results.push(
      result(capability.method, capability.domain, requestId, 'skipped-prerequisite', plan.reasonCode)
    );
    continue;
  }

  try {
    const response = await gateway.request(
      'callCapability',
      { method: capability.method, parameters: plan.parameters },
      { requestId }
    );
    identifiers = collectSmokeIdentifiers(response.data, identifiers);
    const status: SmokeStatus = !response.contractValid
      ? 'contract-drift'
      : isNoData(response.data)
        ? 'no-data'
        : 'passed';
    results.push({
      method: capability.method,
      domain: capability.domain,
      requestId,
      status,
      errorCode: null,
      errorSubCode: null,
      traceId: response.traceId,
      contractIssues: response.contractIssues.map((issue) => ({
        instancePath: issue.instancePath,
        message: issue.message
      })),
      responseShape: responseShape(response.data)
    });
  } catch (error) {
    const gatewayError = error instanceof GatewayException ? error.gatewayError : null;
    const errorCode = gatewayError?.code ?? 'UNEXPECTED_ERROR';
    results.push({
      ...result(
        capability.method,
        capability.domain,
        requestId,
        permissionCode(errorCode) ? 'permission-denied' : 'provider-error',
        errorCode
      ),
      errorSubCode: gatewayError?.subCode ?? null,
      traceId: gatewayError?.traceId ?? null
    });
  }
  process.stdout.write(`${capability.method}: ${results.at(-1)?.status ?? 'provider-error'}\n`);
  await wait(300);
}

const counts = Object.fromEntries(
  [...new Set(results.map((item) => item.status))]
    .sort()
    .map((status) => [status, results.filter((item) => item.status === status).length])
);
await atomicWriteJson(reportPath, {
  schemaVersion: 1,
  capturedAtUtc: new Date().toISOString(),
  gatewaySource: credentialProvider.status().source,
  candidateCount: candidates.length,
  counts,
  results
});
process.stdout.write(`真实只读 Smoke 报告已保存：${reportPath}\n`);
if (results.some((item) => item.status === 'contract-drift' || item.status === 'provider-error')) {
  process.exitCode = 1;
}

function result(
  method: string,
  domain: string,
  requestId: string,
  status: SmokeStatus,
  errorCode: string
): SmokeResult {
  return {
    method,
    domain,
    requestId,
    status,
    errorCode,
    errorSubCode: null,
    traceId: null,
    contractIssues: [],
    responseShape: null
  };
}

function permissionCode(code: string): boolean {
  return /permission|authorize|access|isv|scope|insufficient|forbidden/i.test(code);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
