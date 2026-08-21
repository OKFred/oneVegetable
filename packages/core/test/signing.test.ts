import { describe, expect, it } from 'vitest';

import {
  createAlibabaRequest,
  createAlibabaSyncRequest,
  formatAlibabaTimestamp,
  serializeAlibabaParameters,
  signAlibabaParameters
} from '../src/signing';

describe('Alibaba request signing', () => {
  it('formats timestamps in GMT+8', () => {
    expect(formatAlibabaTimestamp(new Date('2026-08-11T16:01:02.000Z'))).toBe('2026-08-12 00:01:02');
  });

  it('matches known digest vectors for every supported method', () => {
    const parameters = { foo: 'bar' };
    expect(signAlibabaParameters(parameters, 'key', 'md5')).toBe('1B7608966A4EC944E5EF527A0534E664');
    expect(signAlibabaParameters(parameters, 'key', 'hmac')).toBe('319762045E12C05969D37AE7813D05A1');
    expect(signAlibabaParameters(parameters, 'key', 'hmac-sha256')).toBe(
      '37508E74CC6EDBED6D80273299668BD17F04EE5D9B087E60D03396F4E1F3D97E'
    );
  });

  it('serializes structured values and excludes binary values from signing', () => {
    const parameters = serializeAlibabaParameters({
      enabled: true,
      count: 2,
      nested: { id: 1 },
      binary: new Blob(['image'])
    });
    expect(parameters).toEqual({ enabled: 'true', count: '2', nested: '{"id":1}' });
  });

  it('creates a complete deterministic TOP request', () => {
    const request = createAlibabaRequest(
      {
        appKey: 'app-key',
        appSecret: 'secret',
        accessToken: 'token',
        endpoint: 'https://eco.taobao.com/router/rest',
        signMethod: 'hmac'
      },
      'alibaba.icbu.product.list',
      { current_page: 1 },
      new Date('2026-08-11T16:01:02.000Z')
    );
    expect(request).toMatchObject({
      app_key: 'app-key',
      method: 'alibaba.icbu.product.list',
      session: 'token',
      sign_method: 'hmac',
      timestamp: '2026-08-12 00:01:02',
      current_page: '1'
    });
    expect(request.sign).toMatch(/^[A-F0-9]{32}$/);
  });

  it('creates a sync-gateway request with millisecond time and SHA-256 signing', () => {
    const request = createAlibabaSyncRequest(
      {
        appKey: 'app-key',
        appSecret: 'secret',
        accessToken: 'token',
        endpoint: 'https://open-api.alibaba.com/sync',
        signMethod: 'hmac-sha256'
      },
      'alibaba.icbu.product.schema.add.draft',
      { param_product_top_publish_request: { cat_id: '123', version: 'trade.1.1' } },
      new Date('2026-08-21T00:00:00.123Z')
    );

    expect(request).toMatchObject({
      method: 'alibaba.icbu.product.schema.add.draft',
      sign_method: 'sha256',
      timestamp: '1787270400123',
      simplify: 'true',
      param_product_top_publish_request: '{"cat_id":"123","version":"trade.1.1"}'
    });
    expect(request.sign).toMatch(/^[0-9A-F]{64}$/u);
  });
});
