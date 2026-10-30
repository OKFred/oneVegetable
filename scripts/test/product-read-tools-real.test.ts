import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import credentialFixtures from '../../mock/data/node-gateway-credentials.json';
import readFixtures from '../../mock/data/product-read-tools.json';
import lookupFixtures from '../../mock/data/product-lookup.json';
import referenceFixtures from '../../mock/data/product-reference/examples.json';
import { createAlibabaRequest } from '../../packages/core/src/signing';
import { createIopBusinessRequest } from '../../packages/core/src/alibaba-iop-business';
import type { GatewayCredentials } from '../../packages/core/src/types';
import {
  PRODUCT_READ_ACCEPTANCE_METHODS,
  PRODUCT_READ_GUARD_METHODS,
  ProductReadNetworkGuard,
  parseProductReadOptions,
  readReadonlyProductBundle,
  extractProductReadPrerequisites,
  buildProductReadPlan,
  assessProductReadEnvelope,
  safeSearchContractIssues,
  runProductReadAcceptance,
  runProductReadSmoke,
  productReadScopedRoot,
  main,
  type ProductReadPlanEntry,
  type ProductReadReceipt
} from '../smoke-product-read-tools-real';

const args = [
  '--confirm-readonly',
  '--iop-credential=artifacts/read-tools-iop.json',
  '--top-credential=artifacts/read-tools-top.json',
  '--output=artifacts/read-tools-receipt.json'
];
function options() {
  const result = parseProductReadOptions(args);
  result.inputs = {
    'model-number': lookupFixtures.queries.modelNumber,
    'translation-text': readFixtures.translationInput.text,
    'source-language': readFixtures.translationInput.sourceLanguage,
    'target-language': readFixtures.translationInput.targetLanguage,
    'shipping-template-id': readFixtures.shippingInput.shippingTemplateId,
    'weight-kg': readFixtures.shippingInput.weightKg,
    'length-cm': readFixtures.shippingInput.lengthCm,
    'width-cm': readFixtures.shippingInput.widthCm,
    'height-cm': readFixtures.shippingInput.heightCm,
    'sale-type': readFixtures.shippingInput.saleType,
    'product-type': String(readFixtures.shippingInput.productType),
    moq: String(readFixtures.shippingInput.moq)
  };
  return result;
}
const topBundle = () =>
  readReadonlyProductBundle(
    {
      ...credentialFixtures.oauthBundle,
      oauth: { ...credentialFixtures.oauthBundle.oauth, expiresAtUtc: credentialFixtures.knownExpiry }
    },
    'top'
  );
function credentials(): Record<'top' | 'iop', GatewayCredentials> {
  const top = topBundle();
  return {
    top: {
      protocol: 'top',
      appKey: top.application.appKey,
      appSecret: top.application.appSecret,
      accessToken: top.oauth.accessToken,
      signMethod: 'hmac',
      endpoint: 'https://eco.taobao.com/router/rest'
    },
    iop: {
      protocol: 'iop',
      appKey: top.application.appKey,
      appSecret: top.application.appSecret,
      accessToken: top.oauth.accessToken,
      signMethod: 'hmac-sha256',
      endpoint: 'https://openapi-api.alibaba.com/rest'
    }
  };
}
const plan = () => buildProductReadPlan(options(), topBundle().application.appName);
function entry(operation: ProductReadPlanEntry['operation']) {
  const result = plan().find((item) => item.operation === operation);
  if (!result) throw new Error('MISSING_TEST_PLAN');
  return result;
}
async function signed(item: ProductReadPlanEntry, requestId: string) {
  const creds = credentials()[item.protocol];
  if (!item.parameters) throw new Error('MISSING_TEST_PARAMETERS');
  const iop =
    item.protocol === 'iop' ? await createIopBusinessRequest(creds, item.method, item.parameters) : null;
  return {
    url: iop?.url ?? creds.endpoint,
    init: {
      method: 'POST',
      headers: { 'X-Request-ID': requestId, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(iop?.parameters ?? createAlibabaRequest(creds, item.method, item.parameters))
    } satisfies RequestInit
  };
}
async function probe(
  override?: (operation: ProductReadPlanEntry['operation'], value: unknown) => unknown,
  selectedPlan = plan(),
  smokeOptions?: ReturnType<typeof options>
) {
  const lookup = structuredClone(lookupFixtures.response);
  lookup.product_info = lookup.product_info.slice(0, 1);
  lookup.page.page_size = 1;
  for (const product of lookup.product_info) {
    Reflect.deleteProperty(product.basic_info, 'owner_ali_id');
    if (Array.isArray(product.sku_info))
      product.sku_info = product.sku_info.filter((sku) => typeof sku.sku_code === 'string');
  }
  const responses: Record<string, unknown> = {
    search: { code: '0', ...lookup },
    translation: readFixtures.translation,
    countries: readFixtures.countries,
    coverage: readFixtures.coverage,
    getProduct: referenceFixtures['/alibaba/icbu/product/get/v2'].response
  };
  const sent: { operation: string; form: URLSearchParams; requestId: string | null; redirect: unknown }[] =
    [];
  const persisted: ProductReadReceipt[] = [];
  let now = 0;
  const waits: number[] = [];
  const guard = new ProductReadNetworkGuard(
    {
      async send(input, init) {
        const request = new Request(input, init);
        const form = new URLSearchParams(await request.text());
        const path = new URL(request.url).pathname;
        const operation = (
          Object.keys(PRODUCT_READ_GUARD_METHODS) as ProductReadPlanEntry['operation'][]
        ).find(
          (key) =>
            path === '/rest' + PRODUCT_READ_GUARD_METHODS[key] ||
            PRODUCT_READ_GUARD_METHODS[key] === form.get('method')
        );
        if (!operation) throw new Error('UNEXPECTED_TEST_METHOD');
        const requestId = request.headers.get('X-Request-ID');
        expect(persisted.at(-1)?.observations.some((row) => row.requestId === requestId)).toBe(true);
        sent.push({ operation, form, requestId, redirect: init.redirect });
        const body = override
          ? override(operation, structuredClone(responses[operation]))
          : responses[operation];
        return body instanceof Response ? body : Response.json(body);
      }
    },
    () => now,
    (ms) => {
      now += ms;
      waits.push(ms);
      return Promise.resolve();
    }
  );
  const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('OFFLINE_TEST_NETWORK_DENIED'));
  try {
    const persist = (value: ProductReadReceipt) => {
      persisted.push(structuredClone(value));
      return Promise.resolve();
    };
    const receipt = smokeOptions
      ? await runProductReadSmoke(
          smokeOptions,
          credentials(),
          topBundle().application.appName,
          guard,
          persist
        )
      : await runProductReadAcceptance(selectedPlan, credentials(), guard, persist, [
          topBundle().application.appName,
          ...Object.values(options().inputs)
        ]);
    expect(external).not.toHaveBeenCalled();
    return { receipt, sent, persisted, waits, snapshot: guard.snapshot() };
  } finally {
    external.mockRestore();
  }
}
describe('product read smoke options and prerequisites', () => {
  it('requires explicit opt-in and both credential paths plus a receipt', () => {
    expect(parseProductReadOptions(args).inputs).toEqual({});
    for (let index = 0; index < args.length; index++)
      expect(() => parseProductReadOptions(args.filter((_value, i) => i !== index))).toThrow();
  });
  it.each([
    '--confirm-readonly',
    '--output=artifacts/duplicate.json',
    '--app-name=xiaoman',
    '--method=alibaba.icbu.product.edit',
    '--allow=all',
    '--model-number=',
    '--refresh=true'
  ])('rejects duplicate, arbitrary or unsafe options: %s', (extra) => {
    expect(() => parseProductReadOptions([...args, extra])).toThrow();
  });
  it('accepts exactly one explicit model/SKU and an exact saved product identity', () => {
    expect(() =>
      parseProductReadOptions([
        ...args,
        '--model-number=' + lookupFixtures.queries.modelNumber,
        '--sku-code=' + lookupFixtures.queries.skuCode
      ])
    ).toThrow('EXACT_ONE_SEARCH_KEY_REQUIRED');
    expect(() => parseProductReadOptions([...args, '--product-result=artifacts/detail.json'])).toThrow();
    const expected = String(referenceFixtures['/alibaba/icbu/product/get/v2'].request.product_id);
    expect(
      parseProductReadOptions([...args, '--product-result=artifacts/detail.json', '--product-id=' + expected])
        .inputs['product-id']
    ).toBe(expected);
  });
  it('reuses strict parsing and preserves legacy TOP unknown expiry without renewal', () => {
    expect(topBundle().protocol).toBeUndefined();
    const source = structuredClone(credentialFixtures.oauthBundle);
    expect(() => readReadonlyProductBundle(source, 'iop')).toThrow();
    expect(readReadonlyProductBundle(source, 'top').oauth.expiresAtUtc).toBeNull();
    const expired = { ...source, oauth: { ...source.oauth, expiresAtUtc: source.capturedAtUtc } };
    expect(() => readReadonlyProductBundle(expired, 'top')).toThrow('VALID_UNEXPIRED_TOP_BUNDLE_REQUIRED');
    const marked = {
      ...source,
      protocol: 'iop',
      oauth: {
        ...source.oauth,
        expiresAtUtc: credentialFixtures.knownExpiry
      }
    };
    expect(readReadonlyProductBundle(marked, 'iop').protocol).toBe('iop');
    expect(() => readReadonlyProductBundle(marked, 'top')).toThrow();
  });
  it('extracts only the explicitly identified get/v2 result without issuing a support read', () => {
    const fixture = referenceFixtures['/alibaba/icbu/product/get/v2'];
    const wrapped = { method: '/alibaba/icbu/product/get/v2', contractValid: true, data: fixture.response };
    const expected = String(fixture.request.product_id);
    const derived = extractProductReadPrerequisites(wrapped, expected);
    expect(derived['model-number']).toBe(fixture.response.product_info.basic_info.model_number);
    expect(derived['shipping-template-id']).toBe(
      String(fixture.response.product_info.logistics_info.shipping_template_id)
    );
    expect(derived['weight-kg']).toBe(fixture.response.product_info.logistics_info.weight);
    expect(derived).not.toHaveProperty('sale-type');
    expect(derived).not.toHaveProperty('product-type');
    expect(extractProductReadPrerequisites(wrapped, expected + '0')).toEqual({});
    expect(extractProductReadPrerequisites({ ...wrapped, contractValid: false }, expected)).toEqual({});
    expect(extractProductReadPrerequisites(fixture.response, expected)).toEqual({});
  });
  it('keeps missing real inputs missing instead of using sample identifiers or dimensions', () => {
    const planned = buildProductReadPlan(parseProductReadOptions(args), topBundle().application.appName);
    expect(planned.map((item) => item.parameters !== null)).toEqual([false, false, true, false]);
    expect(planned[2]?.parameters).toEqual({ country_request: {} });
    expect(plan().map((item) => item.method)).toEqual(Object.values(PRODUCT_READ_ACCEPTANCE_METHODS));
    expect(plan()[0]?.parameters).toEqual({
      model_number: lookupFixtures.queries.modelNumber,
      page_index: 1,
      page_size: 1
    });
  });
  it.each(['xiaoman', ' XIAOMAN ', ''])('does not substitute or send the example appName %s', (name) => {
    expect(buildProductReadPlan(options(), name)[1]?.parameters).toBeNull();
  });
  it('takes translation appName only from the validated application config', () => {
    const translation = plan()[1]?.parameters?.icbu_translate_task_dto as Record<string, unknown>[];
    expect(translation[0]?.app_name).toBe(topBundle().application.appName);
    expect(translation[0]?.app_name).not.toBe(readFixtures.translationInput.appName);
  });
  it('does not guess required freight fields or convert unit strings', () => {
    const incomplete = options();
    delete incomplete.inputs['sale-type'];
    expect(buildProductReadPlan(incomplete, topBundle().application.appName)[3]?.parameters).toBeNull();
    incomplete.inputs['sale-type'] = 'normal';
    incomplete.inputs['weight-kg'] = '1kg';
    expect(buildProductReadPlan(incomplete, topBundle().application.appName)[3]?.parameters).toBeNull();
    expect(plan()[3]?.parameters).toEqual(readFixtures.shippingRequest);
  });
  it('rejects non-artifact or input-overwriting report targets before reading credentials', async () => {
    await expect(
      main(args.map((arg) => (arg.startsWith('--output=') ? '--output=scripts/receipt.json' : arg)))
    ).rejects.toThrow('NEW_IGNORED_RECEIPT_REQUIRED');
    await expect(
      main(args.map((arg) => (arg.startsWith('--output=') ? '--output=artifacts/read-tools-top.json' : arg)))
    ).rejects.toThrow('NEW_IGNORED_RECEIPT_REQUIRED');
  });
});
describe('optional targeted product prerequisite', () => {
  const detail = referenceFixtures['/alibaba/icbu/product/get/v2'];
  const productId = String(detail.request.product_id);
  function withProductId() {
    const result = parseProductReadOptions([...args, '--product-id=' + productId]);
    result.inputs['source-language'] = readFixtures.translationInput.sourceLanguage;
    result.inputs['target-language'] = readFixtures.translationInput.targetLanguage;
    result.inputs['sale-type'] = readFixtures.shippingInput.saleType;
    result.inputs['product-type'] = String(readFixtures.shippingInput.productType);
    return result;
  }
  it('accepts an explicit product ID without demanding a saved business-response file', () => {
    expect(withProductId().inputs['product-id']).toBe(productId);
    expect(withProductId().inputs['product-result']).toBeUndefined();
  });
  it('scopes ignored credentials to the worktree or named primary repo, never arbitrary directories', () => {
    const root = resolve('repo', 'oneVegetable-score-recovery');
    const primary = resolve(root, '..', 'oneVegetable');
    expect(productReadScopedRoot(root, resolve(primary, 'artifacts', 'iop-credentials.json'))).toBe(primary);
    expect(productReadScopedRoot(root, resolve(root, 'artifacts', 'new-receipt.json'))).toBe(root);
    expect(() => productReadScopedRoot(root, resolve(root, '..', 'other', 'credentials.json'))).toThrow();
  });
  it('reads only the exact product once and derives inputs without persisting its response', async () => {
    const result = await probe(undefined, plan(), withProductId());
    expect(result.sent.map((item) => item.operation)).toEqual([
      'getProduct',
      'search',
      'translation',
      'countries',
      'coverage'
    ]);
    expect(result.sent[0]?.form.get('product_id')).toBe(productId);
    expect(result.sent[1]?.form.get('model_number')).toBe(
      detail.response.product_info.basic_info.model_number
    );
    expect(result.receipt.counts).toMatchObject({ methods: 5, accepted: 5, networkRequests: 5 });
    expect(result.snapshot).toEqual({ sent: 5, blocked: 0 });
    expect(result.waits).toEqual([350, 350, 350, 350]);
    const receipt = JSON.stringify(result.persisted);
    for (const forbidden of [
      productId,
      detail.response.product_info.basic_info.title,
      detail.response.product_info.basic_info.model_number,
      'product_info',
      'logistics_info'
    ])
      expect(receipt).not.toContain(forbidden);
  }, 30_000);
  it('does not unlock derived reads when get/v2 returns a different product', async () => {
    const wrong = structuredClone(detail.response);
    wrong.product_info.basic_info.product_id++;
    const result = await probe(
      (operation, body) => (operation === 'getProduct' ? wrong : body),
      plan(),
      withProductId()
    );
    expect(result.sent.map((item) => item.operation)).toEqual(['getProduct', 'countries']);
    expect(result.receipt.counts).toMatchObject({ failed: 1, missingPrerequisite: 3, networkRequests: 2 });
    expect(result.receipt.observations[0]?.errorCode).toBe('PRODUCT_READ_RESPONSE_INVALID');
  });
  it('never sends a support read unless a product ID was explicitly supplied', async () => {
    const result = await probe(undefined, plan(), options());
    expect(result.sent).toHaveLength(4);
    expect(result.sent.some((item) => item.operation === 'getProduct')).toBe(false);
  });
  it('guards the prerequisite product ID and refuses duplicate or expanded requests', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json(detail.response)));
    const guard = new ProductReadNetworkGuard({ send });
    const item: ProductReadPlanEntry = {
      operation: 'getProduct',
      method: PRODUCT_READ_GUARD_METHODS.getProduct,
      protocol: 'iop',
      parameters: { product_id: productId }
    };
    expect(() => {
      guard.arm({ ...item, parameters: { product_id: productId, page_size: 100 } }, randomUUID());
    }).toThrow();
    const requestId = randomUUID();
    guard.arm(item, requestId);
    const request = await signed(item, requestId);
    await guard.send(request.url, request.init);
    guard.disarm();
    expect(() => {
      guard.arm(item, randomUUID());
    }).toThrow('READ_ONLY_NETWORK_DENIED');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['*', '%', '?'])('rejects wildcard search key %s rather than scanning the shop', (key) => {
    const input = options();
    input.inputs['model-number'] = key;
    expect(buildProductReadPlan(input, topBundle().application.appName)[0]?.parameters).toBeNull();
    const guard = new ProductReadNetworkGuard({ send: () => Promise.resolve(Response.json({})) });
    expect(() => {
      guard.arm(
        { ...entry('search'), parameters: { model_number: key, page_index: 1, page_size: 1 } },
        randomUUID()
      );
    }).toThrow();
  });
});

describe('fixed four-method NetworkManager acceptance with offline transport', () => {
  it('correlates exactly four requests, never sends a translation session and persists only safe summaries', async () => {
    const result = await probe();
    expect(result.receipt.counts, JSON.stringify(result.receipt)).toEqual({
      methods: 4,
      accepted: 4,
      failed: 0,
      missingPrerequisite: 0,
      networkRequests: 4
    });
    expect(result.snapshot).toEqual({ sent: 4, blocked: 0 });
    expect(result.waits).toEqual([350, 350, 350]);
    expect(result.sent.map((item) => item.operation)).toEqual([
      'search',
      'translation',
      'countries',
      'coverage'
    ]);
    expect(result.sent[0]?.form.get('page_size')).toBe('1');
    expect(result.sent[0]?.form.has('method')).toBe(false);
    expect(result.sent[0]?.form.has('session')).toBe(false);
    expect(result.sent[1]?.form.has('session')).toBe(false);
    expect(result.sent[2]?.form.has('session')).toBe(true);
    expect(result.sent.every((item) => item.redirect === 'error')).toBe(true);
    for (const row of result.receipt.observations) {
      expect(result.sent.some((item) => item.requestId === row.requestId)).toBe(true);
      expect(Object.keys(row).sort()).toEqual([
        'counts',
        'errorCode',
        'method',
        'protocol',
        'requestId',
        'status',
        'subCode'
      ]);
    }
    const serialized = JSON.stringify(result.persisted);
    for (const forbidden of [
      credentialFixtures.oauthBundle.application.appKey,
      credentialFixtures.oauthBundle.application.appSecret,
      credentialFixtures.oauthBundle.oauth.accessToken,
      topBundle().application.appName,
      readFixtures.translationInput.text,
      lookupFixtures.queries.modelNumber,
      readFixtures.translation.result[0]?.translate_result_text,
      'product_info',
      'shipping_template_id'
    ])
      if (forbidden) expect(serialized).not.toContain(forbidden);
  }, 30_000);
  it('records missing-prerequisite without a store scan or fabricated business input', async () => {
    const selected = buildProductReadPlan(parseProductReadOptions(args), topBundle().application.appName);
    const result = await probe(undefined, selected);
    expect(result.sent.map((item) => item.operation)).toEqual(['countries']);
    expect(result.receipt.counts).toMatchObject({ accepted: 1, missingPrerequisite: 3, networkRequests: 1 });
    expect(
      result.receipt.observations
        .filter((row) => row.status === 'missing-prerequisite')
        .every((row) => row.requestId === null && row.counts.results === null)
    ).toBe(true);
  });
  it('preserves a business/permission failure without fallback or leaking provider message', async () => {
    const result = await probe((operation, body) =>
      operation === 'translation' ? readFixtures.translationFailure : body
    );
    expect(result.sent.filter((item) => item.operation === 'translation')).toHaveLength(1);
    expect(result.receipt.observations[1]).toMatchObject({
      status: 'failed',
      errorCode: 'isv.permission-api-package-limit',
      counts: { results: null, networkRequests: 1 }
    });
    expect(JSON.stringify(result.receipt)).not.toContain('Permission denied');
    expect(result.receipt.counts.failed).toBe(1);
  });
  it('does not count partial translation or false coverage as success', async () => {
    const result = await probe((operation, body) =>
      operation === 'translation'
        ? readFixtures.translationPartial
        : operation === 'coverage'
          ? readFixtures.coverageFailure
          : body
    );
    expect(result.receipt.observations[1]?.errorCode).toBe('PRODUCT_READ_PARTIAL_FAILURE');
    expect(result.receipt.observations[3]).toMatchObject({ status: 'failed', errorCode: 'SYS_ERROR' });
    expect(result.receipt.counts.accepted).toBe(2);
  });
  it.each([503, 302])('does not retry or follow HTTP %s', async (status) => {
    const result = await probe((operation, body) =>
      operation === 'search'
        ? new Response(null, {
            status,
            headers: status === 302 ? { Location: 'https://eco.taobao.com/router/rest' } : {}
          })
        : body
    );
    expect(result.sent.filter((item) => item.operation === 'search')).toHaveLength(1);
    expect(result.receipt.observations[0]?.status).toBe('failed');
    expect(result.sent).toHaveLength(4);
  });
  it('keeps only bounded public search issue paths/keywords, never messages or business keys', () => {
    const secret = credentialFixtures.oauthBundle.application.appSecret;
    const issue = {
      instancePath: '/product_info/0/trade_info/price/tiered_price/0/price',
      keyword: 'type',
      message: secret,
      params: { actual: readFixtures.translationInput.text }
    };
    const envelope = {
      method: PRODUCT_READ_ACCEPTANCE_METHODS.search,
      contractValid: false,
      data: lookupFixtures.response,
      contractIssues: [
        issue,
        { ...issue, instancePath: issue.instancePath.replace('/0/', '/42/') },
        { ...issue, instancePath: '/product_info/0/' + secret },
        { ...issue, instancePath: '/unexpected_business_key' },
        { ...issue, keyword: secret },
        { ...issue, instancePath: '/' + 'x'.repeat(513) },
        ...Array.from({ length: 200 }, () => issue)
      ]
    };
    const result = safeSearchContractIssues(envelope, [secret]);
    expect(result).toEqual([
      { instancePath: '/product_info/*/trade_info/price/tiered_price/*/price', keyword: 'type' }
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('message');
    expect(JSON.stringify(result)).not.toContain('actual');
    expect(safeSearchContractIssues({ ...envelope, contractValid: true })).toEqual([]);
    expect(safeSearchContractIssues({ ...envelope, method: PRODUCT_READ_GUARD_METHODS.getProduct })).toEqual(
      []
    );
    expect(safeSearchContractIssues(null)).toEqual([]);
    expect(safeSearchContractIssues(envelope, ['tiered_price'])).toEqual([]);
  });
  it.each(['string', 'boolean'] as const)(
    'diagnoses search tiered price represented as %s without persisting the price or response',
    async (representation) => {
      const price = referenceFixtures['/alibaba/icbu/product/get/v2'].response.product_info.trade_info.price;
      const result = await probe((operation, body) => {
        if (operation !== 'search') return body;
        const tiered = structuredClone(price);
        const row = tiered.tiered_price[0];
        if (!row) throw new Error('MISSING_TEST_PRICE');
        if (representation === 'boolean') Reflect.set(row, 'price', false);
        return {
          code: '0',
          success: true,
          product_info: [{ trade_info: { price: tiered } }],
          page: { ...lookupFixtures.response.page, page_size: 1 }
        };
      });
      const row = result.receipt.observations[0];
      expect(row?.errorCode).toBe(representation === 'boolean' ? 'RESPONSE_CONTRACT_INVALID' : null);
      expect(row?.contractIssues).toEqual(
        representation === 'boolean'
          ? [{ instancePath: '/product_info/*/trade_info/price/tiered_price/*/price', keyword: 'type' }]
          : undefined
      );
      expect(result.sent.filter((sent) => sent.operation === 'search')).toHaveLength(1);
      expect(result.snapshot).toEqual({ sent: 4, blocked: 0 });
      expect(JSON.stringify(result.persisted)).not.toContain('must be string');
      expect(JSON.stringify(result.persisted)).not.toContain(lookupFixtures.queries.modelNumber);
      expect(JSON.stringify(result.persisted)).not.toContain('"data"');
    }
  );
  it('redacts hostile error values and distinguishes invalid/missing data from zero results', () => {
    const selected = entry('countries');
    const bad = assessProductReadEnvelope(selected, {
      method: selected.method,
      contractValid: true,
      contractIssues: [],
      traceId: randomUUID(),
      data: { biz_success: false, msg_code: credentialFixtures.oauthBundle.application.appSecret }
    });
    expect(bad).toEqual({ count: null, errorCode: 'READ_RESULT_NOT_CONFIRMED' });
    expect(
      assessProductReadEnvelope(selected, {
        method: selected.method,
        contractValid: false,
        contractIssues: [],
        traceId: randomUUID(),
        data: readFixtures.countries
      }).errorCode
    ).toBe('RESPONSE_CONTRACT_INVALID');
  });
  it('requires successful persistence before any request and rejects expanding the method plan', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json({})));
    const guard = new ProductReadNetworkGuard({ send });
    await expect(
      runProductReadAcceptance(plan(), credentials(), guard, () =>
        Promise.reject(new Error('OFFLINE_DISK_FAILURE'))
      )
    ).rejects.toThrow('OFFLINE_DISK_FAILURE');
    expect(send).not.toHaveBeenCalled();
    await expect(
      runProductReadAcceptance([...plan(), entry('countries')], credentials(), guard)
    ).rejects.toThrow('READ_PLAN_INVALID');
  });
});
describe('read-only transport guard independently denies unsafe traffic', () => {
  it('requires arming and blocks an operation being rearmed', async () => {
    const send = vi.fn(() => Promise.resolve(Response.json({})));
    const guard = new ProductReadNetworkGuard({ send });
    const requestId = randomUUID(),
      item = entry('search');
    const request = await signed(item, requestId);
    await expect(guard.send(request.url, request.init)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    guard.arm(item, requestId);
    await guard.send(request.url, request.init);
    await expect(guard.send(request.url, request.init)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    guard.disarm();
    expect(() => {
      guard.arm(item, randomUUID());
    }).toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    'origin',
    'path',
    'query',
    'hash',
    'verb',
    'correlation',
    'body',
    'refresh',
    'session',
    'duplicate'
  ])('blocks %s changes before the native transport', async (change) => {
    const send = vi.fn(() => Promise.resolve(Response.json({})));
    const guard = new ProductReadNetworkGuard({ send });
    const item = entry('translation'),
      requestId = randomUUID();
    const request = await signed(item, requestId);
    guard.arm(item, requestId);
    let url = request.url;
    const init = request.init;
    if (change === 'origin') url = 'https://example.com/router/rest';
    if (change === 'path') url += '/other';
    if (change === 'query') url += '?x=1';
    if (change === 'hash') url += '#x';
    if (change === 'verb') init.method = 'GET';
    if (change === 'correlation') init.headers['X-Request-ID'] = randomUUID();
    if (change === 'body') init.body.set('icbu_translate_task_dto', '[]');
    if (change === 'refresh')
      init.body.set('refresh_token', credentialFixtures.oauthBundle.oauth.accessToken);
    if (change === 'session') init.body.set('session', credentialFixtures.oauthBundle.oauth.accessToken);
    if (change === 'duplicate') init.body.append('method', item.method);
    await expect(guard.send(url, init)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(guard.snapshot().blocked).toBe(1);
  });
  it('refuses unfiltered or expanded search pages even if manually armed', () => {
    const guard = new ProductReadNetworkGuard({ send: () => Promise.resolve(Response.json({})) });
    const item = entry('search');
    for (const parameters of [
      {},
      { model_number: lookupFixtures.queries.modelNumber, page_index: 2, page_size: 1 },
      { model_number: lookupFixtures.queries.modelNumber, page_index: 1, page_size: 20 }
    ])
      expect(() => {
        guard.arm({ ...item, parameters }, randomUUID());
      }).toThrow('READ_ONLY_NETWORK_DENIED');
  });
});
