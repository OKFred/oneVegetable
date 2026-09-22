import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AlibabaClient,
  createRequestId,
  getCapabilityDefinition,
  listCapabilities,
  NetworkManager,
  redactCapabilityResponse,
  type GatewayClient,
  type NetworkTransport
} from '@one-vegetable/core';
import { AlibabaReadGatewayClient } from '../src/gateway/alibaba-read-gateway';
import {
  authorizeOperation,
  extensionAdminPrincipal,
  operationIsMutation,
  StaticOperationFeatureFlags
} from '../src/abac';
import { executeExtensionCapabilityCall } from '../../extension/lib/capability-call';
import { resolveExtensionOperationAvailability } from '../../extension/lib/operation-policy';
import { createApiApp } from '../src/app';
import { AuthService } from '../src/auth/service';
import { AdminService } from '../src/auth/admin-service';
import { SqlAuthRepository } from '../src/auth/repository';
import { applyNodeMigrations, openNodeDatabase, type NodeDatabaseHandle } from '../src/db/node-database';

const credentials = {
  appKey: 'key',
  appSecret: 'secret',
  accessToken: 'token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};
const read = 'alibaba.icbu.product.list';
const mutation = 'alibaba.icbu.product.schema.update';
let database: NodeDatabaseHandle | undefined;
afterEach(() => {
  database?.connection.close();
  database = undefined;
  vi.restoreAllMocks();
});

function transports(response: unknown) {
  const send = vi.fn<NetworkTransport['send']>(() => Promise.resolve(Response.json(response)));
  const bff = new AlibabaReadGatewayClient(credentials, { transport: { send } });
  const extension = new AlibabaClient(
    credentials,
    new NetworkManager({
      transport: { send },
      policies: {
        alibaba: { allowedOrigins: [new URL(credentials.endpoint).origin] },
        bff: { allowedOrigins: [] },
        'external-photo': { allowedOrigins: [] }
      }
    })
  );
  return { send, bff, extension };
}

describe('BFF / extension generic security parity', () => {
  it('applies the same catalog policy to every registered capability even with every flag enabled', () => {
    const flags = { isEnabled: () => true };
    for (const capability of listCapabilities()) {
      const payload = { method: capability.method, parameters: {} };
      const bff = authorizeOperation(extensionAdminPrincipal(), 'callCapability', payload, flags);
      const extension = resolveExtensionOperationAvailability('callCapability', payload);
      expect(bff.allowed, capability.method).toBe(extension.allowed);
      if (!bff.allowed) expect(bff.reasonCode, capability.method).toBe(extension.reasonCode);
      if (capability.risk === 'mutation') {
        expect(operationIsMutation('callCapability', payload), capability.method).toBe(true);
        expect(bff.allowed, capability.method).toBe(false);
        expect(
          authorizeOperation({ ...extensionAdminPrincipal(), role: 'user' }, 'callCapability', payload, flags)
            .reasonCode
        ).toBe('USER_MUTATION_DENIED');
      }
    }
  });

  it.each([mutation, 'constructor', 'unknown'])(
    'rejects %s on both transports before networking',
    async (method) => {
      const { send, bff, extension } = transports({});
      const payload = { method, parameters: {} };
      const code = resolveExtensionOperationAvailability('callCapability', payload).reasonCode;
      await expect(bff.request('callCapability', payload)).rejects.toMatchObject({ gatewayError: { code } });
      await expect(executeExtensionCapabilityCall(extension, payload, 'trace')).rejects.toMatchObject({
        gatewayError: { code }
      });
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('rejects a hidden target/session override before either transport can sign it', async () => {
    const { send, bff, extension } = transports({});
    for (const key of ['method', 'session', 'sign']) {
      const payload = {
        method: read,
        parameters: { ...getCapabilityDefinition(read)?.requestExample, [key]: mutation }
      };
      const error = { gatewayError: { code: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN' } };
      await expect(bff.request('callCapability', payload)).rejects.toMatchObject(error);
      await expect(executeExtensionCapabilityCall(extension, payload, 'trace')).rejects.toMatchObject(error);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('uses equivalent lazy/static validation, token redaction, and no-session signing', async () => {
    const method = 'alibaba.icbu.text.trans';
    const definition = getCapabilityDefinition(method);
    if (!definition) throw new Error('Missing test capability');
    const response = {
      ...(definition.responseExample as Record<string, unknown>),
      access_token: 'do-not-display',
      ecology_token: 'ecology-do-not-display'
    };
    const { send, bff, extension } = transports({ [`${method.replaceAll('.', '_')}_response`]: response });
    const payload = { method, parameters: definition.requestExample };
    const requestId = createRequestId();
    const result = await bff.request('callCapability', payload, { requestId });
    expect(await executeExtensionCapabilityCall(extension, payload, requestId)).toEqual(result);
    expect(JSON.stringify(result)).not.toContain('do-not-display');
    expect(send).toHaveBeenCalledTimes(2);
    for (const [, init] of send.mock.calls) {
      expect((init.body as URLSearchParams).has('session')).toBe(false);
      expect((init.body as URLSearchParams).get('method')).toBe(method);
    }
  });

  it('preserves every enabled query example through the same single-root response boundary', async () => {
    let checked = 0;
    for (const capability of listCapabilities()) {
      const definition = getCapabilityDefinition(capability.method);
      if (!definition) continue;
      const payload = { method: capability.method, parameters: definition.requestExample };
      if (!resolveExtensionOperationAvailability('callCapability', payload).allowed) continue;
      const requestId = createRequestId();
      const { bff, extension, send } = transports({
        [`${capability.method.replaceAll('.', '_')}_response`]: definition.responseExample
      });
      const result = await bff.request('callCapability', payload, { requestId });
      expect(await executeExtensionCapabilityCall(extension, payload, requestId), capability.method).toEqual(
        result
      );
      // Historical documentation examples can drift. Preserve that evidence instead of flattening
      // TOP typed-array wrappers to make a validator pass.
      expect(result.data, capability.method).toEqual(redactCapabilityResponse(definition.responseExample));
      expect(result.contractValid, capability.method).toBe(result.contractIssues.length === 0);
      expect(send, capability.method).toHaveBeenCalledTimes(2);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('enforces actual-target CSRF, origin and user ABAC at the HTTP boundary, including auth:none reads', async () => {
    database = openNodeDatabase(':memory:');
    applyNodeMigrations(database);
    const repository = new SqlAuthRepository(database.executor);
    const authService = new AuthService({ repository, bootstrapToken: 'bootstrap-secret-that-is-long' });
    const login = await authService.bootstrap({
      requestId: createRequestId(),
      bootstrapToken: 'bootstrap-secret-that-is-long',
      username: 'admin',
      password: 'correct-password-value'
    });
    const request = vi.fn().mockResolvedValue({});
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'real',
      authService,
      gateway: { request } as GatewayClient,
      featureFlags: { isEnabled: () => true }
    });
    const post = (method: string, headers: Record<string, string>, parameters = {}) =>
      app.request('/api/v1/operations/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          requestId: createRequestId(),
          operation: 'callCapability',
          payload: { method, parameters }
        })
      });
    const headers = { Cookie: `ov_session=${login.sessionToken}`, Origin: 'http://localhost' };
    expect((await post('alibaba.icbu.text.trans', {})).status).toBe(401);
    const missingCsrf = await post(mutation, headers);
    await expect(missingCsrf.json()).resolves.toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const csrfHeaders = { ...headers, 'X-CSRF-Token': login.session.csrfToken };
    expect((await post(mutation, { ...csrfHeaders, Origin: 'https://attacker.example' })).status).toBe(403);
    const disabled = await post(mutation, csrfHeaders);
    await expect(disabled.json()).resolves.toMatchObject({ error: { code: 'REAL_MUTATION_DISABLED' } });
    const spoofed = await post(read, headers, { method: mutation });
    await expect(spoofed.json()).resolves.toMatchObject({
      error: { code: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN' }
    });
    await new AdminService(repository).createUser({
      requestId: createRequestId(),
      actor: (await authService.authenticate(login.sessionToken)).principal,
      username: 'reader',
      password: 'reader-password-value',
      role: 'user'
    });
    const reader = await authService.login({
      requestId: createRequestId(),
      username: 'reader',
      password: 'reader-password-value'
    });
    const readerHeaders = { Cookie: `ov_session=${reader.sessionToken}`, Origin: 'http://localhost' };
    const denied = await post(mutation, { ...readerHeaders, 'X-CSRF-Token': reader.session.csrfToken });
    await expect(denied.json()).resolves.toMatchObject({ error: { code: 'USER_MUTATION_DENIED' } });
    expect(request).not.toHaveBeenCalled();
    expect((await post('alibaba.icbu.text.trans', readerHeaders)).status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
    expect(
      authorizeOperation(
        extensionAdminPrincipal(),
        'callCapability',
        { method: mutation, parameters: {} },
        new StaticOperationFeatureFlags()
      ).allowed
    ).toBe(false);
  });
});
