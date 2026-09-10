import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GatewayException, getCapabilityDefinition } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_TEXT_TRANS_SMOKE !== '1') throw new Error('Explicit opt-in required');
const file = resolve(
  process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
);
const bundle: unknown = JSON.parse(await readFile(file, 'utf8'));
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const appName =
  process.env.ONE_VEGETABLE_TRANSLATION_APP_NAME ??
  (record(bundle) && record(bundle.application) && typeof bundle.application.appName === 'string'
    ? bundle.application.appName
    : '');
if (!appName.trim()) throw new Error('Translation app_name is required');
const definition = getCapabilityDefinition('alibaba.icbu.text.trans');
if (!definition) throw new Error('Translation contract is missing');
const provider = createNodeAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: file });
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const requestId = randomUUID();
let report: Record<string, unknown>;
try {
  const response = await gateway.request(
    'callCapability',
    {
      method: 'alibaba.icbu.text.trans',
      parameters: {
        icbu_translate_task_dto: [
          {
            trans_engine: 'ALI_TRANS',
            target_language: 'es',
            app_name: appName,
            source_text: 'A cotton T-shirt.',
            format: 'text',
            field_type: 'title',
            source_language: 'en'
          }
        ]
      }
    },
    { requestId }
  );
  const results = record(response.data) && Array.isArray(response.data.result) ? response.data.result : [];
  const items = results.map((item: unknown) =>
    record(item)
      ? {
          success: item.success === true,
          translated: typeof item.translate_result_text === 'string' ? item.translate_result_text : null,
          errorCode:
            record(item.error_code) && typeof item.error_code.code === 'string' ? item.error_code.code : null,
          errorMessage:
            record(item.error_code) && typeof item.error_code.display_text === 'string'
              ? item.error_code.display_text.slice(0, 300)
              : null
        }
      : { success: false }
  );
  report = {
    requestId,
    traceId: response.traceId,
    contractValid: response.contractValid,
    contractIssues: response.contractIssues,
    passed:
      response.contractValid &&
      items.length === 1 &&
      items.every((item) => item.success && 'translated' in item && item.translated && !item.errorCode),
    items
  };
} catch (error: unknown) {
  report = {
    requestId,
    passed: false,
    code: error instanceof GatewayException ? error.gatewayError.code : 'LOCAL_ERROR',
    subCode: error instanceof GatewayException ? (error.gatewayError.subCode ?? null) : null
  };
}
await atomicWriteJson(resolve('artifacts/text-trans-real/report.json'), {
  capturedAtUtc: new Date().toISOString(),
  method: definition.method,
  appNameSource: process.env.ONE_VEGETABLE_TRANSLATION_APP_NAME
    ? 'explicit-business-scenario'
    : 'application-name-unconfirmed-scenario',
  sessionSent: false,
  ...report
});
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.passed) process.exitCode = 1;
