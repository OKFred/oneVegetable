import { describe, expect, it, vi } from 'vitest';

import { BffGatewayClient } from '../src/bff-client';
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
});
