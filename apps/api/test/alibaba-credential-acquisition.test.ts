import { afterEach, describe, expect, it } from 'vitest';

import {
  createAlibabaCredentialAcquisitionFailure,
  createAlibabaCredentialAcquisitionState,
  createRequestId
} from '@one-vegetable/core';

import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { createApiApp } from '../src/app';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import {
  GatewayCredentialCipher,
  GatewayCredentialService,
  SqlGatewayCredentialRepository
} from '../src/gateway/credential-vault';
import {
  AlibabaCredentialAcquisitionBusyError,
  AlibabaCredentialAcquisitionRateLimitError,
  SqlAlibabaCredentialAcquisitionJobRepository
} from '../src/alibaba-credential-acquisition/repository';
import { AlibabaCredentialAcquisitionService } from '../src/alibaba-credential-acquisition/service';
import {
  classifyAlibabaChallenge,
  findApplicationRecords,
  findLegacyApplicationRecords
} from '../src/alibaba-credential-acquisition/browser-page-model';

import type {
  AlibabaCredentialAcquisitionDriver,
  AlibabaCredentialAcquisitionDriverResult
} from '../src/alibaba-credential-acquisition/service';
import type { NodeDatabaseHandle } from '../src/db/node-database';

let database: NodeDatabaseHandle | undefined;

afterEach(() => {
  database?.connection.close();
  database = undefined;
});

describe('Alibaba credential acquisition repository', () => {
  it('keeps only public task state and enforces one global active job', async () => {
    const { repository } = await fixture();
    const now = Date.now();
    const first = initialState(now);
    await repository.create({
      id: first.jobId,
      actorId: 'actor-1',
      state: first,
      requestedCallbackUrl: null,
      now
    });
    const rows = await database?.executor.query(
      'SELECT state_json, browser_session_id FROM alibaba_credential_acquisition_jobs'
    );
    expect(JSON.stringify(rows)).not.toMatch(/account|password|appSecret|accessToken|refreshToken/iu);

    const second = initialState(now + 1);
    await expect(
      repository.create({
        id: second.jobId,
        actorId: 'actor-2',
        state: second,
        requestedCallbackUrl: null,
        now: now + 1
      })
    ).rejects.toBeInstanceOf(AlibabaCredentialAcquisitionBusyError);
  });

  it('limits each administrator to three starts per 30 minutes', async () => {
    const { repository } = await fixture();
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      const state = initialState(now + index);
      await repository.create({
        id: state.jobId,
        actorId: 'actor-1',
        state,
        requestedCallbackUrl: null,
        now: now + index
      });
      await repository.update({
        id: state.jobId,
        actorId: 'actor-1',
        state: {
          status: 'failed',
          error: createAlibabaCredentialAcquisitionFailure('ACQUISITION_CANCELLED')
        },
        now: now + index
      });
    }
    const fourth = initialState(now + 4);
    await expect(
      repository.create({
        id: fourth.jobId,
        actorId: 'actor-1',
        state: fourth,
        requestedCallbackUrl: null,
        now: now + 4
      })
    ).rejects.toBeInstanceOf(AlibabaCredentialAcquisitionRateLimitError);
  });
});

describe('Alibaba credential acquisition service', () => {
  it('resumes application selection, encrypts the bundle and returns no secret', async () => {
    const firstResult: AlibabaCredentialAcquisitionDriverResult = {
      kind: 'selection-required',
      applications: [
        {
          applicationId: 'application-center:1',
          appName: 'first',
          appKeySuffix: '0001',
          status: 'Online',
          source: 'application-center'
        },
        {
          applicationId: 'application-center:2',
          appName: 'second',
          appKeySuffix: '0002',
          status: 'Online',
          source: 'application-center'
        }
      ]
    };
    const driver = new FakeDriver(firstResult, { kind: 'completed', bundle: credentialBundle() });
    const { repository, credentialService, credentialRepository } = await fixture();
    const service = new AlibabaCredentialAcquisitionService(repository, driver, credentialService);
    const started = await service.start({
      requestId: createRequestId(),
      actorId: 'actor-1',
      account: 'website-account@example.com',
      password: 'website-password',
      callbackUrl: null
    });
    expect(started.status).toBe('selection-required');
    if (started.status !== 'selection-required') throw new Error('selection state expected');
    const completed = await service.continue({
      requestId: createRequestId(),
      actorId: 'actor-1',
      jobId: started.jobId,
      command: { type: 'select-application', applicationId: 'application-center:2' }
    });
    expect(completed).toMatchObject({
      status: 'completed',
      credential: { appName: 'oneVegetable', appKeySuffix: '-key' }
    });
    expect(JSON.stringify(completed)).not.toMatch(/app-secret|access-token|refresh-token/iu);
    const stored = await credentialRepository.find();
    expect(stored?.encryptedBundle).not.toMatch(/app-secret|access-token/iu);
  });

  it('returns extension fallback and clears the Browser Run context on a challenge', async () => {
    const driver = new FakeDriver({ kind: 'extension-required', reasonCode: 'slider' });
    const { repository, credentialService } = await fixture();
    const service = new AlibabaCredentialAcquisitionService(repository, driver, credentialService);
    const result = await service.start({
      requestId: createRequestId(),
      actorId: 'actor-1',
      account: 'account',
      password: 'password',
      callbackUrl: null
    });
    expect(result).toEqual({ status: 'extension-required', reasonCode: 'slider' });
    expect(driver.cancelledSessions).toEqual(['browser-session']);
  });
});

describe('Alibaba credential acquisition admin routes', () => {
  it('requires admin CSRF and never echoes website login credentials', async () => {
    const { repository, credentialService } = await fixture(false);
    const authRepository = new SqlAuthRepository(database?.executor ?? missingDatabase());
    const authService = new AuthService({
      repository: authRepository,
      bootstrapToken: 'bootstrap-secret-that-is-long'
    });
    const session = await authService.bootstrap({
      requestId: createRequestId(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'route-admin',
      password: 'correct-password-value'
    });
    const acquisition = new AlibabaCredentialAcquisitionService(
      repository,
      new FakeDriver({ kind: 'extension-required', reasonCode: 'captcha' }),
      credentialService
    );
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'mock',
      authService,
      adminService: new AdminService(authRepository),
      alibabaCredentialAcquisition: acquisition
    });
    const body = {
      requestId: createRequestId(),
      account: 'route-account@example.com',
      password: 'route-password-secret',
      callbackUrl: null
    };
    const denied = await app.request('/api/v1/admin/alibaba-credential-acquisition/start', {
      method: 'POST',
      headers: authHeaders(session.sessionToken),
      body: JSON.stringify(body)
    });
    expect(denied.status).toBe(403);
    const response = await app.request('/api/v1/admin/alibaba-credential-acquisition/start', {
      method: 'POST',
      headers: authHeaders(session.sessionToken, session.session.csrfToken),
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(body.account);
    expect(text).not.toContain(body.password);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: { status: 'extension-required', reasonCode: 'captcha' }
    });
  });
});

describe('Cloudflare Playwright helpers', () => {
  it('classifies security challenges without attempting to bypass them', () => {
    expect(classifyAlibabaChallenge('Slide to verify')).toBe('slider');
    expect(classifyAlibabaChallenge('请输入验证码')).toBe('captcha');
    expect(classifyAlibabaChallenge('two-factor verification code')).toBe('mfa');
    expect(classifyAlibabaChallenge('Application center')).toBeNull();
  });

  it('extracts new and legacy application summaries from nested responses', () => {
    expect(findApplicationRecords({ data: [{ appkey: 500_001, name: 'Online application' }] })).toEqual([
      { appKey: '500001', appName: 'Online application' }
    ]);
    expect(
      findLegacyApplicationRecords({
        result: { appKey: 'legacy-key', appName: 'Legacy application', callbackUrl: 'https://example.com/cb' }
      })
    ).toEqual([
      {
        appKey: 'legacy-key',
        appName: 'Legacy application',
        callbackUrl: 'https://example.com/cb',
        status: 'Legacy Online'
      }
    ]);
  });
});

class FakeDriver implements AlibabaCredentialAcquisitionDriver {
  readonly cancelledSessions: string[] = [];

  constructor(
    private readonly startResult: AlibabaCredentialAcquisitionDriverResult,
    private readonly continueResult: AlibabaCredentialAcquisitionDriverResult = startResult
  ) {}

  async start(
    input: Parameters<AlibabaCredentialAcquisitionDriver['start']>[0]
  ): Promise<AlibabaCredentialAcquisitionDriverResult> {
    await input.onSessionAcquired('browser-session');
    return this.startResult;
  }

  continue(): Promise<AlibabaCredentialAcquisitionDriverResult> {
    return Promise.resolve(this.continueResult);
  }

  cancel(browserSessionId: string): Promise<void> {
    this.cancelledSessions.push(browserSessionId);
    return Promise.resolve();
  }
}

async function fixture(seedActors = true) {
  database = openNodeDatabase(':memory:');
  applyNodeMigrations(database);
  const now = Date.now();
  if (seedActors) {
    for (const actorId of ['actor-1', 'actor-2']) {
      await database.executor.execute(
        `INSERT INTO users (
          id, username, password_hash, password_salt, password_login_enabled, role, status,
          failed_login_count, locked_until_utc, create_time_utc, update_time_utc,
          creator_id, updater_id, revision, remark
        ) VALUES (?, ?, 'hash', 'salt', 0, 'admin', 'active', 0, NULL, ?, ?, ?, ?, 1, NULL)`,
        [actorId, actorId, now, now, actorId, actorId]
      );
    }
  }
  const repository = new SqlAlibabaCredentialAcquisitionJobRepository(database.executor);
  const credentialRepository = new SqlGatewayCredentialRepository(database.executor);
  const cipher = await GatewayCredentialCipher.create(encodedKey());
  return {
    repository,
    credentialRepository,
    credentialService: new GatewayCredentialService(credentialRepository, cipher)
  };
}

function encodedKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function authHeaders(sessionToken: string, csrfToken?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    Cookie: `ov_session=${sessionToken}`,
    Origin: 'http://localhost',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };
}

function missingDatabase(): never {
  throw new Error('database fixture missing');
}

function initialState(now: number) {
  const state = createAlibabaCredentialAcquisitionState(createRequestId(), now);
  if (state.status !== 'running') throw new Error('running state expected');
  return state;
}

function credentialBundle() {
  return {
    schemaVersion: 1 as const,
    capturedAtUtc: '2026-08-30T00:00:00.000Z',
    application: {
      appName: 'oneVegetable',
      appKey: 'app-key',
      appSecret: 'app-secret',
      callbackUrl: 'https://example.com/callback',
      status: 'Online',
      permissions: []
    },
    oauth: {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAtUtc: '2026-08-30T01:00:00.000Z',
      refreshExpiresAtUtc: '2026-09-30T00:00:00.000Z'
    },
    callback: {
      receivedAtUtc: '2026-08-30T00:00:00.000Z',
      stateMatched: true as const,
      callbackOrigin: 'https://example.com',
      callbackPath: '/callback'
    }
  };
}
