import { describe, expect, it, vi } from 'vitest';

import { BffGatewayClient } from '../src/bff-client';
import { GatewayException } from '../src/errors';
import { createRequestId } from '../src/network';

import type { NetworkTransport } from '../src/network';

describe('BffGatewayClient', () => {
  it('sends all operation parameters in a JSON body and correlates the response requestId', async () => {
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      if (typeof init.body !== 'string') throw new Error('expected JSON string body');
      const body = JSON.parse(init.body) as {
        requestId: string;
        operation: string;
        payload: unknown;
      };
      expect(body).toMatchObject({ operation: 'listProducts', payload: { page: 2, pageSize: 20 } });
      const requestId = new Headers(init.headers).get('X-Request-ID');
      expect(body.requestId).toBe(requestId);
      return Promise.resolve(
        new Response(
          JSON.stringify({ requestId, ok: true, data: { items: [], page: 2, pageSize: 20, total: 0 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    });
    const client = new BffGatewayClient({
      baseUrl: 'https://staging.example.com',
      transport: { send }
    });

    await expect(client.request('listProducts', { page: 2, pageSize: 20 })).resolves.toMatchObject({
      page: 2,
      total: 0
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects a response whose requestId does not match the request', async () => {
    const client = new BffGatewayClient({
      baseUrl: 'https://staging.example.com',
      transport: {
        send: () =>
          Promise.resolve(
            Response.json({ requestId: createRequestId(), ok: true, data: {} }, { status: 200 })
          )
      }
    });
    await expect(client.request('getDashboard', undefined)).rejects.toThrow('requestId');
  });

  it('preserves the BFF requestId on operation errors', async () => {
    const client = new BffGatewayClient({
      baseUrl: 'https://staging.example.com',
      transport: {
        send: (_input, init) => {
          if (typeof init.body !== 'string') throw new Error('expected JSON body');
          const body = JSON.parse(init.body) as { requestId: string };
          return Promise.resolve(
            Response.json({
              requestId: body.requestId,
              ok: false,
              error: { code: 'FORBIDDEN', message: '操作被拒绝', retryable: false }
            })
          );
        }
      }
    });

    try {
      await client.request('getDashboard', undefined);
      throw new Error('expected the BFF request to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(GatewayException);
      if (!(error instanceof GatewayException)) throw error;
      expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(error.gatewayError.code).toBe('FORBIDDEN');
    }
  });
});
