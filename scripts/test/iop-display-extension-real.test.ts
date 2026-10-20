import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  claimReport,
  exactProduct,
  installDisplayGuard,
  parseOptions,
  reportLocation,
  runDisplayCycle,
  type CycleIo,
  type DisplayGuard
} from '../smoke-iop-display-extension-real';
import type { ProductMutationJob } from '../../packages/core/src/product-mutation-job';
import type { GatewayCredentials } from '../../packages/core/src/types';
import { normalizeIopBusinessResponse } from '../../packages/core/src/alibaba-iop-business';
import display from '../../mock/data/iop-display-extension.json';
import fixture from '../../mock/data/iop-display-extension-acceptance.json';
import envelope from '../../mock/data/alibaba-auth/iop-product-display-envelope-trace.json';

const origin = 'https://openapi-api.alibaba.com';
const listUrl = origin + '/rest/alibaba/icbu/product/list';
const writeUrl = origin + '/rest/icbu/product/update/display';
const key = 'one-vegetable-extension-product-mutation-jobs-v1';
type GuardHost = typeof globalThis & { __iopDisplayGuard?: DisplayGuard };
function guard(): DisplayGuard {
  const value = (globalThis as GuardHost).__iopDisplayGuard;
  if (!value) throw new Error('Missing offline guard fixture');
  return value;
}
function job(status: ProductMutationJob['status'] = 'verifying'): ProductMutationJob {
  const value = structuredClone(fixture.receipt) as ProductMutationJob;
  value.status = status;
  if (status === 'recovering' || status === 'recovered') {
    value.recoveryRequestId = fixture.recoveryRequestId;
    value.revision = status === 'recovering' ? 4 : 5;
  }
  if (status === 'recovered') value.completedTimeUtc = 2000;
  return value;
}
function page(status: string) {
  const value = structuredClone(display.page);
  const product = value.items[0];
  if (!product) throw new Error('Missing offline product fixture');
  product.status = status;
  return value;
}
function setupGuard(saved = job('submitted')) {
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope));
  vi.stubGlobal('fetch', send);
  vi.stubGlobal('chrome', {
    storage: { local: { get: () => Promise.resolve({ [key]: { schemaVersion: 1, jobs: [saved] } }) } }
  });
  installDisplayGuard({
    origin,
    listPath: '/rest/alibaba/icbu/product/list',
    writePath: '/rest/icbu/product/update/display',
    productId: '100001',
    jobsKey: key,
    intervalMs: 0
  });
  guard().configure('online', display.context);
  const request = (url: string, parameters: Record<string, string>, id = fixture.receipt.requestId) =>
    fetch(url, {
      method: 'POST',
      headers: { 'X-Request-ID': id },
      body: new URLSearchParams({ ...fixture.wire, ...parameters })
    });
  return { send, request, saved };
}
function cycle() {
  const events: string[] = [];
  const io: CycleIo = {
    read: vi.fn<CycleIo['read']>((phase) => {
      events.push('read:' + phase);
      return Promise.resolve(page(phase === 'target-poll' ? 'offline' : 'online'));
    }),
    submit: vi.fn<CycleIo['submit']>((state) => {
      events.push('submit:' + state);
      return Promise.resolve(job());
    }),
    recover: vi.fn<CycleIo['recover']>(() => {
      events.push('recover');
      return Promise.resolve(job('recovering'));
    }),
    refresh: vi.fn<CycleIo['refresh']>(() => {
      events.push('refresh');
      return Promise.resolve(job('recovered'));
    }),
    stored: vi.fn(() => Promise.resolve(true)),
    save: vi.fn<CycleIo['save']>(async (phase) => {
      events.push('save:' + phase);
      await Promise.resolve();
    }),
    wait: vi.fn(() => Promise.resolve())
  };
  return { events, io };
}
afterEach(() => {
  Reflect.deleteProperty(globalThis, '__iopDisplayGuard');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('prepared formal MV3 display acceptance safety (offline only)', () => {
  it('requires explicit write consent, target, credential and a unique report; has no implicit product', () => {
    const args = [
      '--confirm-real-write',
      '--product-id=100001',
      '--credential=artifacts/input.json',
      '--report=artifacts/new.json'
    ];
    expect(parseOptions(args)).toMatchObject({ productId: '100001', report: 'artifacts/new.json' });
    for (const invalid of [
      [],
      args.slice(1),
      args.filter((value) => !value.startsWith('--product-id=')),
      [...args, '--confirm-real-write'],
      [...args, '--retry'],
      [...args, '--report=artifacts/other.json'],
      args.map((value) => (value.startsWith('--product-id=') ? '--product-id=9007199254740993' : value))
    ])
      expect(() => parseOptions(invalid)).toThrow();
    expect(() => reportLocation(resolve('fixture-repo'), '../outside.json')).toThrow(
      'NEW_IGNORED_REPORT_REQUIRED'
    );
    expect(() => reportLocation(resolve('fixture-repo'), 'scripts/existing.json')).toThrow(
      'NEW_IGNORED_REPORT_REQUIRED'
    );
  });
  it('durably claims a new report and refuses to reuse or overwrite it', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'iop-display-offline-'));
    const path = resolve(directory, 'report.json');
    await claimReport(path, { status: 'fixture' });
    await expect(claimReport(path, { status: 'overwritten' })).rejects.toThrow();
    expect(JSON.parse(await readFile(path, 'utf8')) as unknown).toEqual({ status: 'fixture' });
  });
  it('requires one exact, unprotected online/offline product with no cipher', () => {
    expect(exactProduct(page('online'), '100001')).toMatchObject({ id: '100001', status: 'online' });
    expect(exactProduct(page('offline'), '100001')).toMatchObject({ status: 'offline' });
    for (const status of ['auditing', 'draft', 'rejected'])
      expect(() => exactProduct(page(status), '100001')).toThrow();
    expect(() => exactProduct(page('online'), '100002')).toThrow('EXACT_TARGET_REQUIRED');
    for (const title of ["DON'T EDIT test", 'DO_NOT_EDIT', 'do not touch', '请勿修改', '禁止编辑']) {
      const value = page('online');
      const product = value.items[0];
      if (!product) throw new Error('Missing fixture');
      product.subject = title;
      expect(() => exactProduct(value, '100001')).toThrow('PROTECTED_PRODUCT_DENIED');
    }
  });
  it('saves baseline before submit, uses readonly lists before recovery, and refreshes the task only afterwards', async () => {
    const test = cycle();
    expect((await runDisplayCycle(test.io, '100001', display.context)).status).toBe('recovered');
    expect(test.events).toEqual([
      'read:baseline',
      'save:baseline-saved',
      'save:submit-intent',
      'submit:offline',
      'save:submitted',
      'read:target-poll',
      'save:target-poll',
      'save:recovery-intent',
      'recover',
      'save:recovering',
      'read:restore-poll',
      'save:restore-poll',
      'refresh',
      'save:recovered'
    ]);
    expect(test.io.submit).toHaveBeenCalledOnce();
    expect(test.io.recover).toHaveBeenCalledOnce();
    expect(test.io.refresh).toHaveBeenCalledOnce();
  });
  it('stops before any write if baseline persistence fails', async () => {
    const test = cycle();
    test.io.save = vi.fn().mockRejectedValue(new Error('Fixture persistence failure'));
    await expect(runDisplayCycle(test.io, '100001', display.context)).rejects.toThrow();
    expect(test.io.submit).not.toHaveBeenCalled();
    expect(test.io.recover).not.toHaveBeenCalled();
  });
  it('waits readonly through recovery review without submitting another mutation', async () => {
    const test = cycle();
    let polls = 0;
    test.io.read = vi.fn<CycleIo['read']>((phase) =>
      Promise.resolve(
        page(
          phase === 'target-poll'
            ? 'offline'
            : phase === 'restore-poll' && ++polls === 1
              ? 'auditing'
              : 'online'
        )
      )
    );
    expect((await runDisplayCycle(test.io, '100001', display.context)).status).toBe('recovered');
    expect(test.io.submit).toHaveBeenCalledOnce();
    expect(test.io.recover).toHaveBeenCalledOnce();
    expect(test.io.wait).toHaveBeenCalledOnce();
  });
  it.each(['submit', 'recover'] as const)(
    'does not retry or auto-restore after an unknown %s result',
    async (phase) => {
      const test = cycle();
      test.io[phase] = vi.fn().mockRejectedValue(new Error('Fixture unknown result'));
      await expect(runDisplayCycle(test.io, '100001', display.context)).rejects.toThrow();
      expect(test.io.submit).toHaveBeenCalledOnce();
      expect(test.io.recover).toHaveBeenCalledTimes(phase === 'submit' ? 0 : 1);
      expect(test.io.refresh).not.toHaveBeenCalled();
    }
  );
  it('stops on platform auditing, without recovery, task refresh or a false pass', async () => {
    const test = cycle();
    test.io.read = vi.fn<CycleIo['read']>((phase) =>
      Promise.resolve(page(phase === 'baseline' ? 'online' : 'auditing'))
    );
    await expect(runDisplayCycle(test.io, '100001', display.context)).rejects.toThrow(
      'PLATFORM_AUDITING_STOP'
    );
    expect(test.io.recover).not.toHaveBeenCalled();
    expect(test.io.refresh).not.toHaveBeenCalled();
  });
  it('refuses protocol, context, cipher or persistence drift before recovery', async () => {
    for (const changed of [
      { protocol: 'top' },
      { encryptedProductId: 'fixture-cipher' },
      { productContext: { ...display.context, gateway: 'd'.repeat(64) } }
    ]) {
      const test = cycle();
      test.io.submit = vi.fn(() => Promise.resolve({ ...job(), ...changed }));
      await expect(runDisplayCycle(test.io, '100001', display.context)).rejects.toThrow(
        'PERSISTED_IOP_BINDING_REQUIRED'
      );
      expect(test.io.recover).not.toHaveBeenCalled();
    }
    const test = cycle();
    test.io.stored = vi.fn(() => Promise.resolve(false));
    await expect(runDisplayCycle(test.io, '100001', display.context)).rejects.toThrow(
      'PERSISTED_IOP_BINDING_REQUIRED'
    );
    expect(test.io.recover).not.toHaveBeenCalled();
  });
  it('permits only two native display writes after persisted submit/recovery snapshots', async () => {
    const test = setupGuard();
    guard().arm('submit', fixture.receipt.requestId);
    await test.request(listUrl, fixture.list);
    await test.request(writeUrl, fixture.offline);
    guard().disarm();
    guard().bindJob(fixture.receipt.id);
    test.saved.status = 'recovering';
    test.saved.recoveryRequestId = fixture.recoveryRequestId;
    guard().arm('recover', null);
    await test.request(listUrl, fixture.list, fixture.wireRequestId);
    await test.request(writeUrl, fixture.online, fixture.wireRequestId);
    guard().disarm();
    expect(guard().snapshot()).toMatchObject({
      writes: 2,
      total: 4,
      submittedProof: true,
      recoveryProof: true
    });
    expect(() => {
      guard().arm('recover', null);
    }).toThrow('DISPLAY_NETWORK_DENIED');
    expect(test.send).toHaveBeenCalledTimes(4);
    for (const [input] of test.send.mock.calls) expect((input as Request).redirect).toBe('error');
  });
  it('never sends a recovery write without the persisted unique recovery marker', async () => {
    const test = setupGuard();
    guard().arm('submit', fixture.receipt.requestId);
    await test.request(listUrl, fixture.list);
    await test.request(writeUrl, fixture.offline);
    guard().disarm();
    guard().bindJob(fixture.receipt.id);
    test.saved.status = 'recovering';
    guard().arm('recover', null);
    await test.request(listUrl, fixture.list, fixture.wireRequestId);
    await expect(test.request(writeUrl, fixture.online, fixture.wireRequestId)).rejects.toThrow(
      'DISPLAY_NETWORK_DENIED'
    );
    expect(test.send).toHaveBeenCalledTimes(3);
    expect(guard().snapshot().writes).toBe(1);
  });
  it.each([
    'https://eco.taobao.com/router/rest',
    origin + '/rest/auth/token/refresh',
    origin + '/rest/icbu/product/schema/update',
    listUrl + '?id=100001'
  ])('denies TOP, token, other paths and query strings: %s', async (url) => {
    const test = setupGuard();
    guard().arm('baseline', fixture.receipt.requestId);
    await expect(test.request(url, fixture.list)).rejects.toThrow('DISPLAY_NETWORK_DENIED');
    expect(test.send).not.toHaveBeenCalled();
  });
  it('denies broad reads, duplicates, concurrent requests and a repeated mutation phase', async () => {
    const test = setupGuard();
    guard().arm('baseline', fixture.receipt.requestId);
    await expect(test.request(listUrl, { ...fixture.list, page_size: '30' })).rejects.toThrow(
      'DISPLAY_NETWORK_DENIED'
    );
    expect(test.send).not.toHaveBeenCalled();
    expect(() => {
      guard().arm('submit', fixture.receipt.requestId);
    }).toThrow();
  });
  it('accepts envelope-only trace metadata without inventing a random trace', () => {
    const credentials = fixture.credentials as GatewayCredentials;
    const normalized = normalizeIopBusinessResponse(
      envelope,
      'alibaba.icbu.product.batch.update.display',
      credentials
    );
    expect(normalized).toMatchObject({
      alibaba_icbu_product_batch_update_display_response: { sub_success: true, trace_id: envelope._trace_id_ }
    });
    const { _trace_id_: _trace, ...requestOnly } = envelope;
    expect(
      normalizeIopBusinessResponse(requestOnly, 'alibaba.icbu.product.batch.update.display', credentials)
    ).toMatchObject({
      alibaba_icbu_product_batch_update_display_response: { trace_id: envelope.request_id }
    });
    const { request_id: _request, ...noTrace } = requestOnly;
    expect(() =>
      normalizeIopBusinessResponse(noTrace, 'alibaba.icbu.product.batch.update.display', credentials)
    ).toThrow();
  });
});
