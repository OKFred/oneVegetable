import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/video/iop.json';
import rejections from '../../../mock/data/video/iop-rejections.json';
import { AlibabaClient } from '../src/alibaba-client';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT } from '../src/alibaba-iop';
import { adaptIopVideoPage, VideoAdapter } from '../src/video';
import { validateVideoPage } from '../src/generated/validators-video';
import { NetworkManager, type NetworkTransport } from '../src/network';

const method = 'alibaba.icbu.video.query';
const credentials = {
  protocol: 'iop' as const,
  endpoint: IOP_BUSINESS_ENDPOINT,
  appKey: 'fixture-key',
  appSecret: 'fixture-secret',
  accessToken: 'fixture-token',
  signMethod: 'hmac-sha256' as const
};
const request = { page: 1, pageSize: 20 as const };

describe('IOP video reads keep native ID and response semantics', () => {
  it.each([
    [rejections.outer, 'ALIBABA_IOP_API_REJECTED', 'fixture-outer-video'],
    [rejections.business, 'ALIBABA_IOP_BUSINESS_REJECTED', 'fixture-business-video']
  ] as const)(
    'distinguishes outer and business rejection without losing provider traces',
    async (response, code, traceId) => {
      const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(response));
      const client = new AlibabaClient(
        credentials,
        new NetworkManager({
          transport: { send },
          policies: { alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] } }
        }),
        { maxAttempts: 3 }
      );
      await expect(client.call(method, { current_page: 1, page_size: 20 })).rejects.toMatchObject({
        gatewayError: { code, subCode: '10000002', traceId, retryable: false }
      });
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
  it('uses the public numeric ID parameter and rejects unsupported title filters', async () => {
    const input = { current_page: 1, page_size: 20, id: 900002 };
    const result = await createIopBusinessRequest(credentials, method, input);
    expect(result.parameters.video_id).toBe('900002');
    expect(result.parameters).not.toHaveProperty('id');
    expect(result.parameters).not.toHaveProperty('method');
    await expect(
      createIopBusinessRequest(credentials, method, { ...input, title: 'Fixture' })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' } });
  });
  it('retains native IDs, raw units and separate quality/review fields without inventing relation IDs', () => {
    const normalized = normalizeIopBusinessResponse(fixture, method, credentials);
    const page = adaptIopVideoPage(normalized, request);
    expect(validateVideoPage(page)).toBe(true);
    expect(page.items[0]).toMatchObject({
      id: '900002',
      encryptedId: null,
      relatedProductCount: null,
      durationRaw: 12345,
      status: 'approved',
      quality: 'normal'
    });
    expect(page.traceId).toBe('fixture-iop-video');
    const numericStrings = structuredClone(fixture) as unknown as {
      result: {
        model: {
          current_page: unknown;
          page_size: unknown;
          total_count: unknown;
          list: Record<string, unknown>[];
        };
      };
    };
    const model = numericStrings.result.model;
    model.current_page = '1';
    model.page_size = '20';
    model.total_count = '1';
    for (const row of model.list)
      for (const [key, value] of Object.entries(row)) if (typeof value === 'number') row[key] = String(value);
    expect(
      adaptIopVideoPage(normalizeIopBusinessResponse(numericStrings, method, credentials), request).items
    ).toEqual(page.items);
  });
  it('rejects ambiguous pagination, precision loss and explicit business failures', () => {
    for (const patch of [
      { total_count: undefined },
      { list: {} },
      { list: [{ video_id: 9007199254740992 }] }
    ]) {
      expect(() =>
        normalizeIopBusinessResponse(
          { ...fixture, result: { ...fixture.result, model: { ...fixture.result.model, ...patch } } },
          method,
          credentials
        )
      ).toThrow();
    }
    expect(() =>
      normalizeIopBusinessResponse(
        { ...fixture, result: { ...fixture.result, msg_code: 'DENIED' } },
        method,
        credentials
      )
    ).toThrow();
    const empty = normalizeIopBusinessResponse(
      { ...fixture, result: { model: { current_page: 1, page_size: 20, total_count: 0 } } },
      method,
      credentials
    );
    expect(adaptIopVideoPage(empty, request).items).toEqual([]);
    expect(() => adaptIopVideoPage(empty, { ...request, page: 2 })).toThrow();
  });
  it('uses the native validator through the real shared client without TOP response coercion', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(fixture), { headers: { 'Content-Type': 'application/json' } })
      );
    const client = new AlibabaClient(
      credentials,
      new NetworkManager({
        transport: { send },
        policies: {
          alibaba: { allowedOrigins: ['https://openapi-api.alibaba.com'] }
        }
      })
    );
    const requestValidator = vi.fn().mockResolvedValue([]),
      responseValidator = vi.fn().mockResolvedValue([]);
    const adapter = new VideoAdapter(client, requestValidator, responseValidator);
    expect((await adapter.list(request)).items[0]?.id).toBe('900002');
    expect(requestValidator).toHaveBeenCalled();
    expect(responseValidator).not.toHaveBeenCalled();
    await expect(adapter.list({ ...request, title: 'Fixture' })).rejects.toThrow(
      'ALIBABA_IOP_PARAMETER_UNSUPPORTED'
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
