import { describe, expect, it, vi } from 'vitest';
import fixture from '../../mock/data/product-draft-readback.json';
import credentialsFixture from '../../mock/data/node-gateway-credentials.json';
import { createProductOperationContext } from '../../packages/core/src/product-operation-context';
import { createIopBusinessRequest } from '../../packages/core/src/alibaba-iop-business';
import { PRODUCT_DRAFT_STATUS_METHOD } from '../../packages/core/src/product-draft-readback';
import type { GatewayCredentials } from '../../packages/core/src/types';
import {
  ProductDraftReadbackNetworkGuard,
  inputFromDraftCreationJob,
  main,
  parseDraftReadbackSmokeOptions,
  runProductDraftReadbackSmoke,
  type DraftReadbackSmokeReport
} from '../smoke-product-draft-readback-real';

const args = [
  '--confirm-readonly',
  '--iop-credential=artifacts/iop.json',
  '--draft-receipt=artifacts/existing-job.json',
  '--draft-id=' + fixture.draftId,
  '--actor-id=' + fixture.actorId,
  '--receipt-max-age-ms=300000',
  '--output=artifacts/new-readback.json'
];
function credentials(): GatewayCredentials {
  const bundle = credentialsFixture.oauthBundle;
  return {
    protocol: 'iop',
    appKey: bundle.application.appKey,
    appSecret: bundle.application.appSecret,
    accessToken: bundle.oauth.accessToken,
    endpoint: 'https://openapi-api.alibaba.com/rest',
    signMethod: 'hmac-sha256'
  };
}
async function setup() {
  const options = parseDraftReadbackSmokeOptions(args),
    creds = credentials();
  const context = await createProductOperationContext(options.actorId, creds);
  const job = { ...structuredClone(fixture.job), productContext: context };
  return { options, creds, context, job };
}
async function probe(body: unknown = fixture.responses.draft) {
  const state = await setup(),
    saved: DraftReadbackSmokeReport[] = [];
  const send = vi.fn(async (input: RequestInfo | URL, init: RequestInit) => {
    expect(saved.at(-1)?.counts.networkRequests).toBe(0);
    const request = new Request(input, init),
      form = new URLSearchParams(await request.text());
    expect(request.url).toBe(state.creds.endpoint + PRODUCT_DRAFT_STATUS_METHOD);
    expect(form.get('product_id')).toBe(fixture.draftId);
    expect(form.has('method')).toBe(false);
    expect(form.has('session')).toBe(false);
    expect(init.redirect).toBe('error');
    return body instanceof Response ? body : Response.json(body);
  });
  const validation = {
    validateCapabilityRequest: vi.fn(() => Promise.resolve([])),
    validateCapabilityResponse: vi.fn(() => Promise.resolve([]))
  };
  const external = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('OFFLINE_NETWORK_DENIED'));
  try {
    const report = await runProductDraftReadbackSmoke(
      state.options,
      state.job,
      state.creds,
      { send },
      (value) => {
        saved.push(structuredClone(value));
        return Promise.resolve();
      },
      validation,
      () => fixture.now
    );
    expect(external).not.toHaveBeenCalled();
    return { ...state, report, saved, send, validation };
  } finally {
    external.mockRestore();
  }
}
describe('existing-receipt one-ID draft presence smoke', () => {
  it('requires explicit opt-in, one exact ID and explicit receipt freshness', () => {
    expect(parseDraftReadbackSmokeOptions(args).draftId).toBe(fixture.draftId);
    for (const invalid of [
      args.slice(1),
      [...args, '--method=write'],
      args.map((arg) => (arg.startsWith('--draft-id=') ? '--draft-id=*' : arg)),
      args.map((arg) => (arg.startsWith('--receipt-max-age-ms=') ? '--receipt-max-age-ms=0' : arg))
    ])
      expect(() => parseDraftReadbackSmokeOptions(invalid)).toThrow();
  });
  it('uses one signed native request and reports only safe correlation/status/counts', async () => {
    const result = await probe();
    expect(result.report).toMatchObject({
      status: 'present',
      reasonCode: 'DRAFT_PRESENT',
      attempts: 1,
      counts: { networkRequests: 1, blockedRequests: 0 }
    });
    expect(result.send).toHaveBeenCalledTimes(1);
    expect(result.saved).toHaveLength(2);
    expect(Object.keys(result.report).sort()).toEqual([
      'attempts',
      'counts',
      'method',
      'protocol',
      'reasonCode',
      'requestId',
      'status'
    ]);
    const serialized = JSON.stringify(result.saved);
    for (const forbidden of [
      result.creds.appKey,
      result.creds.appSecret,
      result.creds.accessToken,
      fixture.actorId,
      result.context.gateway,
      'product_id',
      'productContext',
      'status_desc'
    ])
      expect(serialized).not.toContain(forbidden);
  });
  it('keeps a strict ISP upstream failure unknown, without retry or permission/absence inference', async () => {
    const result = await probe(fixture.responses.isp);
    expect(result.report).toMatchObject({
      status: 'unknown',
      reasonCode: 'DRAFT_READ_FAILED',
      attempts: 1,
      counts: { networkRequests: 1, blockedRequests: 0 }
    });
    expect(result.send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.saved)).not.toContain(fixture.responses.isp.message);
  });
  it.each(['online', 'pending', 'failed', 'deleted', 'unknown'])(
    'keeps returned %s unknown, never absent',
    async (status) => {
      const body = structuredClone(fixture.responses.draft);
      body.result.data.status = status;
      const result = await probe(body);
      expect(result.report.status).toBe('unknown');
      expect(result.send).toHaveBeenCalledTimes(1);
    }
  );
  it.each([503, 302])('does not retry/follow HTTP %s', async (status) => {
    const result = await probe(new Response(null, { status }));
    expect(result.report.status).toBe('unknown');
    expect(result.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['operation', 'publishProduct'],
    ['status', 'accepted'],
    ['protocol', 'top'],
    ['creatorId', 'other-owner'],
    ['productId', fixture.otherDraftId],
    ['productContext', fixture.otherContext]
  ])('refuses unverified or wrong-scope creation evidence %s', async (field, value) => {
    const state = await setup();
    Reflect.set(state.job, field, value);
    const send = vi.fn();
    await expect(
      runProductDraftReadbackSmoke(
        state.options,
        state.job,
        state.creds,
        { send },
        undefined,
        undefined,
        () => fixture.now
      )
    ).rejects.toThrow('SCOPED_VERIFIED_DRAFT_RECEIPT_REQUIRED');
    expect(send).not.toHaveBeenCalled();
  });
  it('requires a current receipt, not a product DTO or deletion acknowledgement', async () => {
    const state = await setup();
    for (const value of [
      null,
      fixture.responses.draft,
      { deleted_draft_ids: [Number(fixture.draftId)], success: true },
      { ...state.job, completedTimeUtc: fixture.now - state.options.receiptMaxAgeMs }
    ])
      expect(() => inputFromDraftCreationJob(value, state.options, state.context, fixture.now)).toThrow();
  });
  it('sends nothing if the shared request validator is not yet generated', async () => {
    const state = await setup(),
      send = vi.fn();
    const report = await runProductDraftReadbackSmoke(
      state.options,
      state.job,
      state.creds,
      { send },
      undefined,
      {
        validateCapabilityRequest: () => Promise.resolve([{ keyword: 'validator' }]),
        validateCapabilityResponse: () => Promise.resolve([])
      },
      () => fixture.now
    );
    expect(report).toMatchObject({
      status: 'unknown',
      reasonCode: 'DRAFT_REQUEST_CONTRACT_INVALID',
      counts: { networkRequests: 0 }
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('persists correlation before dispatch; persistence failure sends nothing', async () => {
    const state = await setup(),
      send = vi.fn();
    await expect(
      runProductDraftReadbackSmoke(
        state.options,
        state.job,
        state.creds,
        { send },
        () => Promise.reject(new Error(fixture.note)),
        undefined,
        () => fixture.now
      )
    ).rejects.toThrow(fixture.note);
    expect(send).not.toHaveBeenCalled();
  });
  it('refuses a non-artifact report before credential or receipt reads', async () => {
    await expect(
      main(args.map((arg) => (arg.startsWith('--output=') ? '--output=mock/not-a-report.json' : arg)))
    ).rejects.toThrow('NEW_IGNORED_RECEIPT_REQUIRED');
  });
  it('reserves exactly one native request and blocks a second call or a write path', async () => {
    const creds = credentials();
    const signed = await createIopBusinessRequest(creds, PRODUCT_DRAFT_STATUS_METHOD, {
      product_id: Number(fixture.draftId)
    });
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Request-ID': fixture.requestId },
      body: new URLSearchParams(signed.parameters)
    };
    const send = vi.fn(() => Promise.resolve(Response.json(fixture.responses.draft)));
    const guard = new ProductDraftReadbackNetworkGuard({ send }, fixture.draftId, fixture.requestId);
    await guard.send(signed.url, init);
    await expect(guard.send(signed.url, init)).rejects.toThrow('READ_ONLY_NETWORK_DENIED');
    expect(send).toHaveBeenCalledTimes(1);
    const fresh = new ProductDraftReadbackNetworkGuard({ send }, fixture.draftId, fixture.requestId);
    await expect(fresh.send(creds.endpoint + '/alibaba/icbu/draft/delete', init)).rejects.toThrow(
      'READ_ONLY_NETWORK_DENIED'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
