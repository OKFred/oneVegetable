import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayException } from '../../packages/core/src/errors';
import type { NetworkTransport } from '../../packages/core/src/network';
import type { S3StorageConfiguration } from '../../packages/core/src/s3-storage';
import type { VideoUploadTask } from '../../packages/core/src/video-upload';
import {
  assertRange,
  assertSignedSource,
  BffDiagnosticError,
  classifyUrlSmokeFailure,
  localUrlBff,
  newUrlJournal,
  parseUrlJournal,
  parseUrlOptions,
  publicUrlConfiguration,
  PUBLIC_S3_ORIGIN,
  signPublicUrl,
  SOURCE_PATH,
  URL_SOURCE,
  UrlAcceptanceRun,
  urlNetworkIo,
  UrlSmokeError,
  type UrlIo,
  type UrlJournal,
  type UrlPhase
} from '../lib/video-upload-url-real';

const runId = '12345678-1234-4234-8234-123456789012';
const taskId = 'abcdef12-1234-4234-8234-123456789012';
const runArg = `--run=${runId}`,
  taskArg = `--task=${taskId}`,
  sourceArg = `--source-key=${URL_SOURCE.key}`;
const live = { ONE_VEGETABLE_VIDEO_UPLOAD_URL_REAL_SMOKE: '1' };
const write = { ...live, ONE_VEGETABLE_VIDEO_UPLOAD_REAL_SMOKE: '1' };
const context = { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), storage: 'c'.repeat(64) };
const configuration: S3StorageConfiguration = {
  endpoint: 'https://oss-s3.app.fred.wiki',
  bucket: 'dev',
  pathStyle: true,
  rootPrefix: 'old-prefix',
  region: 'us-east-1',
  accessKeyId: 'OFFLINE-ACCESS',
  secretAccessKey: 'OFFLINE-SECRET',
  sessionToken: null
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('LIVE_NETWORK_FORBIDDEN_IN_TEST');
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function signedUrl() {
  const url = new URL(`${PUBLIC_S3_ORIGIN}${SOURCE_PATH}`);
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', 'OFFLINE-ACCESS/date/us-east-1/s3/aws4_request');
  url.searchParams.set(
    'X-Amz-Date',
    new Date()
      .toISOString()
      .replaceAll(/[-:]/gu, '')
      .replace(/\.\d{3}Z$/u, 'Z')
  );
  url.searchParams.set('X-Amz-Expires', '1800');
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  url.searchParams.set('X-Amz-Signature', 'd'.repeat(64));
  return url.href;
}
function urlTask(url: string, status: VideoUploadTask['status'] = 'prepared'): VideoUploadTask {
  return {
    schemaVersion: 1,
    id: taskId,
    revision: 1,
    context,
    title: 'offline URL task',
    source: 'url',
    file: null,
    sourceFingerprint: createHash('sha256').update(url).digest('hex'),
    objectKey: null,
    parts: [],
    status,
    createTimeUtc: 1,
    updateTimeUtc: 1,
    acceptedTimeUtc: null,
    videoId: null,
    traceId: null,
    reasonCode: null,
    requestId: runId
  };
}
function verifiedJournal(): UrlJournal {
  return {
    ...newUrlJournal(runId),
    sourceVerified: true,
    calls: Array.from({ length: 3 }, () => ({ phase: 'source.range', requestId: runId, outcome: 'response' }))
  };
}
function fixture(state = verifiedJournal(), failAt?: UrlPhase) {
  const url = signedUrl(),
    source = { url, storageContext: context.storage };
  const snapshots: string[] = [];
  const sent: { phase: UrlPhase; payload: Record<string, unknown> }[] = [];
  const persist = vi.fn(() => {
    snapshots.push(JSON.stringify(state));
    return Promise.resolve();
  });
  const io: UrlIo = {
    sign: vi.fn(() => Promise.resolve(source)),
    credentials: vi.fn(() => Promise.resolve({ username: 'OFFLINE-ADMIN', password: 'OFFLINE-PASSWORD' })),
    range: vi.fn(() => Promise.reject(new Error('NO_RANGE_EXPECTED'))),
    bff: vi.fn<UrlIo['bff']>((phase, payload, requestId) => {
      // The latest persisted intent must exist before EVERY simulated request.
      const saved = parseUrlJournal(JSON.parse(snapshots.at(-1) ?? 'null') as unknown, runId);
      expect(saved.calls.at(-1)).toEqual({ phase, requestId, outcome: 'intent' });
      sent.push({ phase, payload });
      if (phase === failAt) return Promise.reject(new Error(`lost response ${url} OFFLINE-SECRET`));
      const responses: Partial<Record<UrlPhase, unknown>> = {
        login: { user: { role: 'admin', status: 'active' }, session: { csrfToken: 'OFFLINE-CSRF' } },
        meta: { runtime: 'node', environment: 'local-node', gatewayMode: 'real' },
        storage: { endpoint: PUBLIC_S3_ORIGIN, bucket: 'dev', pathStyle: true, rootPrefix: '' },
        context,
        'video.list': { tasks: [], uploadEnabled: true },
        'video.create': { tasks: [urlTask(url)], uploadEnabled: true },
        'video.submit': { tasks: [urlTask(url, 'accepted')], uploadEnabled: true },
        'video.get': { tasks: [urlTask(url, 'accepted')], uploadEnabled: false },
        'video.verify': { tasks: [urlTask(url, 'confirmed')], uploadEnabled: false }
      };
      return Promise.resolve(responses[phase]);
    })
  };
  return { state, snapshots, sent, io, source, runner: new UrlAcceptanceRun(state, persist) };
}

describe('URL mode scope and opt-ins', () => {
  it('never opts into a live action by environment alone', () => {
    expect(parseUrlOptions([], write)).toEqual({ action: 'preflight', runId: null, taskId: null });
    expect(() => parseUrlOptions(['--submit', runArg, sourceArg], {})).toThrow('URL_LIVE_OPT_IN_REQUIRED');
    expect(() => parseUrlOptions(['--submit', runArg, sourceArg], live)).toThrow(
      'VIDEO_WRITE_OPT_IN_REQUIRED'
    );
    expect(parseUrlOptions(['--submit', runArg, sourceArg], write).action).toBe('submit');
    expect(parseUrlOptions(['--verify', runArg, taskArg], live).action).toBe('verify');
  });
  it.each([
    ['--submit', runArg],
    ['--submit', runArg, '--source-key=other'],
    ['--submit', runArg, sourceArg, taskArg],
    ['--submit', '--verify', runArg, sourceArg],
    ['--submit', '--submit', runArg, sourceArg],
    ['--submit=1', runArg, sourceArg],
    ['--submit', '--run=../other', sourceArg],
    ['--preflight', runArg],
    [runArg],
    ['--verify', runArg],
    ['--verify', runArg, taskArg, sourceArg],
    ['--submit', runArg, sourceArg, '--resume'],
    ['--stage', runArg],
    ['--submit', runArg, '--source-key=']
  ])('rejects ambiguous/out-of-scope CLI: %j', (...args) => {
    expect(() => parseUrlOptions(args, write)).toThrow();
  });
  it('pins only port 8798 and canonical loopback URLs', () => {
    expect(localUrlBff()).toBe('http://127.0.0.1:8798');
    expect(localUrlBff('http://localhost:8798')).toBe('http://localhost:8798');
    for (const url of [
      'https://example.com',
      'http://localhost:8787',
      'http://localhost:8798/',
      'http://localhost:8798?x=1',
      'http://user@localhost:8798'
    ])
      expect(() => localUrlBff(url)).toThrow('EXACT_LOCAL_BFF_REQUIRED');
  });
});

describe('public signing and source verification', () => {
  it('signs the exact PUBLIC dev path anew, without mutating stored configuration or making a request', async () => {
    const before = structuredClone(configuration);
    const prepared = publicUrlConfiguration(configuration);
    expect(prepared).toMatchObject({
      endpoint: PUBLIC_S3_ORIGIN,
      bucket: 'dev',
      rootPrefix: '',
      pathStyle: true
    });
    const source = await signPublicUrl(configuration);
    const parsed = new URL(source.url);
    expect(parsed.origin).toBe(PUBLIC_S3_ORIGIN);
    expect(parsed.pathname).toBe(SOURCE_PATH);
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => {
      assertSignedSource(source.url);
    }).not.toThrow();
    expect(configuration).toEqual(before);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('rejects a nonapproved credential source and invalid/retargeted/expired signed URLs', () => {
    for (const patch of [
      { endpoint: 'https://other.example' },
      { bucket: 'prod' },
      { pathStyle: false },
      { allowInsecureLocal: true }
    ])
      expect(() => publicUrlConfiguration({ ...configuration, ...patch })).toThrow();
    for (const change of [
      (url: URL) => {
        url.host = 'oss-s3.app.fred.wiki';
      },
      (url: URL) => {
        url.pathname = '/dev/other.mp4';
      },
      (url: URL) => {
        url.searchParams.delete('X-Amz-Signature');
      },
      (url: URL) => {
        url.searchParams.append('X-Amz-Expires', '1800');
      },
      (url: URL) => {
        url.searchParams.set('X-Amz-Date', '20200101T000000Z');
      },
      (url: URL) => {
        url.username = 'secret';
      }
    ]) {
      const url = new URL(signedUrl());
      change(url);
      expect(() => {
        assertSignedSource(url.href);
      }).toThrow();
    }
  });
  it('requires exact 206, range totals, lengths, and MP4 header', () => {
    const bytes = Buffer.alloc(4096);
    bytes.writeUInt32BE(24);
    bytes.write('ftyp', 4);
    bytes.write('isom', 8);
    const response = {
      status: 206,
      bytes,
      headers: new Headers({
        'content-length': '4096',
        'content-range': `bytes 0-4095/${URL_SOURCE.byteLength}`
      })
    };
    expect(() => {
      assertRange(response, 0, 4095);
    }).not.toThrow();
    expect(() => {
      assertRange({ ...response, status: 200 }, 0, 4095);
    }).toThrow();
    expect(() => {
      assertRange({ ...response, headers: new Headers({ 'content-range': 'bytes 0-4095/999' }) }, 0, 4095);
    }).toThrow();
    expect(() => {
      assertRange({ ...response, bytes: Buffer.alloc(4096) }, 0, 4095);
    }).toThrow('PUBLIC_MP4_INVALID');
  });
  it('checks public ranges before login and blocks all BFF calls if full SHA-256 differs', async () => {
    const f = fixture(newUrlJournal(runId));
    const bytes = Buffer.alloc(URL_SOURCE.byteLength);
    bytes.writeUInt32BE(24);
    bytes.write('ftyp', 4);
    bytes.write('isom', 8);
    f.io.range = vi.fn<UrlIo['range']>((_url, start, end) => {
      expect(f.state.calls.at(-1)).toMatchObject({ phase: 'source.range', outcome: 'intent' });
      return Promise.resolve({
        status: 206,
        bytes: bytes.subarray(start, end + 1),
        headers: new Headers({
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${URL_SOURCE.byteLength}`
        })
      });
    });
    await expect(f.runner.submit(f.io)).rejects.toThrow('PUBLIC_OBJECT_SHA256_MISMATCH');
    expect(f.io.range).toHaveBeenCalledTimes(3);
    expect(f.io.bff).not.toHaveBeenCalled();
    expect(f.io.credentials).not.toHaveBeenCalled();
    expect(f.state.sourceVerified).toBe(false);
    await expect(f.runner.submit(f.io)).rejects.toThrow('URL_RUN_ALREADY_USED');
    expect(f.io.sign).toHaveBeenCalledTimes(1);
  });
});

describe('single-use URL create/submit and read-only follow-up', () => {
  it('after source verification, creates and submits the IDENTICAL URL once; persists no secrets', async () => {
    const f = fixture();
    await f.runner.submitVerified(f.io, f.source);
    expect(f.sent.map((item) => item.phase)).toEqual([
      'login',
      'meta',
      'storage',
      'context',
      'video.list',
      'video.create',
      'video.submit'
    ]);
    expect(f.sent.find((item) => item.phase === 'video.create')?.payload).toMatchObject({
      command: { action: 'create', source: { kind: 'url', url: f.source.url } }
    });
    expect(f.sent.find((item) => item.phase === 'video.submit')?.payload).toMatchObject({
      command: { action: 'submit', taskId, sourceUrl: f.source.url, confirmed: true }
    });
    expect(f.state.status).toBe('submitted-readback-required');
    expect(f.state.taskId).toBe(taskId);
    expect(f.snapshots.join('')).not.toMatch(/X-Amz|OFFLINE|sourceUrl|https:|csrfToken|password/u);
    await expect(f.runner.submit(f.io)).rejects.toThrow('URL_RUN_ALREADY_USED');
    expect(f.sent.filter((item) => item.phase === 'video.submit')).toHaveLength(1);
  });
  it.each(['video.create', 'video.submit'] as const)(
    'lost %s replies cannot retry, recreate, or resign',
    async (phase) => {
      const f = fixture(verifiedJournal(), phase);
      await expect(f.runner.submitVerified(f.io, f.source)).rejects.toThrow('lost response');
      expect(f.state.calls.at(-1)).toMatchObject({ phase, outcome: 'error' });
      const resumed = new UrlAcceptanceRun(
        parseUrlJournal(JSON.parse(JSON.stringify(f.state)) as unknown, runId),
        () => Promise.resolve()
      );
      await expect(resumed.submit(f.io)).rejects.toThrow('URL_RUN_ALREADY_USED');
      expect(f.io.sign).not.toHaveBeenCalled();
      expect(f.sent.filter((item) => item.phase === phase)).toHaveLength(1);
      expect(JSON.stringify(f.state)).not.toContain(f.source.url);
    }
  );
  it('a fingerprint mismatch stops before submit', async () => {
    const f = fixture();
    const original = f.io.bff;
    f.io.bff = (phase, payload, requestId) =>
      phase === 'video.create'
        ? Promise.resolve({ tasks: [urlTask(`${f.source.url}&different=1`)], uploadEnabled: true })
        : original(phase, payload, requestId);
    await expect(f.runner.submitVerified(f.io, f.source)).rejects.toThrow('URL_FINGERPRINT_MISMATCH');
    expect(f.state.taskId).toBe(taskId);
    expect(f.sent.some((item) => item.phase === 'video.submit')).toBe(false);
  });
  it('verify uses login/context/get/verify only, with no signing/source reads/create/submit', async () => {
    const f = fixture();
    f.state.taskId = taskId;
    f.state.calls.push({ phase: 'video.submit', requestId: runId, outcome: 'error' });
    await f.runner.verify(f.io, taskId);
    expect(f.sent.map((item) => item.phase)).toEqual([
      'login',
      'meta',
      'storage',
      'context',
      'video.get',
      'video.verify'
    ]);
    expect(f.state.status).toBe('readback-confirmed');
    expect(f.io.sign).not.toHaveBeenCalled();
    expect(f.io.range).not.toHaveBeenCalled();
    await expect(f.runner.verify(f.io, runId)).rejects.toThrow('EXACT_SUBMITTED_TASK_REQUIRED');
  });
  it('failed intent persistence prevents its network call', async () => {
    const state = newUrlJournal(runId);
    const error = Object.assign(new Error('SECRET disk path'), { code: 'EPERM', path: 'SECRET' });
    const persist = vi.fn(() => Promise.reject(error));
    const runner = new UrlAcceptanceRun(state, persist);
    const send = vi.fn(() => Promise.resolve(null));
    await expect(runner.call('video.create', send)).rejects.toBe(error);
    expect(classifyUrlSmokeFailure(error)).toBe('EPERM');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(state.calls.at(-1)?.outcome).toBe('intent');
    expect(send).not.toHaveBeenCalled();
  });
  it('journal loading removes unknown payload fields and rejects corrupt identities', () => {
    const state = newUrlJournal(runId);
    expect(parseUrlJournal({ ...state, signedUrl: 'SECRET', password: 'SECRET' }, runId)).toEqual(state);
    expect(() => parseUrlJournal(state, taskId)).toThrow('URL_JOURNAL_INVALID');
    expect(() =>
      parseUrlJournal(
        { ...state, calls: [{ phase: 'delete', requestId: runId, outcome: 'response' }] },
        runId
      )
    ).toThrow();
  });
});

describe('safe local and network failure classification', () => {
  it.each([
    'EPERM',
    'EACCES',
    'EBUSY',
    'ENOSPC',
    'EIO',
    'ENOENT',
    'ENOTDIR',
    'EISDIR',
    'EMFILE',
    'ENFILE',
    'EROFS',
    'EEXIST',
    'ENAMETOOLONG',
    'EXDEV',
    'EDQUOT'
  ])('exposes only the exact filesystem errno %s', (code) => {
    expect(
      classifyUrlSmokeFailure(
        Object.assign(new Error(signedUrl()), {
          code,
          path: 'SECRET',
          dest: 'SECRET',
          syscall: 'SECRET',
          cause: new Error('SECRET')
        })
      )
    ).toBe(code);
  });
  it.each([
    'NETWORK_ERROR',
    'INVALID_REQUEST_ID',
    'NETWORK_SERVICE_NOT_CONFIGURED',
    'NETWORK_REDIRECT_DENIED',
    'REQUEST_TIMEOUT',
    'RETRY_EXHAUSTED',
    'NETWORK_URL_DENIED',
    'NETWORK_REQUEST_SIZE_INVALID',
    'NETWORK_REQUEST_TOO_LARGE',
    'NETWORK_RESPONSE_TOO_LARGE',
    'INVALID_JSON_RESPONSE',
    'VIDEO_RESPONSE_INVALID',
    'VIDEO_BASELINE_INCOMPLETE'
  ])('keeps project-owned gateway code %s without provider details', (code) => {
    const error = new GatewayException({ code, message: signedUrl(), retryable: false, subCode: 'SECRET' });
    expect(classifyUrlSmokeFailure(error)).toBe(code);
  });
  it('preserves safe BFF diagnostics and known local guard codes', () => {
    expect(classifyUrlSmokeFailure(new BffDiagnosticError('VIDEO_RESPONSE_INVALID', 400))).toBe(
      'VIDEO_RESPONSE_INVALID'
    );
    expect(classifyUrlSmokeFailure(new UrlSmokeError('EXACT_SOURCE_KEY_REQUIRED'))).toBe(
      'EXACT_SOURCE_KEY_REQUIRED'
    );
    expect(classifyUrlSmokeFailure({ code: 'REQUEST_TIMEOUT', message: signedUrl() })).toBe(
      'REQUEST_TIMEOUT'
    );
  });
  it.each([
    null,
    undefined,
    'EPERM',
    new Error('EPERM'),
    { code: 'EPERM SECRET' },
    { code: 'NETWORK_SECRET' },
    { code: 'ECONNRESET' },
    { message: 'EPERM', cause: { code: 'EIO' } },
    new UrlSmokeError('SECRET signed URL'),
    new GatewayException({ code: 'VIDEO_SECRET', message: 'SECRET', retryable: false })
  ])('unknown failures never expose messages, paths or nested causes (%#)', (error) => {
    expect(classifyUrlSmokeFailure(error)).toBe('URL_SMOKE_STOPPED_NO_RETRY');
  });
});

describe('bounded BFF diagnostics', () => {
  it.each([
    ['VIDEO_RESPONSE_INVALID', 400, 'VIDEO_RESPONSE_INVALID'],
    ['VIDEO_BASELINE_INCOMPLETE', 400, 'VIDEO_BASELINE_INCOMPLETE'],
    ['VIDEO_UPLOAD_DISABLED', 403, 'VIDEO_UPLOAD_DISABLED'],
    ['VIDEO_NOT_SUBMITTED', 400, 'VIDEO_NOT_SUBMITTED'],
    ['S3_REQUEST_FAILED', 502, 'S3_REQUEST_FAILED'],
    ['VIDEO_SECRET_ACCESS_TOKEN', 500, 'BFF_CALL_REJECTED_NO_RETRY'],
    ['https://secret.invalid/?X-Amz-Signature=secret', 500, 'BFF_CALL_REJECTED_NO_RETRY']
  ])('retains only exact allowlisted code/status: %s', async (code, status, expectedCode) => {
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      if (typeof init.body !== 'string') throw new Error('EXPECTED_JSON_BODY');
      const body = JSON.parse(init.body) as { requestId: string };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            requestId: body.requestId,
            ok: false,
            error: {
              code,
              message: 'SECRET signed-url',
              subCode: 'SECRET',
              signedUrl: 'https://secret.invalid'
            }
          }),
          { status }
        )
      );
    });
    const client = urlNetworkIo(localUrlBff(), { send });
    const state = newUrlJournal(runId);
    const runner = new UrlAcceptanceRun(state, () => Promise.resolve());
    await expect(runner.call('login', (id) => client.bff('login', {}, id))).rejects.toMatchObject({
      message: expectedCode,
      diagnostic: { code: expectedCode, httpStatus: status }
    });
    expect(state.calls.at(-1)).toMatchObject({
      outcome: 'error',
      diagnostic: { code: expectedCode, httpStatus: status }
    });
    expect(JSON.stringify(state)).not.toMatch(/SECRET|signed-url|signedUrl|message|subCode|https:/u);
    expect(parseUrlJournal(JSON.parse(JSON.stringify(state)) as unknown, runId)).toEqual(state);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('preserves HTTP status for non-JSON; mismatched IDs cannot supply error codes', async () => {
    for (const [body, status] of [
      ['<html>SECRET signed URL</html>', 502],
      [JSON.stringify({ requestId: taskId, ok: false, error: { code: 'VIDEO_RESPONSE_INVALID' } }), 400]
    ] as const) {
      const send = vi.fn(() => Promise.resolve(new Response(body, { status })));
      await expect(urlNetworkIo(localUrlBff(), { send }).bff('login', {}, runId)).rejects.toMatchObject({
        message: 'BFF_CALL_REJECTED_NO_RETRY',
        diagnostic: { code: 'BFF_CALL_REJECTED_NO_RETRY', httpStatus: status }
      });
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it('loads old journals unchanged and sanitizes new diagnostics', () => {
    const old = verifiedJournal();
    expect(parseUrlJournal(old, runId)).toEqual(old);
    const parsed = parseUrlJournal(
      {
        ...old,
        calls: [
          {
            phase: 'video.submit',
            requestId: runId,
            outcome: 'error',
            diagnostic: { code: 'SECRET', httpStatus: 'SECRET', message: 'SECRET', subCode: 'SECRET' }
          }
        ]
      },
      runId
    );
    expect(parsed.calls[0]?.diagnostic).toEqual({ code: 'BFF_CALL_REJECTED_NO_RETRY', httpStatus: null });
    expect(JSON.stringify(parsed)).not.toContain('SECRET');
    expect(new BffDiagnosticError('VIDEO_RESPONSE_INVALID', 1000).diagnostic.httpStatus).toBeNull();
  });
});

describe('exact-title baseline API', () => {
  it.each([0, null, 25] as const)('returns only count/page/total/code for total=%s', async (total) => {
    const f = fixture();
    f.state.taskId = taskId;
    f.state.status = 'stopped';
    const original = f.io.bff;
    const payloads: Record<string, unknown>[] = [];
    f.io.bff = (phase, payload, id) => {
      if (phase !== 'video.baseline') return original(phase, payload, id);
      payloads.push(payload);
      return Promise.resolve({
        page: 1,
        pageSize: 20,
        items: [],
        total,
        traceId: 'SECRET',
        queriedAt: 1,
        issues: ['SECRET']
      });
    };
    const result = await f.runner.diagnoseBaseline({ credentials: f.io.credentials, bff: f.io.bff }, taskId);
    expect(result).toEqual({
      count: 0,
      page: 1,
      total,
      code: total === 0 ? null : 'VIDEO_BASELINE_INCOMPLETE'
    });
    expect(payloads).toEqual([
      {
        operation: 'listVideos',
        payload: { page: 1, pageSize: 20, title: urlTask(f.source.url).title },
        galleryContext: context
      }
    ]);
    expect(f.state.calls.slice(3).map((call) => call.phase)).toEqual([
      'login',
      'meta',
      'storage',
      'context',
      'video.get',
      'video.baseline'
    ]);
    expect(f.state.status).toBe('stopped');
    expect(f.io.sign).not.toHaveBeenCalled();
    expect(f.io.range).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/SECRET|title|trace|issues|items/u);
    expect(JSON.stringify(f.state)).not.toContain('offline URL task');
    await expect(f.runner.diagnoseBaseline(f.io, runId)).rejects.toThrow('EXACT_DIAGNOSTIC_TASK_REQUIRED');
  });
  it('summarizes baseline failure but retains HTTP status only in safe journal diagnostics', async () => {
    const f = fixture();
    f.state.taskId = taskId;
    const original = f.io.bff;
    f.io.bff = (phase, payload, id) =>
      phase === 'video.baseline'
        ? Promise.reject(new BffDiagnosticError('VIDEO_RESPONSE_INVALID', 400))
        : original(phase, payload, id);
    await expect(f.runner.diagnoseBaseline(f.io, taskId)).resolves.toEqual({
      count: null,
      page: 1,
      total: null,
      code: 'VIDEO_RESPONSE_INVALID'
    });
    expect(f.state.calls.at(-1)?.diagnostic).toEqual({ code: 'VIDEO_RESPONSE_INVALID', httpStatus: 400 });
    expect(
      f.state.calls.some((call) => ['video.create', 'video.submit', 'video.verify'].includes(call.phase))
    ).toBe(false);
  });
});

describe('HTTP adapter (fake transport only)', () => {
  it('uses normal login cookies/CSRF locally; S3 gets neither Cookie nor Authorization, even after login', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const transport: NetworkTransport = {
      send: (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        requests.push({ url, init });
        if (url.startsWith(PUBLIC_S3_ORIGIN))
          return Promise.resolve(new Response(new Uint8Array(16), { status: 206 }));
        if (typeof init.body !== 'string') throw new Error('EXPECTED_JSON_BODY');
        const request = JSON.parse(init.body) as { requestId: string };
        const headers = new Headers({ 'content-type': 'application/json' });
        if (url.endsWith('/auth/login')) {
          headers.append('set-cookie', 'ov_session=OFFLINE-SESSION; Path=/; HttpOnly');
          headers.append('set-cookie', 'ov_csrf=OFFLINE-CSRF; Path=/');
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              requestId: request.requestId,
              ok: true,
              data: url.endsWith('/auth/login') ? { session: { csrfToken: 'OFFLINE-CSRF' } } : {}
            }),
            { headers }
          )
        );
      }
    };
    const client = urlNetworkIo(localUrlBff(), transport);
    await expect(client.bff('meta', {}, runId)).rejects.toThrow('NORMAL_LOGIN_CSRF_REQUIRED');
    expect(requests).toHaveLength(0);
    await client.bff('login', { username: 'OFFLINE', password: 'OFFLINE' }, runId);
    await client.bff('meta', {}, runId);
    const baseline = {
      operation: 'listVideos',
      payload: { page: 1, pageSize: 20, title: 'exact task title' },
      galleryContext: context
    };
    await client.bff('video.baseline', baseline, taskId);
    expect(requests[2]?.url).toBe('http://127.0.0.1:8798/api/v1/operations/call');
    expect(requests[2]?.init.body).toBe(JSON.stringify({ requestId: taskId, ...baseline }));
    await expect(
      client.bff('video.baseline', { ...baseline, operation: 'callCapability' }, taskId)
    ).rejects.toThrow('READ_ONLY_BASELINE_REQUEST_REQUIRED');
    await expect(
      client.bff('video.baseline', { ...baseline, payload: { ...baseline.payload, page: 2 } }, taskId)
    ).rejects.toThrow('READ_ONLY_BASELINE_REQUEST_REQUIRED');
    expect(requests).toHaveLength(3);
    await client.range(signedUrl(), 0, 15, runId);
    const local = new Headers(requests[1]?.init.headers),
      publicHeaders = new Headers(requests[3]?.init.headers);
    expect(local.get('Cookie')).toBe('ov_session=OFFLINE-SESSION; ov_csrf=OFFLINE-CSRF');
    expect(local.get('X-CSRF-Token')).toBe('OFFLINE-CSRF');
    expect(local.get('Origin')).toBe('http://localhost:5173');
    expect(publicHeaders.get('Cookie')).toBeNull();
    expect(publicHeaders.get('Authorization')).toBeNull();
    expect(publicHeaders.get('X-CSRF-Token')).toBeNull();
    expect(publicHeaders.get('Range')).toBe('bytes=0-15');
    expect(requests[3]?.init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'manual' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('denies redirects and never retries failed public reads', async () => {
    const send = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 302, headers: { Location: 'https://other.invalid' } }))
    );
    const client = urlNetworkIo(localUrlBff(), { send });
    await expect(client.range(signedUrl(), 0, 15, runId)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
