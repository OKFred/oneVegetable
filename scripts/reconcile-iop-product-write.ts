/** Read-only reconciliation; one explicitly confirmed restoration, never a repeated original write. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT, isRecord } from '../packages/core/src/alibaba-iop';
import {
  createIopBusinessRequest,
  normalizeIopBusinessResponse
} from '../packages/core/src/alibaba-iop-business';
import { normalizeGatewayError } from '../packages/core/src/errors';
import { NetworkManager } from '../packages/core/src/network';
import { ProductAdapter } from '../packages/core/src/product-adapter';
import {
  parseProductSchemaXml,
  withProductSchemaFieldText,
  markProductSchemaFieldTouched,
  inspectProductSchemaPatchSerialization
} from '../packages/core/src/product-schema';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = arg('credential');
const receipt = arg('receipt');
const maxChecks = Number(arg('max-checks') ?? 60);
assert(Number.isInteger(maxChecks) && maxChecks >= 1 && maxChecks <= 60, 'max-checks must be 1–60');
assert(
  file &&
    typeof receipt === 'string' &&
    receipt.replaceAll('\\', '/').startsWith('artifacts/iop-product-write-validation/')
);
const path = resolve(receipt);
const receiptRelative = relative(resolve('artifacts/iop-product-write-validation'), path);
assert(
  receiptRelative !== '' && !receiptRelative.startsWith('..') && !isAbsolute(receiptRelative),
  'Receipt must remain inside the ignored IOP acceptance directory.'
);
const report: unknown = JSON.parse(await readFile(path, 'utf8'));
assert(
  isRecord(report) && report.protocol === 'iop' && isRecord(report.baseline) && Array.isArray(report.records)
);
const baseline = report.baseline;
const savedReport: Record<string, unknown> = report;
assert(
  typeof baseline.productId === 'string' &&
    typeof baseline.original === 'string' &&
    typeof baseline.marker === 'string' &&
    typeof baseline.fieldId === 'string' &&
    typeof baseline.categoryId === 'number'
);
const mode = report.mode;
assert(mode === 'publish' || mode === 'update');
assert(
  mode !== 'update' || process.argv.includes('--confirm-restore'),
  'Restoration requires explicit confirmation; no original write is resent.'
);
const bundle = parseAlibabaOpenApiCredentialBundle(
  JSON.parse(await readFile(resolve(file), 'utf8')) as unknown
);
assert.equal(bundle.protocol, 'iop');
const credentials = {
  protocol: 'iop' as const,
  appKey: bundle.application.appKey,
  appSecret: bundle.application.appSecret,
  accessToken: bundle.oauth.accessToken,
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256' as const
};
const network = new NetworkManager({
  policies: { alibaba: { allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin] } }
});
const reader = new AlibabaClient(credentials, network, { maxAttempts: 1 });
const productId = mode === 'publish' ? report.createdId : baseline.productId;
assert(typeof productId === 'string' && /^[1-9][0-9]*$/u.test(productId));
const records: unknown[] = report.records;
const expected = `${baseline.original} ${baseline.marker}`;
installNodeXmlDomGlobals();
let restoreSent = records.length > 1;
async function persist(phase: string, error?: unknown) {
  const normalized = error === undefined ? null : normalizeGatewayError(error);
  await atomicWriteJson(path, {
    ...savedReport,
    phase,
    records,
    reconciledAtUtc: new Date().toISOString(),
    ...(normalized
      ? {
          error: {
            code: normalized.code,
            subCode: normalized.subCode ?? null,
            traceId: normalized.traceId ?? null
          }
        }
      : { error: null })
  });
}
for (let attempt = 0; attempt < maxChecks; attempt++) {
  try {
    const result = await new ProductAdapter(reader).renderSchema({
      productId,
      categoryId: baseline.categoryId,
      language: 'en_US'
    });
    const model = parseProductSchemaXml(result.xml);
    const title = model.fields.find((field) => field.id === baseline.fieldId);
    assert(title?.values[0]);
    const current = title.values[0].text;
    if (mode === 'publish') {
      assert.equal(current, expected, 'Published sample differs; no write permitted.');
      await persist('created-and-confirmed');
      process.stdout.write(`IOP publish readback confirmed: ${path}\n`);
      break;
    }
    if (current === baseline.original) {
      if (!restoreSent) {
        await persist('original-state-confirmed-update-unverified');
        process.stdout.write(
          'Original title remains unchanged; no update effect observed and no compensation sent.\n'
        );
        process.exitCode = 1;
        break;
      }
      await persist('restored-and-confirmed');
      process.stdout.write(`IOP update restoration confirmed: ${path}\n`);
      break;
    }
    assert.equal(current, expected, 'Concurrent title change; stop, no blind compensation.');
    if (!restoreSent) {
      const restored = markProductSchemaFieldTouched(
        {
          ...model,
          fields: model.fields.map((field) =>
            field.key === title.key ? withProductSchemaFieldText(field, baseline.original as string) : field
          )
        },
        title.key
      );
      const patch = inspectProductSchemaPatchSerialization(restored);
      assert(patch.safe && patch.xml && !patch.noOp);
      const method = 'alibaba.icbu.product.schema.update';
      const signed = await createIopBusinessRequest(credentials, method, {
        param_product_top_publish_request: {
          cat_id: baseline.categoryId,
          product_id: productId,
          language: 'en_US',
          xml: patch.xml
        }
      });
      const record = {
        method,
        requestId: crypto.randomUUID(),
        phase: 'restoration-sending',
        traceId: null as string | null
      };
      records.push(record);
      await persist('restoration-sending');
      restoreSent = true;
      const response = await network.request({
        service: 'alibaba',
        url: signed.url,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: new URLSearchParams(signed.parameters),
        responseType: 'json',
        requestId: record.requestId
      });
      assert(response.ok, 'Unknown restoration result; do not resend.');
      const normalized = normalizeIopBusinessResponse(response.data, method, credentials);
      assert(isRecord(normalized));
      const result = normalized[`${method.replaceAll('.', '_')}_response`];
      record.traceId = isRecord(result) && typeof result.trace_id === 'string' ? result.trace_id : null;
      record.phase = 'restoration-accepted';
      await persist('restoration-awaiting-readback');
    }
  } catch (error) {
    await persist(restoreSent ? 'restoration-pending' : 'platform-review-pending', error);
    const normalized = normalizeGatewayError(error);
    process.stdout.write(
      `Readback pending: ${normalized.code}/${normalized.subCode ?? ''}; no mutation retry\n`
    );
    if (normalized.code !== 'ALIBABA_IOP_API_REJECTED') {
      process.exitCode = 1;
      break;
    }
  }
  if (attempt === maxChecks - 1) {
    process.exitCode = 1;
    break;
  }
  await new Promise<void>((done) => setTimeout(done, 5000));
}
