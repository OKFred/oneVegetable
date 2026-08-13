import { describe, expect, it, vi } from 'vitest';

import { createRequestId } from '@one-vegetable/core';

import { createApiApp } from '../src/app';

function createTestApp(apiPrefix?: string) {
  return createApiApp({
    runtime: 'node',
    database: 'sqlite',
    environment: 'test',
    gatewayMode: 'mock',
    apiPrefix
  });
}

describe('shared Hono API', () => {
  it('mounts at the configured prefix and returns it from meta/get', async () => {
    const requestId = createRequestId();
    const response = await createTestApp('/internal/v2').request('/internal/v2/meta/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-ID')).toBe(requestId);
    await expect(response.json()).resolves.toMatchObject({
      requestId,
      ok: true,
      data: { apiPrefix: '/internal/v2', environment: 'test' }
    });
  });

  it('permits GET only for health and readiness probes', async () => {
    const app = createTestApp();
    expect((await app.request('/api/v1/healthz')).status).toBe(200);
    expect((await app.request('/api/v1/readyz')).status).toBe(200);
    expect((await app.request('/api/v1/meta/get')).status).toBe(404);
    expect((await app.request('/api/v1/operations/call')).status).toBe(404);
  });

  it('rejects missing requestId and echoes one valid requestId through body and header', async () => {
    const app = createTestApp();
    const invalid = await app.request('/api/v1/meta/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    const invalidBody = (await invalid.json()) as { requestId: string; error: { code: string } };
    expect(invalid.status).toBe(400);
    expect(invalidBody.error.code).toBe('INVALID_REQUEST_ID');
    expect(invalid.headers.get('X-Request-ID')).toBe(invalidBody.requestId);

    const requestId = createRequestId();
    const valid = await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, operation: 'getDashboard', payload: {} })
    });
    expect(valid.headers.get('X-Request-ID')).toBe(requestId);
    await expect(valid.json()).resolves.toMatchObject({ requestId, ok: true });
  });

  it('reports request log fields without including request payloads', async () => {
    const logger = vi.fn();
    const app = createApiApp({
      runtime: 'cloudflare',
      database: 'd1',
      environment: 'staging',
      gatewayMode: 'mock',
      logger
    });
    const requestId = createRequestId();
    await app.request('/api/v1/operations/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, operation: 'getDashboard', payload: { password: 'secret' } })
    });
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, environment: 'staging', runtime: 'cloudflare' })
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret');
  });

  it('allows only explicitly configured browser origins', async () => {
    const app = createApiApp({
      runtime: 'node',
      database: 'sqlite',
      environment: 'test',
      gatewayMode: 'mock',
      allowedOrigins: ['https://web.example.com']
    });
    const allowed = await app.request('/api/v1/meta/get', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://web.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://web.example.com');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toContain('X-Request-ID');

    const denied = await app.request('/api/v1/meta/get', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
