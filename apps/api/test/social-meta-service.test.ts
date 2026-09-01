import { afterEach, describe, expect, it } from 'vitest';

import { createRequestId } from '@one-vegetable/core';
import { SqlAuthRepository } from '../src/auth/repository';
import { AuthService } from '../src/auth/service';
import { applyNodeMigrations, openNodeDatabase } from '../src/db/node-database';
import { SqlMetaSocialRepository } from '../src/social-meta/repository';
import { MetaSecretCipher } from '../src/social-meta/secret-cipher';
import { MetaSocialService } from '../src/social-meta/service';

import type { NetworkTransport } from '@one-vegetable/core';
import type { NodeDatabaseHandle } from '../src/db/node-database';

const databases: NodeDatabaseHandle[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.connection.close();
});

describe('Meta social configuration and OAuth', () => {
  it('encrypts configuration and discovers Facebook plus Instagram destinations', async () => {
    const now = Date.parse('2026-09-01T00:00:00.000Z');
    const { database, repository, service, actorId } = await harness(() => now, metaTransport());
    const configured = await service.configure({
      appId: '123456789012345',
      appSecret: 'meta-app-secret',
      publicOrigin: 'https://app.example.com',
      expectedRevision: null,
      actorId,
      remark: 'production app'
    });
    expect(configured).toMatchObject({
      configured: true,
      appIdSuffix: '2345',
      graphApiVersion: 'v26.0',
      callbackUrl: 'https://app.example.com/api/v1/social/meta/oauth/callback',
      revision: 1
    });
    const storedConfiguration = database.connection
      .prepare('SELECT encrypted_app_secret FROM meta_app_configurations')
      .get() as { encrypted_app_secret: string };
    expect(storedConfiguration.encrypted_app_secret).not.toContain('meta-app-secret');

    const started = await service.startOAuth({ actorId, platforms: ['facebook', 'instagram'] });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin).toBe('https://www.facebook.com');
    expect(authorization.pathname).toBe('/v26.0/dialog/oauth');
    const state = authorization.searchParams.get('state');
    expect(state).toBeTruthy();

    const completed = await service.completeOAuth({
      state: state ?? '',
      code: 'authorization-code',
      requestId: createRequestId()
    });
    expect(completed.connection).toMatchObject({
      accountExternalId: 'user-1',
      accountName: 'Test Admin',
      status: 'connected',
      destinationCount: 2
    });
    expect(completed.destinations).toEqual([
      expect.objectContaining({
        platform: 'facebook',
        externalId: 'page-1',
        name: 'oneVegetable Test',
        canPublish: true
      }),
      expect.objectContaining({
        platform: 'instagram',
        externalId: 'ig-1',
        name: 'onevegetable.test',
        canPublish: true
      })
    ]);
    const storedSecrets = JSON.stringify(
      database.connection
        .prepare(
          'SELECT encrypted_user_token, initialization_vector FROM meta_oauth_grants UNION ALL SELECT encrypted_access_token, initialization_vector FROM social_destinations'
        )
        .all()
    );
    expect(storedSecrets).not.toContain('long-user-token');
    expect(storedSecrets).not.toContain('page-token');
    expect(JSON.stringify(await repository.listDestinations())).not.toContain('token');
  });

  it('consumes OAuth state once and rejects application changes while connected', async () => {
    const { service, actorId } = await harness(Date.now, metaTransport());
    await service.configure({
      appId: '123456789012345',
      appSecret: 'meta-app-secret',
      publicOrigin: 'https://app.example.com',
      expectedRevision: null,
      actorId,
      remark: null
    });
    const started = await service.startOAuth({ actorId, platforms: ['facebook', 'instagram'] });
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? '';
    await service.completeOAuth({ state, code: 'authorization-code', requestId: createRequestId() });
    await expect(
      service.completeOAuth({ state, code: 'authorization-code', requestId: createRequestId() })
    ).rejects.toMatchObject({ code: 'META_OAUTH_STATE_INVALID' });
    await expect(
      service.configure({
        appId: '999999999999999',
        appSecret: 'new-secret',
        publicOrigin: 'https://app.example.com',
        expectedRevision: 1,
        actorId,
        remark: null
      })
    ).rejects.toMatchObject({ code: 'META_CONNECTIONS_MUST_BE_DISCONNECTED' });
  });

  it('preserves the encrypted App Secret when only the public origin changes', async () => {
    const { database, service, actorId } = await harness(Date.now, metaTransport());
    await service.configure({
      appId: '123456789012345',
      appSecret: 'meta-app-secret',
      publicOrigin: 'https://app.example.com',
      expectedRevision: null,
      actorId,
      remark: null
    });
    const before = database.connection
      .prepare('SELECT encrypted_app_secret, initialization_vector FROM meta_app_configurations')
      .get();

    const updated = await service.configure({
      appId: '123456789012345',
      appSecret: null,
      publicOrigin: 'https://preview.example.com',
      expectedRevision: 1,
      actorId,
      remark: 'preview callback'
    });
    const after = database.connection
      .prepare('SELECT encrypted_app_secret, initialization_vector FROM meta_app_configurations')
      .get();

    expect(after).toEqual(before);
    expect(updated).toMatchObject({
      publicOrigin: 'https://preview.example.com',
      callbackUrl: 'https://preview.example.com/api/v1/social/meta/oauth/callback',
      revision: 2
    });
  });

  it('requests Instagram permissions only when Instagram is selected', async () => {
    const { service, actorId } = await harness(Date.now, metaTransport());
    await service.configure({
      appId: '123456789012345',
      appSecret: 'meta-app-secret',
      publicOrigin: 'https://app.example.com',
      expectedRevision: null,
      actorId,
      remark: null
    });

    const facebookOnly = new URL(
      (await service.startOAuth({ actorId, platforms: ['facebook'] })).authorizationUrl
    ).searchParams.get('scope');
    const withInstagram = new URL(
      (await service.startOAuth({ actorId, platforms: ['facebook', 'instagram'] })).authorizationUrl
    ).searchParams.get('scope');

    expect(facebookOnly).toBe('pages_show_list,pages_read_engagement,pages_manage_posts');
    expect(withInstagram).toContain('instagram_basic');
    expect(withInstagram).toContain('instagram_content_publish');
  });

  it('requires App Secret for the first configuration and when changing App ID', async () => {
    const { service, actorId } = await harness(Date.now, metaTransport());
    await expect(
      service.configure({
        appId: '123456789012345',
        appSecret: null,
        publicOrigin: 'https://app.example.com',
        expectedRevision: null,
        actorId,
        remark: null
      })
    ).rejects.toMatchObject({ code: 'META_APP_SECRET_REQUIRED' });

    await service.configure({
      appId: '123456789012345',
      appSecret: 'meta-app-secret',
      publicOrigin: 'https://app.example.com',
      expectedRevision: null,
      actorId,
      remark: null
    });
    await expect(
      service.configure({
        appId: '999999999999999',
        appSecret: null,
        publicOrigin: 'https://app.example.com',
        expectedRevision: 1,
        actorId,
        remark: null
      })
    ).rejects.toMatchObject({ code: 'META_APP_SECRET_REQUIRED' });
  });

  it('binds ciphertext to its record id and secret kind', async () => {
    const cipher = await MetaSecretCipher.create(encodedKey(1));
    const encrypted = await cipher.encrypt('app-secret', 'primary', 'secret-value');
    await expect(cipher.decrypt('user-token', 'primary', encrypted)).rejects.toMatchObject({
      code: 'META_CREDENTIAL_VAULT_UNREADABLE'
    });
    const wrongCipher = await MetaSecretCipher.create(encodedKey(2));
    await expect(wrongCipher.decrypt('app-secret', 'primary', encrypted)).rejects.toMatchObject({
      code: 'META_CREDENTIAL_VAULT_UNREADABLE'
    });
  });
});

async function harness(clock: () => number, transport: NetworkTransport) {
  const database = openNodeDatabase(':memory:');
  databases.push(database);
  applyNodeMigrations(database);
  const authRepository = new SqlAuthRepository(database.executor);
  const auth = new AuthService({
    repository: authRepository,
    bootstrapToken: 'bootstrap-secret-that-is-long'
  });
  const bootstrap = await auth.bootstrap({
    requestId: createRequestId(),
    bootstrapToken: 'bootstrap-secret-that-is-long',
    username: 'admin',
    password: 'correct-password-value'
  });
  const repository = new SqlMetaSocialRepository(database.executor);
  const cipher = await MetaSecretCipher.create(encodedKey(1));
  return {
    database,
    repository,
    actorId: bootstrap.user.id,
    service: new MetaSocialService(repository, cipher, { clock, transport })
  };
}

function metaTransport(): NetworkTransport {
  return {
    send(input) {
      const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      const body = routeMeta(url);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'x-fb-request-id': 'meta-request-1' }
        })
      );
    }
  };
}

function routeMeta(url: URL): unknown {
  if (url.pathname === '/v26.0/oauth/access_token') {
    return url.searchParams.get('grant_type') === 'fb_exchange_token'
      ? { access_token: 'long-user-token', expires_in: 5_184_000 }
      : { access_token: 'short-user-token', expires_in: 3600 };
  }
  if (url.pathname === '/v26.0/me' && url.searchParams.get('fields') === 'id,name') {
    return { id: 'user-1', name: 'Test Admin' };
  }
  if (url.pathname === '/v26.0/me/permissions') {
    return {
      data: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_content_publish'
      ].map((permission) => ({ permission, status: 'granted' }))
    };
  }
  if (url.pathname === '/v26.0/me/accounts') {
    return {
      data: [
        {
          id: 'page-1',
          name: 'oneVegetable Test',
          access_token: 'page-token',
          tasks: ['CREATE_CONTENT'],
          instagram_business_account: { id: 'ig-1' }
        }
      ]
    };
  }
  if (url.pathname === '/v26.0/ig-1') return { id: 'ig-1', username: 'onevegetable.test' };
  return { error: { code: 100, message: 'unexpected route' } };
}

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
