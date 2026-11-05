import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATTACHMENT_SOURCE,
  ATTACHMENT_CREDENTIAL_FILE,
  ATTACHMENT_S3_FILE,
  AttachmentAcceptanceTransport,
  createAttachmentAcceptanceClient,
  parseAttachmentSmokeOptions,
  parseAttachmentSmokeS3,
  parseAttachmentSmokeCredentials,
  runOrderAttachmentSmokeCli
} from '../smoke-order-attachment-real';
import {
  ORDER_ATTACHMENT_METHOD,
  type OrderAttachmentRepository
} from '../../packages/core/src/order-attachments';
import {
  createOrderAttachmentFile,
  uploadOrderAttachmentPlatform
} from '../../packages/core/src/order-attachment-platform';
import { IOP_BUSINESS_ENDPOINT } from '../../packages/core/src/alibaba-iop';
import { SqlOrderAttachmentRepository } from '../../apps/api/src/order-attachments/repository';
import type { NetworkTransport } from '../../packages/core/src/network';

const icon = Uint8Array.from(readFileSync(new URL('../../apps/extension/public/icon.png', import.meta.url)));
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const sourceUrl =
  ATTACHMENT_SOURCE.endpoint + '/dev/' + ATTACHMENT_SOURCE.rootPrefix + '/' + ATTACHMENT_SOURCE.key;
const uploadUrl = IOP_BUSINESS_ENDPOINT + ORDER_ATTACHMENT_METHOD;
const temporary: string[] = [];
const config = () => ({
  endpoint: ATTACHMENT_SOURCE.endpoint,
  region: 'us-east-1',
  bucket: 'dev',
  rootPrefix: ATTACHMENT_SOURCE.rootPrefix,
  accessKeyId: 'fixture-s3-access-key',
  secretAccessKey: 'fixture-s3-secret-key'
});
const bundle = () => {
  const capturedAtUtc = new Date().toISOString();
  return {
    schemaVersion: 1,
    protocol: 'iop',
    capturedAtUtc,
    application: {
      appName: 'fixture-attachment',
      appKey: 'fixture-attachment-app-key',
      appSecret: 'fixture-attachment-secret',
      callbackUrl: 'https://example.invalid/callback',
      status: 'active',
      permissions: []
    },
    oauth: {
      accessToken: 'fixture-attachment-token',
      refreshToken: 'fixture-refresh-never-used',
      expiresAtUtc: new Date(Date.now() + 600_000).toISOString(),
      refreshExpiresAtUtc: null
    },
    callback: {
      receivedAtUtc: capturedAtUtc,
      stateMatched: true,
      callbackOrigin: 'https://example.invalid',
      callbackPath: '/callback'
    }
  };
};
const cli = (directory = 'artifacts/order-attachment-offline-' + randomUUID()) => [
  '--confirm-test-attachment',
  '--credential=' + ATTACHMENT_CREDENTIAL_FILE,
  '--s3-config=' + ATTACHMENT_S3_FILE,
  '--source-key=' + ATTACHMENT_SOURCE.key,
  '--receipt-dir=' + directory
];
const requestInit = (id: string, method = 'POST'): RequestInit => ({
  method,
  credentials: 'omit',
  redirect: 'manual',
  headers: { 'X-Request-ID': id }
});
let unexpectedFetch: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  unexpectedFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('OFFLINE_TEST_NO_FETCH'));
});
afterEach(async () => {
  expect(unexpectedFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) {
    if (resolve(dirname(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ov-attachment-offline-'))
      throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true });
  }
});
async function harness(
  response: () => Response | Promise<Response> = () =>
    Response.json({
      code: 0,
      value: 'attachments/isolated-acceptance.png',
      request_id: 'fixture-trace-1'
    })
) {
  const root = await mkdtemp(join(tmpdir(), 'ov-attachment-offline-'));
  temporary.push(root);
  await mkdir(join(root, 'artifacts'));
  const args = cli();
  const options = parseAttachmentSmokeOptions(args);
  const credential = bundle();
  let s3Config: unknown = config();
  let source: Uint8Array = icon;
  const requests: Request[] = [];
  const readJson = vi.fn((path: string): Promise<unknown> =>
    Promise.resolve(
      path === ATTACHMENT_CREDENTIAL_FILE
        ? credential
        : path === ATTACHMENT_S3_FILE
          ? s3Config
          : Promise.reject(new Error('UNEXPECTED_PRIVATE_FILE'))
    )
  );
  const send = vi.fn<NetworkTransport['send']>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('manual');
    expect(request.headers.has('Cookie')).toBe(false);
    if (request.url === sourceUrl && request.method === 'GET')
      return new Response(Uint8Array.from(source).buffer, {
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(source.byteLength) }
      });
    expect(request.url).toBe(uploadUrl);
    expect(request.method).toBe('POST');
    const connection = new DatabaseSync(join(root, options.receiptDir, 'receipts.sqlite'), {
      readOnly: true
    });
    try {
      const row = connection.prepare('SELECT record_json FROM order_attachment_jobs').get();
      expect(row).toBeDefined();
      const record: unknown = JSON.parse(String(row?.record_json));
      expect(record).toMatchObject({
        receipt: {
          status: 'sending',
          size: ATTACHMENT_SOURCE.bytes,
          sha256: ATTACHMENT_SOURCE.sha256,
          requestId: request.headers.get('X-Request-ID')
        }
      });
    } finally {
      connection.close();
    }
    const form = await request.clone().formData();
    expect([...form.keys()].sort()).toEqual([
      'access_token',
      'app_key',
      'data',
      'file_name',
      'sign',
      'sign_method',
      'simplify',
      'timestamp'
    ]);
    const part = form.get('data');
    expect(part).toBeInstanceOf(File);
    if (!(part instanceof File)) throw new Error('FILE_PART_MISSING');
    expect(part.name).toMatch(/^ov-order-attachment-test-[a-f0-9-]+\.png$/u);
    expect(part.name).toBe(form.get('file_name'));
    expect(part.size).toBe(ATTACHMENT_SOURCE.bytes);
    expect(digest(new Uint8Array(await part.arrayBuffer()))).toBe(ATTACHMENT_SOURCE.sha256);
    return response();
  });
  const dependencies = { root, readJson, transport: { send } };
  return {
    args,
    options,
    root,
    requests,
    readJson,
    credential,
    send,
    run: () => runOrderAttachmentSmokeCli(args, dependencies),
    setConfig: (value: unknown) => {
      s3Config = value;
    },
    setSource: (value: Uint8Array) => {
      source = value;
    },
    report: async () =>
      JSON.parse(await readFile(join(root, options.receiptDir, 'report.json'), 'utf8')) as unknown,
    rejection: async () =>
      JSON.parse(
        await readFile(join(root, options.receiptDir, 'provider-rejection.json'), 'utf8')
      ) as unknown,
    database: () => new DatabaseSync(join(root, options.receiptDir, 'receipts.sqlite'), { readOnly: true })
  };
}

describe('explicit one-shot attachment acceptance preflight', () => {
  it('uses the exact existing nonbusiness leaf icon fixture', () => {
    expect(icon.byteLength).toBe(ATTACHMENT_SOURCE.bytes);
    expect(digest(icon)).toBe(ATTACHMENT_SOURCE.sha256);
    expect(parseAttachmentSmokeOptions(cli()).sourceKey).toBe(ATTACHMENT_SOURCE.key);
  });
  it.each([
    (args: string[]) => args.slice(1),
    (args: string[]) => [...args, '--confirm-test-attachment'],
    (args: string[]) => args.map((v) => (v.startsWith('--source-key=') ? '--source-key=other.png' : v)),
    (args: string[]) => args.map((v) => (v.startsWith('--credential=') ? '--credential=D:/other.json' : v)),
    (args: string[]) => args.map((v) => (v.startsWith('--s3-config=') ? '--s3-config=D:/other.json' : v)),
    (args: string[]) =>
      args.map((v) => (v.startsWith('--receipt-dir=') ? '--receipt-dir=artifacts/../existing' : v)),
    (args: string[]) =>
      args.map((v) => (v.startsWith('--receipt-dir=') ? '--receipt-dir=D:/outside/existing' : v))
  ])('rejects missing/duplicate/expanded options before I/O %#', (invalid) => {
    expect(() => parseAttachmentSmokeOptions(invalid(cli()))).toThrow('ORDER_ATTACHMENT_SMOKE_');
  });
  it.each([
    { endpoint: 'https://other.invalid' },
    { bucket: 'production' },
    { rootPrefix: 'onevegetable/file-manager-test-other' },
    { pathStyle: false },
    { sessionToken: 'not-allowed' }
  ])('denies any expanded S3 scope %o', (change) => {
    expect(() => parseAttachmentSmokeS3({ ...config(), ...change })).toThrow('S3_SCOPE_DENIED');
  });
  it('requires explicit IOP with a known unexpired token and never refreshes', () => {
    const valid = bundle();
    expect(parseAttachmentSmokeCredentials(valid).credentials.protocol).toBe('iop');
    expect(() => parseAttachmentSmokeCredentials({ ...valid, protocol: 'top' })).toThrow(
      'EXPLICIT_IOP_REQUIRED'
    );
    expect(() => parseAttachmentSmokeCredentials({ ...valid, protocol: undefined })).toThrow(
      'EXPLICIT_IOP_REQUIRED'
    );
    expect(() =>
      parseAttachmentSmokeCredentials({ ...valid, oauth: { ...valid.oauth, expiresAtUtc: null } })
    ).toThrow('UNEXPIRED_IOP_REQUIRED');
    expect(() =>
      parseAttachmentSmokeCredentials({
        ...valid,
        oauth: { ...valid.oauth, expiresAtUtc: new Date(0).toISOString() }
      })
    ).toThrow('UNEXPIRED_IOP_REQUIRED');
  });
});

describe('isolated attachment execution with mock transport only', () => {
  it('commits sending before one GET/one POST, writes only a hash reference report, and has no target readback claim', async () => {
    const h = await harness();
    const summary = await h.run();
    expect(summary).toMatchObject({
      status: 'accepted',
      bytes: ATTACHMENT_SOURCE.bytes,
      sha256: ATTACHMENT_SOURCE.sha256,
      traceId: 'fixture-trace-1',
      referenceSha256: digest('attachments/isolated-acceptance.png')
    });
    expect(h.requests).toHaveLength(2);
    expect(await h.report()).toMatchObject({
      status: 'accepted',
      interpretation: 'accepted but not order association/content-readback',
      orderAssociation: false,
      contentReadback: 'not-provided-by-platform',
      configurationChanged: false,
      s3Reads: 1,
      uploads: 1,
      topRequests: 0,
      tokenRequests: 0,
      noAutomaticRetry: true
    });
    const report = JSON.stringify(await h.report());
    expect(report).not.toContain('attachments/isolated-acceptance.png');
    expect(report).not.toContain('fixture-attachment-token');
    expect(report).not.toContain('fixture-s3-secret-key');
    const db = h.database();
    try {
      const raw = String(db.prepare('SELECT record_json FROM order_attachment_jobs').get()?.record_json);
      expect(raw).toContain('"status":"accepted"');
      expect(raw).not.toContain('contentBase64');
      expect(raw).not.toContain('fixture-attachment-token');
      expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 19 }]);
      expect(db.prepare('PRAGMA synchronous').get()?.synchronous).toBeDefined();
    } finally {
      db.close();
    }
  });
  it('refuses reusing the receipt directory before reading private inputs or sending again', async () => {
    const h = await harness();
    await h.run();
    h.readJson.mockClear();
    await expect(h.run()).rejects.toMatchObject({ code: 'EEXIST' });
    expect(h.readJson).not.toHaveBeenCalled();
    expect(h.requests).toHaveLength(2);
  });
  it('never sends an upload if initial repository persistence fails', async () => {
    const h = await harness();
    vi.spyOn(SqlOrderAttachmentRepository.prototype, 'insert').mockRejectedValueOnce(
      new Error('SIMULATED_DISK_FAILURE')
    );
    expect(await h.run()).toMatchObject({ status: 'preflight-failed' });
    expect(h.requests).toHaveLength(1);
    expect(await h.report()).toMatchObject({ uploads: 0 });
  });
  it('rejects source-content drift before claiming or uploading', async () => {
    const h = await harness();
    h.setSource(icon.slice(0, -1));
    expect(await h.run()).toMatchObject({ status: 'preflight-failed' });
    expect(h.requests).toHaveLength(1);
    const db = h.database();
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM order_attachment_jobs').get()?.n).toBe(0);
    } finally {
      db.close();
    }
  });
  it('does not read S3 if its private config expands the allowed scope', async () => {
    const h = await harness();
    h.setConfig({ ...config(), bucket: 'production' });
    expect(await h.run()).toMatchObject({ status: 'preflight-failed' });
    expect(h.requests).toHaveLength(0);
  });
  it.each([
    () =>
      Response.json({
        code: 'InsufficientPermission',
        message: 'fixture-attachment-token https://private.invalid/?signature=secret',
        request_id: 'fixture-reject-trace'
      }),
    () => Response.json({ code: 0, value: '', request_id: 'fixture-empty-trace' }),
    () => Response.json({ code: 0, value: 'https://private.invalid/?signature=secret' }),
    () => Response.json({ code: 0, value: 'attachments/fixture-attachment-token' }),
    () => new Response(null, { status: 302, headers: { Location: 'https://other.invalid/unapproved' } })
  ])('keeps rejection/invalid success/redirect uncertain and never auto-retries %#', async (response) => {
    const h = await harness(response);
    expect(await h.run()).toMatchObject({ status: 'unknown', referenceSha256: null });
    expect(h.requests).toHaveLength(2);
    expect(await h.report()).toMatchObject({ uploads: 1, noAutomaticRetry: true });
    const db = h.database();
    try {
      const raw = String(db.prepare('SELECT record_json FROM order_attachment_jobs').get()?.record_json);
      expect(raw).toContain('"status":"unknown"');
      expect(raw).not.toContain('private.invalid');
      expect(raw).not.toContain('fixture-attachment-token');
    } finally {
      db.close();
    }
  });
  it('writes sanitized provider rejection codes separately without its message or credentials', async () => {
    const h = await harness(() =>
      Response.json({
        code: 'InsufficientPermission',
        message: 'fixture-attachment-secret https://private.invalid/?signature=secret',
        request_id: 'fixture-reject-trace'
      })
    );
    await h.run();
    expect(await h.rejection()).toEqual({
      code: 'ALIBABA_IOP_API_REJECTED',
      subCode: 'InsufficientPermission',
      traceId: 'fixture-reject-trace',
      httpStatus: 200
    });
    expect(JSON.stringify(await h.rejection())).not.toContain('private.invalid');
    expect(JSON.stringify(await h.rejection())).not.toContain('fixture-attachment-secret');
  });
  it('does not retry transport errors and persists no error text', async () => {
    const h = await harness(() => {
      throw new Error('fixture-attachment-token https://private.invalid/?signature=secret');
    });
    expect(await h.run()).toMatchObject({ status: 'unknown' });
    expect(h.requests).toHaveLength(2);
    expect(JSON.stringify(await h.report())).not.toContain('private.invalid');
    expect(await h.rejection()).toMatchObject({ code: 'ORDER_ATTACHMENT_RESULT_UNKNOWN', subCode: null });
  });
});

describe('fences below the shared pure multipart builder', () => {
  it('denies a native upload without the durable sending claim', async () => {
    const requestId = randomUUID();
    const get = vi.fn<OrderAttachmentRepository['get']>().mockResolvedValue(null);
    const insert = vi.fn<OrderAttachmentRepository['insert']>();
    const repository: OrderAttachmentRepository = { get, insert, finish: vi.fn() };
    const native = { send: vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(icon.buffer)) };
    const transport = new AttachmentAcceptanceTransport(repository, requestId, 'b'.repeat(64), native);
    await transport.send(sourceUrl, requestInit(requestId, 'GET'));
    const file = createOrderAttachmentFile('ov-order-attachment-test-' + requestId + '.png', icon);
    const parsed = parseAttachmentSmokeCredentials(bundle());
    const client = await createAttachmentAcceptanceClient({ ...parsed, file, requestId, transport });
    await expect(uploadOrderAttachmentPlatform(client, file)).rejects.toThrow('RESULT_UNKNOWN');
    expect(transport.uploads).toBe(0);
    expect(native.send).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
  });
  it.each([
    ['https://example.invalid/router', 'POST'],
    [IOP_BUSINESS_ENDPOINT + '/auth/token/refresh', 'POST'],
    [uploadUrl + '?extra=1', 'POST'],
    [sourceUrl, 'PUT']
  ])('denies every other URL/method %s %s', async (url, method) => {
    const repository: OrderAttachmentRepository = { get: vi.fn(), insert: vi.fn(), finish: vi.fn() };
    const native = { send: vi.fn<NetworkTransport['send']>() };
    const requestId = randomUUID();
    const transport = new AttachmentAcceptanceTransport(repository, requestId, 'b'.repeat(64), native);
    await expect(transport.send(url, requestInit(requestId, method))).rejects.toThrow(
      'ORDER_ATTACHMENT_SMOKE_'
    );
    expect(native.send).not.toHaveBeenCalled();
  });
  it('denies cookies, redirect following and a second GET before delegating', async () => {
    const repository: OrderAttachmentRepository = { get: vi.fn(), insert: vi.fn(), finish: vi.fn() };
    const native = { send: vi.fn<NetworkTransport['send']>().mockResolvedValue(new Response(icon.buffer)) };
    const id = randomUUID();
    const transport = new AttachmentAcceptanceTransport(repository, id, 'b'.repeat(64), native);
    await expect(
      transport.send(sourceUrl, { ...requestInit(id, 'GET'), redirect: 'follow' })
    ).rejects.toThrow('TRANSPORT_POLICY_DENIED');
    await expect(
      transport.send(sourceUrl, {
        ...requestInit(id, 'GET'),
        headers: { 'X-Request-ID': id, Cookie: 'never=send' }
      })
    ).rejects.toThrow('TRANSPORT_POLICY_DENIED');
    await transport.send(sourceUrl, requestInit(id, 'GET'));
    await expect(transport.send(sourceUrl, requestInit(id, 'GET'))).rejects.toThrow('SOURCE_READ_LIMIT');
    expect(native.send).toHaveBeenCalledOnce();
  });
});
