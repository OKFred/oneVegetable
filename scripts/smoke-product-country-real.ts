import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GatewayException } from '../packages/core/src/index';
import { AlibabaReadGatewayClient } from '../apps/api/src/gateway/alibaba-read-gateway';
import { createNodeAlibabaCredentialProvider } from '../apps/api/src/gateway/node-credential-bundle';
import { atomicWriteJson } from './openapi-auth/storage';

if (process.env.ONE_VEGETABLE_COUNTRY_SMOKE !== '1') throw new Error('Explicit opt-in required');
const provider = createNodeAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: resolve(
    process.env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ?? 'artifacts/openapi-auth/credentials.json'
  )
});
const gateway = new AlibabaReadGatewayClient(provider.requireCredentials(), { maxAttempts: 1 });
const requestId = randomUUID();
const method = 'alibaba.icbu.product.country.getcountrylist';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
let report: Record<string, unknown>;
try {
  const response = await gateway.request(
    'callCapability',
    { method, parameters: { country_request: { language: 'zh_cn' } } },
    { requestId }
  );
  const data = response.data;
  const continents =
    isRecord(data) && Array.isArray(data.data)
      ? data.data
      : isRecord(data) && isRecord(data.data) && Array.isArray(data.data.continent_d_t_o)
        ? data.data.continent_d_t_o
        : [];
  report = {
    requestId,
    traceId: response.traceId,
    contractValid: response.contractValid,
    contractIssues: response.contractIssues,
    passed: response.contractValid && isRecord(data) && data.biz_success === true && !data.msg_code,
    bizSuccess: isRecord(data) ? data.biz_success === true : false,
    msgCode: isRecord(data) && typeof data.msg_code === 'string' ? data.msg_code.slice(0, 100) : null,
    continentCount: continents.length,
    countryCount: continents.reduce(
      (total: number, item: unknown) =>
        total +
        (isRecord(item) && Array.isArray(item.country_list)
          ? item.country_list.length
          : isRecord(item) && isRecord(item.country_list) && Array.isArray(item.country_list.country_d_t_o)
            ? item.country_list.country_d_t_o.length
            : 0),
      0
    )
  };
} catch (error: unknown) {
  report = {
    requestId,
    passed: false,
    code: error instanceof GatewayException ? error.gatewayError.code : 'LOCAL_ERROR',
    subCode: error instanceof GatewayException ? (error.gatewayError.subCode ?? null) : null
  };
}
await atomicWriteJson(resolve(`artifacts/product-country-real/${requestId}.json`), {
  capturedAtUtc: new Date().toISOString(),
  method,
  sessionSent: true,
  ...report
});
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.passed) process.exitCode = 1;
