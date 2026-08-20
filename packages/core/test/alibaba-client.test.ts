import { describe, expect, it, vi } from 'vitest';

import { AlibabaClient } from '../src/alibaba-client';
import { GatewayException, normalizeGatewayError } from '../src/errors';
import { NetworkManager, type NetworkTransport } from '../src/network';

const credentials = {
  appKey: 'key',
  appSecret: 'secret',
  accessToken: 'token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};

describe('AlibabaClient retry policy', () => {
  it('retries retryable reads with bounded exponential delays', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ result: true }));
    const wait = vi.fn(() => Promise.resolve());
    const client = new AlibabaClient(credentials, network(send), {
      maxAttempts: 3,
      shouldRetry: () => true,
      wait
    });

    await expect(client.call('alibaba.icbu.product.list', {})).resolves.toMatchObject({
      data: { result: true }
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[250], [500]]);
  });

  it('never retries when the caller marks a mutation unsafe', async () => {
    const send = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
    const client = new AlibabaClient(credentials, network(send), {
      maxAttempts: 3,
      shouldRetry: () => false,
      wait: () => Promise.resolve()
    });

    await expect(client.call('alibaba.icbu.product.schema.add', {})).rejects.toMatchObject({
      gatewayError: { code: 'UPSTREAM_UNAVAILABLE', retryable: true }
    });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('Alibaba multipart upload', () => {
  it('sends the binary field as multipart and excludes it from the signature fields', async () => {
    const send = vi.fn((_input: RequestInfo | URL, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(ArrayBuffer);
      const body = new TextDecoder().decode(init.body as ArrayBuffer);
      expect(body).toContain('name="method"\r\n\r\nalibaba.icbu.photobank.upload');
      expect(body).toContain('name="file_name"\r\n\r\nsmoke.png');
      expect(body).toContain('name="image_bytes"; filename="smoke.png"');
      expect(new Headers(init.headers).get('content-type')).toMatch(
        /^multipart\/form-data; boundary=----oneVegetable/
      );
      return Promise.resolve(
        Response.json({
          alibaba_icbu_photobank_upload_response: {
            upload_image_response: { file_id: 1, file_name: 'smoke.png', photobank_url: 'https://img' }
          }
        })
      );
    });
    const client = new AlibabaClient(credentials, network(send));

    await expect(
      client.callWithFile(
        'alibaba.icbu.photobank.upload',
        { file_name: 'smoke.png' },
        {
          fieldName: 'image_bytes',
          fileName: 'smoke.png',
          contentType: 'image/png',
          bytes: new Uint8Array([1, 2, 3, 4])
        }
      )
    ).resolves.toMatchObject({ method: 'alibaba.icbu.photobank.upload' });
  });
});

describe('gateway transport error categories', () => {
  it('maps client timeouts separately from generic network failures', () => {
    const error = new GatewayException({
      code: 'REQUEST_TIMEOUT',
      message: 'timeout',
      retryable: true
    });
    expect(normalizeGatewayError(error)).toMatchObject({ code: 'REQUEST_TIMEOUT', retryable: true });
  });

  it('keeps GatewayException payloads intact', () => {
    const error = new GatewayException({ code: 'CUSTOM', message: 'custom', retryable: false });
    expect(normalizeGatewayError(error)).toEqual(error.gatewayError);
  });
});

function network(send: ReturnType<typeof vi.fn>): NetworkManager {
  return new NetworkManager({
    transport: { send } as NetworkTransport,
    policies: {
      alibaba: { allowedOrigins: ['https://eco.taobao.com'] },
      bff: { allowedOrigins: [] },
      'external-photo': { allowedOrigins: [] }
    }
  });
}
