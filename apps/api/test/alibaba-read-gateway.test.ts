import { describe, expect, it, vi } from 'vitest';

import { createRequestId, getCapabilityDefinition } from '@one-vegetable/core';
import { AlibabaReadGatewayClient } from '../src/gateway/alibaba-read-gateway';

import type { NetworkTransport } from '@one-vegetable/core';

const credentials = {
  appKey: 'server-app-key',
  appSecret: 'server-app-secret',
  accessToken: 'server-access-token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};
const method = 'alibaba.icbu.product.list';
const parameters = getCapabilityDefinition(method)?.requestExample as Record<string, unknown>;

describe('BFF Alibaba read gateway', () => {
  it('validates, signs and correlates a typed read capability', async () => {
    const requestId = createRequestId();
    const example = getCapabilityDefinition(method)?.responseExample;
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(requestId);
      if (!(init.body instanceof URLSearchParams)) throw new Error('expected URLSearchParams');
      const encoded = init.body.toString();
      expect(encoded).toContain(`method=${encodeURIComponent(method)}`);
      expect(encoded).toContain('session=server-access-token');
      expect(encoded).not.toContain('server-app-secret');
      return Promise.resolve(
        Response.json({
          [`${method.replaceAll('.', '_')}_response`]: example,
          request_id: 'alibaba-trace-id'
        })
      );
    });
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request('callCapability', { method, parameters }, { requestId })
    ).resolves.toMatchObject({
      method,
      traceId: 'alibaba-trace-id',
      contractValid: true,
      data: example
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it('returns response drift as contract issues instead of hiding the raw result', async () => {
    const send = vi.fn<NetworkTransport['send']>(() =>
      Promise.resolve(Response.json({ [`${method.replaceAll('.', '_')}_response`]: { unexpected: true } }))
    );
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request('callCapability', { method, parameters }, { requestId: createRequestId() })
    ).resolves.toMatchObject({
      data: { unexpected: true },
      contractValid: false
    });
  });

  it('adapts dedicated product reads with the same requestId', async () => {
    const requestId = createRequestId();
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(requestId);
      return Promise.resolve(
        Response.json({
          alibaba_icbu_product_list_response: {
            products: [
              {
                product_id: 'product-1',
                subject: 'Typed BFF product',
                group_name: 'BFF group',
                display: 'online',
                score: 88,
                gmt_modified: '2026-08-14T00:00:00Z'
              }
            ],
            total_count: 1
          }
        })
      );
    });
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request('listProducts', { page: 1, pageSize: 20 }, { requestId })
    ).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'product-1', subject: 'Typed BFF product', status: 'online' }]
    });
  });

  it('uploads a validated gallery image with the multipart transport', async () => {
    const requestId = createRequestId();
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(requestId);
      expect(new Headers(init.headers).get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
      expect(init.body).toBeInstanceOf(ArrayBuffer);
      return Promise.resolve(
        Response.json({
          upload_image_response: {
            file_id: 33167520316,
            file_name: 'smoke.png',
            photobank_url: 'http://sc04.alicdn.com/kf/smoke.png'
          }
        })
      );
    });
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request(
        'uploadPhoto',
        {
          fileName: 'smoke.png',
          contentBase64: 'iVBORw0KGgo=',
          contentType: 'image/png',
          byteLength: 8
        },
        { requestId }
      )
    ).resolves.toMatchObject({
      id: '33167520316',
      name: 'smoke.png',
      url: 'https://sc04.alicdn.com/kf/smoke.png'
    });
  });

  it('operates a gallery group through the dedicated mutation operation', async () => {
    const requestId = createRequestId();
    const send = vi.fn<NetworkTransport['send']>((_input, init) => {
      expect(new Headers(init.headers).get('X-Request-ID')).toBe(requestId);
      if (!(init.body instanceof URLSearchParams)) throw new Error('expected URLSearchParams');
      expect(init.body.get('method')).toBe('alibaba.icbu.photobank.group.operate');
      expect(init.body.get('photo_group_operation_request')).toBe(
        JSON.stringify({ operation: 'add', group_name: '详情图' })
      );
      return Promise.resolve(
        Response.json({
          alibaba_icbu_photobank_group_operate_response: {
            photo_group_result: {
              photobank_group: {
                id: 312577503,
                level1: 312577503,
                level2: 0,
                level3: 0,
                name: '详情图'
              }
            }
          }
        })
      );
    });
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request(
        'operatePhotoGroup',
        { operation: 'add', groupId: null, groupName: '详情图' },
        { requestId }
      )
    ).resolves.toMatchObject({
      operation: 'add',
      groupId: '312577503',
      group: { id: '312577503', name: '详情图' }
    });
  });

  it('rejects mutations and qualification-gated reads before any network request', async () => {
    const send = vi.fn<NetworkTransport['send']>();
    const gateway = new AlibabaReadGatewayClient(credentials, { transport: { send } });

    await expect(
      gateway.request(
        'callCapability',
        { method: 'alibaba.icbu.product.schema.add', parameters: {} },
        { requestId: createRequestId() }
      )
    ).rejects.toMatchObject({ gatewayError: { code: 'REAL_MUTATION_DISABLED' } });
    await expect(
      gateway.request('publishProduct', { categoryId: 1, language: 'en_US', schemaXml: '<xml />' })
    ).rejects.toMatchObject({
      gatewayError: { code: 'REAL_MUTATION_DISABLED' }
    });
    await expect(gateway.request('listLogisticsProducts', undefined)).rejects.toMatchObject({
      gatewayError: { code: 'LOGISTICS_QUALIFICATION_REQUIRED' }
    });
    expect(send).not.toHaveBeenCalled();
  });
});
