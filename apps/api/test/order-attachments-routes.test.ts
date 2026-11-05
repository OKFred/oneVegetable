import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accepted: true, upload: vi.fn() }));
vi.mock('@one-vegetable/core/alibaba-iop-business', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isAccountVerifiedIopMethod: () => mocks.accepted
}));
vi.mock('../../../packages/core/src/order-attachment-platform', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadOrderAttachmentPlatform: mocks.upload
}));
import { AlibabaClient, GatewayException } from '@one-vegetable/core';
import { galleryGatewayId, opaqueGalleryId } from '@one-vegetable/core/gallery-transfer-context';
import { registerOrderAttachmentRoutes } from '../src/order-attachments/routes';
import { SqlOrderAttachmentRepository } from '../src/order-attachments/repository';
import { openNodeDatabase, applyNodeMigrations, type NodeDatabaseHandle } from '../src/db/node-database';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import { EmergencyPauseFeatureFlags, StaticOperationFeatureFlags } from '../src/abac';
import { GatewayConfigurationError } from '../src/gateway/credentials';
import type { AsyncAlibabaCredentialProvider } from '../src/gateway/credentials';
import type { S3StorageConfigurationService } from '../src/storage/s3-configuration';
import {
  ORDER_ATTACHMENT_METHOD,
  type OrderAttachmentReceipt
} from '../../../packages/core/src/order-attachments';

let database: NodeDatabaseHandle | undefined;
beforeEach(() => {
  mocks.accepted = true;
  mocks.upload.mockReset().mockResolvedValue({ reference: '/attachments/opaque.pdf', traceId: 'trace-1' });
});
afterEach(() => {
  database?.connection.close();
  database = undefined;
  vi.restoreAllMocks();
});
const file = {
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  byteLength: 9,
  contentBase64: btoa('%PDF-1.7\n')
};
const password = 'Fixture-Order-Only-42!';
async function setup(withStorage = true) {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  if (!database.connection.prepare('SELECT 1 FROM schema_migrations WHERE version = 19').get())
    database.connection.exec(
      readFileSync(new URL('../drizzle/0019_order_attachment_jobs.sql', import.meta.url), 'utf8')
    );
  const authRepository = new SqlAuthRepository(database.executor);
  const auth = new AuthService({ repository: authRepository, bootstrapToken: 'fixture-bootstrap' });
  const admin = new AdminService(authRepository);
  const session = await auth.bootstrap({
    requestId: crypto.randomUUID(),
    bootstrapToken: 'fixture-bootstrap',
    username: 'orders-admin',
    password
  });
  const credentials = {
    protocol: 'iop' as const,
    appKey: 'fixture-app',
    appSecret: 'fixture-secret',
    accessToken: 'fixture-token',
    endpoint: 'https://api.alibaba.com/rest',
    signMethod: 'hmac-sha256' as const
  };
  const context = {
    identity: await opaqueGalleryId(session.user.id),
    gateway: await galleryGatewayId(credentials),
    storage: null
  };
  const resolveForOperation = vi.fn().mockResolvedValue(credentials);
  const requireCredentials = vi.fn().mockRejectedValue(new Error('must not use generic credentials'));
  const selectProtocol = vi.fn<NonNullable<AsyncAlibabaCredentialProvider['selectProtocol']>>(
    async (_operation, _payload, options) => {
      if (options?.galleryContext?.gateway !== (await galleryGatewayId(credentials)))
        throw new GatewayException({
          code: 'GALLERY_CONTEXT_CHANGED',
          message: 'GALLERY_CONTEXT_CHANGED',
          retryable: false
        });
      return 'iop' as const;
    }
  );
  const storage = {
    requireConfiguration: vi
      .fn()
      .mockRejectedValue(
        new GatewayConfigurationError('S3_STORAGE_NOT_CONFIGURED', 'S3_STORAGE_NOT_CONFIGURED')
      )
  } as unknown as S3StorageConfigurationService;
  const flags = new EmergencyPauseFeatureFlags(
    new StaticOperationFeatureFlags(new Set(['method:' + ORDER_ATTACHMENT_METHOD]))
  );
  const repository = new SqlOrderAttachmentRepository(database.executor);
  const app = new Hono();
  registerOrderAttachmentRoutes(app, {
    repository,
    auth,
    ...(withStorage ? { storage } : {}),
    flags,
    credentials: { resolveForOperation, requireCredentials, selectProtocol, status: vi.fn() }
  });
  const headers = {
    'Content-Type': 'application/json',
    Origin: 'http://localhost',
    Cookie: `ov_session=${session.sessionToken}`,
    'X-CSRF-Token': session.session.csrfToken
  };
  const upload = (overrides: Record<string, unknown> = {}, h = headers) =>
    app.request('/order-attachments/upload', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ requestId: crypto.randomUUID(), context, file, ...overrides })
    });
  const get = (jobId: string, h = headers) =>
    app.request('/order-attachments/get', {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ requestId: crypto.randomUUID(), jobId })
    });
  return {
    app,
    auth,
    admin,
    session,
    headers,
    upload,
    get,
    context,
    credentials,
    resolveForOperation,
    requireCredentials,
    selectProtocol,
    repository,
    flags
  };
}
async function receipt(response: Response): Promise<OrderAttachmentReceipt> {
  expect(response.status).toBe(200);
  const result = (await response.json()) as { data: OrderAttachmentReceipt };
  return result.data;
}

describe('order attachment BFF routes', () => {
  it('supports local files with no S3 service while rejecting a non-null S3 source context', async () => {
    const t = await setup(false);
    const saved = await receipt(await t.upload());
    expect(saved.status).toBe('accepted');
    expect(await receipt(await t.get(saved.jobId))).toEqual(saved);
    const response = await t.upload({ context: { ...t.context, storage: 'f'.repeat(64) } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'GALLERY_CONTEXT_CHANGED' } });
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
  it('uses actual method/file selection, maxAttempts 1, safe receipt and metadata-only get', async () => {
    const t = await setup();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network in receipt lookup'));
    const create = vi.spyOn(AlibabaClient, 'create');
    const audit = vi.spyOn(t.auth, 'audit');
    const requestId = crypto.randomUUID();
    const saved = await receipt(await t.upload({ requestId }));
    expect(saved).toMatchObject({
      jobId: requestId,
      requestId,
      status: 'accepted',
      platformReference: '/attachments/opaque.pdf'
    });
    expect(t.resolveForOperation).toHaveBeenCalledWith(
      'callCapability',
      { method: ORDER_ATTACHMENT_METHOD, parameters: { file_name: file.fileName } },
      { galleryContext: t.context, requestId }
    );
    expect(create).toHaveBeenCalledWith(t.credentials, { maxAttempts: 1, requestId });
    expect(await receipt(await t.get(saved.jobId))).toEqual(saved);
    expect(t.selectProtocol).toHaveBeenCalledOnce();
    expect(t.resolveForOperation).toHaveBeenCalledOnce();
    expect(t.requireCredentials).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.mock.calls)).not.toContain('/attachments/');
    expect(JSON.stringify(audit.mock.calls)).not.toContain('contentBase64');
  });
  it('requires administrator, session, origin and CSRF for upload and receipt lookup', async () => {
    const t = await setup();
    expect((await t.upload({}, { ...t.headers, Cookie: '' })).status).toBe(401);
    expect((await t.get(crypto.randomUUID(), { ...t.headers, Cookie: '' })).status).toBe(401);
    expect((await t.upload({}, { ...t.headers, 'X-CSRF-Token': '' })).status).toBe(403);
    expect((await t.upload({}, { ...t.headers, Origin: 'https://other.invalid' })).status).toBe(403);
    await t.admin.createUser({
      requestId: crypto.randomUUID(),
      actor: t.session.session.principal,
      username: 'orders-reader',
      password,
      role: 'user'
    });
    const user = await t.auth.login({ requestId: crypto.randomUUID(), username: 'orders-reader', password });
    const userHeaders = {
      ...t.headers,
      Cookie: `ov_session=${user.sessionToken}`,
      'X-CSRF-Token': user.session.csrfToken
    };
    expect((await t.upload({}, userHeaders)).status).toBe(403);
    expect((await t.get(crypto.randomUUID(), userHeaders)).status).toBe(403);
    expect(t.resolveForOperation).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('blocks unaccepted methods and emergency pause before creating a sending claim', async () => {
    const t = await setup();
    mocks.accepted = false;
    expect((await t.upload()).status).toBe(403);
    mocks.accepted = true;
    t.flags.setPaused(true);
    expect((await t.upload()).status).toBe(403);
    expect(t.resolveForOperation).not.toHaveBeenCalled();
    expect(database?.connection.prepare('SELECT COUNT(*) AS n FROM order_attachment_jobs').get()?.n).toBe(0);
  });
  it('rejects TOP, changed context and invalid native files before persistence/send', async () => {
    const t = await setup();
    t.resolveForOperation.mockResolvedValueOnce({ ...t.credentials, protocol: 'top' });
    expect((await t.upload()).status).toBe(403);
    expect((await t.upload({ context: { ...t.context, gateway: 'f'.repeat(64) } })).status).toBe(409);
    expect((await t.upload({ file: { ...file, byteLength: 999 } })).status).toBe(400);
    expect(database?.connection.prepare('SELECT COUNT(*) AS n FROM order_attachment_jobs').get()?.n).toBe(0);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('blocks different-ID repeats after a lost response and never resends while getting receipts', async () => {
    const t = await setup();
    mocks.upload.mockRejectedValue(new Error('https://private.invalid/signed?secret=never-log'));
    const saved = await receipt(await t.upload());
    expect(saved).toMatchObject({ status: 'unknown', errorCode: 'ORDER_ATTACHMENT_RESULT_UNKNOWN' });
    expect((await t.upload()).status).toBe(409);
    expect(await receipt(await t.get(saved.jobId))).toEqual(saved);
    expect((await t.get(crypto.randomUUID())).status).toBe(404);
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(JSON.stringify(await t.repository.get(saved.jobId, t.session.user.id))).not.toContain(
      'private.invalid'
    );
  });
  it('checks current context during get without credential refresh', async () => {
    const t = await setup();
    const saved = await receipt(await t.upload());
    t.credentials.appKey = 'changed';
    expect((await t.get(saved.jobId)).status).toBe(409);
    expect(t.resolveForOperation).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledOnce();
  });
  it('keeps the existing 10MB body ceiling and rejects unrelated order parameters', async () => {
    const t = await setup();
    const huge = await t.app.request('/order-attachments/upload', {
      method: 'POST',
      headers: t.headers,
      body: ' '.repeat(10 * 1024 * 1024 + 1)
    });
    expect(huge.status).toBe(413);
    expect(huge.headers.get('Cache-Control')).toBe('no-store');
    expect((await t.upload({ orderId: 'must-not-bind-orders' })).status).toBe(400);
    expect(t.resolveForOperation).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
