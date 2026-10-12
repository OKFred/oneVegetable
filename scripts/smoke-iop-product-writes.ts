/** Isolated, explicitly confirmed acceptance. Never replaces the workbench's TOP configuration. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseAlibabaOpenApiCredentialBundle } from '../packages/core/src/alibaba-credential-bundle';
import { AlibabaClient } from '../packages/core/src/alibaba-client';
import { IOP_BUSINESS_ENDPOINT } from '../packages/core/src/alibaba-iop';
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
  inspectProductSchemaSerialization,
  inspectProductSchemaPatchSerialization
} from '../packages/core/src/product-schema';
import { atomicWriteJson } from './openapi-auth/storage';
import { installNodeXmlDomGlobals } from './node-xml-dom';

const arg = (name: string) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = arg('credential');
const mode = arg('mode');
assert(
  file &&
    ['draft', 'publish', 'update'].includes(mode ?? '') &&
    process.argv.includes('--confirm-real-write'),
  'Requires explicit IOP bundle, --mode=draft|publish|update and --confirm-real-write'
);
const reportPath = resolve(
  'artifacts/iop-product-write-validation',
  new Date().toISOString().slice(0, 10),
  `${mode}.json`
);
if (existsSync(reportPath)) {
  const prior = JSON.parse(await readFile(reportPath, 'utf8')) as { records?: unknown[] };
  assert(
    Array.isArray(prior.records) && prior.records.length === 0,
    'A write receipt already exists today: reconcile it; never repeat a write automatically.'
  );
}
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
  policies: {
    alibaba: { allowedOrigins: [new URL(IOP_BUSINESS_ENDPOINT).origin], timeoutMilliseconds: 30000 }
  }
});
const reader = new AlibabaClient(credentials, network, { maxAttempts: 1 });
const records: { method: string; requestId: string; phase: string; traceId?: string }[] = [];
let phase = 'preflight';
let createdId: string | null = null;
let baseline: {
  productId: string;
  categoryId: number;
  fieldId: string;
  original: string;
  marker: string;
} | null = null;
const marker = `[oneVegetable-iop-${crypto.randomUUID().slice(0, 8)}]`;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function persist(error?: unknown) {
  const normalized = error === undefined ? null : normalizeGatewayError(error);
  await atomicWriteJson(reportPath, {
    capturedAtUtc: new Date().toISOString(),
    protocol: 'iop',
    mode,
    phase,
    configurationChanged: false,
    createdId,
    baseline,
    records,
    ...(normalized
      ? {
          error: {
            code: normalized.code,
            subCode: normalized.subCode ?? null,
            traceId: normalized.traceId ?? null
          }
        }
      : {})
  });
}
// This CLI is the narrowly-scoped acceptance lane, not a production policy override.
async function write(method: string, input: Readonly<Record<string, unknown>>) {
  const expected =
    mode === 'update'
      ? 'alibaba.icbu.product.schema.update'
      : mode === 'draft'
        ? 'alibaba.icbu.product.schema.add.draft'
        : 'alibaba.icbu.product.schema.add';
  assert.equal(method, expected);
  const signed = await createIopBusinessRequest(credentials, method, input);
  const record = { method, requestId: crypto.randomUUID(), phase: 'sending' };
  records.push(record);
  phase = 'sending';
  await persist(); // Storage failure must stop before sending, including restoration.
  const response = await network.request({
    service: 'alibaba',
    url: signed.url,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(signed.parameters),
    responseType: 'json',
    requestId: record.requestId
  });
  assert(response.ok, 'Transport result unknown: stop, do not resend.');
  const data = normalizeIopBusinessResponse(response.data, method, credentials);
  record.phase = 'accepted';
  phase = 'accepted-awaiting-readback';
  await persist();
  return { method, data };
}
installNodeXmlDomGlobals();
try {
  const page = await new ProductAdapter(reader).list({ page: 1, pageSize: 30, language: 'en_US' });
  const product = page.items.find(
    (item) =>
      item.status === 'online' &&
      item.categoryId &&
      !/dont.?edit|oneVegetable/iu.test(item.subject) &&
      item.subject.length < 95
  );
  assert(product?.categoryId, 'No eligible readable, non-dont-edit test product; no guessed IDs.');
  const source = await new ProductAdapter(reader).renderSchema({
    productId: product.id,
    categoryId: product.categoryId,
    language: 'en_US'
  });
  let model = parseProductSchemaXml(source.xml);
  const title = model.fields.find(
    (field) => ['subject', 'producttitle', 'title'].includes(field.id.toLowerCase()) && field.type === 'input'
  );
  assert(title?.values[0]?.text, 'Missing lossless scalar title; stop.');
  const original = title.values[0].text;
  const titleId = title.id;
  const categoryId = product.categoryId;
  baseline = { productId: product.id, categoryId: product.categoryId, fieldId: title.id, original, marker };
  await persist();
  model = markProductSchemaFieldTouched(
    {
      ...model,
      fields: model.fields.map((field) =>
        field.key === title.key ? withProductSchemaFieldText(field, `${original} ${marker}`) : field
      )
    },
    title.key
  );
  const inspection =
    mode === 'update'
      ? inspectProductSchemaPatchSerialization(model)
      : inspectProductSchemaSerialization(model);
  assert(inspection.safe, 'Serialization safety check failed; do not send.');
  const adapter = new ProductAdapter({ call: write });
  const result =
    mode === 'update'
      ? await adapter.update({
          productId: product.id,
          categoryId: product.categoryId,
          language: 'en_US',
          schemaPatchXml: inspection.xml
        })
      : await adapter.mutate(
          mode === 'draft' ? 'alibaba.icbu.product.schema.add.draft' : 'alibaba.icbu.product.schema.add',
          { categoryId: product.categoryId, language: 'en_US', schemaXml: inspection.xml }
        );
  createdId = mode === 'update' ? null : result.productId;
  const receipt = records[records.length - 1];
  assert(receipt);
  receipt.traceId = result.traceId;
  await persist();
  async function readModel(id: string, draft: boolean) {
    const method = draft ? 'alibaba.icbu.product.schema.render.draft' : 'alibaba.icbu.product.schema.render';
    const response = await reader.call(method, {
      param_product_top_publish_request: { cat_id: categoryId, product_id: id, language: 'en_US' }
    });
    const data = response.data as Record<string, Record<string, unknown>>;
    const xml = data[`${method.replaceAll('.', '_')}_response`]?.data;
    assert.equal(typeof xml, 'string');
    return parseProductSchemaXml(xml as string);
  }
  async function readTitle(id: string, draft: boolean): Promise<string | null> {
    return (await readModel(id, draft)).fields.find((field) => field.id === titleId)?.values[0]?.text ?? null;
  }
  async function confirmTitle(id: string, draft: boolean, expected: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      await wait(5000);
      if ((await readTitle(id, draft)) === expected) return;
    }
    throw new Error('Readback unresolved; no automatic retry or blind compensation.');
  }
  await confirmTitle(result.productId, mode === 'draft', `${original} ${marker}`);
  phase = 'readback-confirmed';
  await persist();
  if (mode === 'update') {
    const latest = await readModel(product.id, false);
    const latestTitle = latest.fields.find((field) => field.id === title.id);
    assert(latestTitle);
    assert.equal(
      latestTitle.values[0]?.text,
      `${original} ${marker}`,
      'Concurrent title change: stop restoration.'
    );
    const restored = markProductSchemaFieldTouched(
      {
        ...latest,
        fields: latest.fields.map((field) =>
          field.key === latestTitle.key ? withProductSchemaFieldText(field, original) : field
        )
      },
      latestTitle.key
    );
    const patch = inspectProductSchemaPatchSerialization(restored);
    assert(patch.safe);
    await adapter.update({
      productId: product.id,
      categoryId: product.categoryId,
      language: 'en_US',
      schemaPatchXml: patch.xml
    });
    await confirmTitle(product.id, false, original);
    phase = 'restored-and-confirmed';
  } else phase = 'created-and-confirmed';
  await persist();
  process.stdout.write(`IOP ${mode}: ${phase}; receipt: ${reportPath}\n`);
} catch (error) {
  await persist(error);
  process.stdout.write(
    `IOP ${mode}: ${phase}; error=${normalizeGatewayError(error).code}; receipt: ${reportPath}\n`
  );
  process.exitCode = 1;
}
