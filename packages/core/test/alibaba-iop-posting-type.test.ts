import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../mock/data/product-posting-type-iop.json';
import topFixture from '../../../mock/data/product-type-available.json';
import credentialsFixture from '../../../mock/data/node-gateway-credentials.json';
import { AlibabaClient } from '../src/alibaba-client';
import { ALIBABA_GATEWAY } from '../src/signing';
import { createIopBusinessRequest, normalizeIopBusinessResponse } from '../src/alibaba-iop-business';
import { IOP_BUSINESS_ENDPOINT, signIopRequest } from '../src/alibaba-iop';
import { NetworkManager, type NetworkTransport } from '../src/network';
import { executeCapabilityCall } from '../src/capability-call';
import { validateCapabilityRequest, validateCapabilityResponse } from '../src/capability-validation-worker';
import type { GatewayCredentials } from '../src/types';

const credentials: GatewayCredentials = {
  ...credentialsFixture.manual,
  protocol: 'iop',
  endpoint: IOP_BUSINESS_ENDPOINT,
  signMethod: 'hmac-sha256'
};
const validation = { validateCapabilityRequest, validateCapabilityResponse };
function clientFor(response: unknown, settings = credentials) {
  const send = vi.fn<NetworkTransport['send']>().mockResolvedValue(Response.json(response));
  const network = new NetworkManager({
    transport: { send },
    policies: { alibaba: { allowedOrigins: [new URL(settings.endpoint).origin] } }
  });
  return { send, client: new AlibabaClient(settings, network, { maxAttempts: 3, shouldRetry: () => true }) };
}

describe('IOP product posting type protocol adaptation', () => {
  it('accepts observed success without optional status text, preserving explicit flags', async () => {
    const { client, send } = clientFor(fixture.observedResponse);
    await expect(
      executeCapabilityCall(
        client,
        {
          method: fixture.method,
          parameters: fixture.request
        },
        validation
      )
    ).resolves.toMatchObject({
      contractValid: true,
      contractIssues: [],
      data: {
        biz_success: true,
        data: { support_post_whole_sale: true, support_post_sourcing: true }
      }
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it('flattens only the TOP request DTO before signing the IOP wire payload', async () => {
    const input = structuredClone(fixture.request);
    const request = await createIopBusinessRequest(credentials, fixture.method, input, 1800000000000);
    expect(request.url).toBe(IOP_BUSINESS_ENDPOINT + fixture.path);
    expect(request.parameters).toMatchObject({ cat_id: '201712702', language: 'en_us' });
    expect(request.parameters).not.toHaveProperty('type_request');
    expect(request.parameters).not.toHaveProperty('session');
    expect(request.parameters).not.toHaveProperty('method');
    expect(request.parameters.sign).toBe(
      await signIopRequest('/icbu/product/other/available/get', request.parameters, credentials.appSecret)
    );
    expect(input).toEqual(fixture.request);
  });
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false]
  ])('preserves whole-sale %s and sourcing %s without inventing permissions', async (wholeSale, sourcing) => {
    const response = structuredClone(fixture.response);
    response.result.data = { supportPostWholeSale: wholeSale, supportPostSourcing: sourcing };
    const { client, send } = clientFor(response);
    await expect(
      executeCapabilityCall(
        client,
        {
          method: fixture.method,
          parameters: fixture.request
        },
        validation
      )
    ).resolves.toMatchObject({
      contractValid: true,
      contractIssues: [],
      data: {
        biz_success: true,
        data: { support_post_whole_sale: wholeSale, support_post_sourcing: sourcing },
        trace_id: fixture.response.result.trace_id,
        request_id: fixture.response.request_id
      }
    });
    expect(send).toHaveBeenCalledOnce();
    const body = send.mock.calls[0]?.[1].body as URLSearchParams;
    expect(Object.fromEntries(body)).toMatchObject({ cat_id: '201712702', language: 'en_us' });
    expect(body.has('type_request')).toBe(false);
  });
  it.each(['top', undefined] as const)(
    'preserves %s TOP request wrappers and session signing',
    async (protocol) => {
      const settings: GatewayCredentials = {
        ...credentialsFixture.manual,
        ...(protocol === undefined ? {} : { protocol }),
        endpoint: ALIBABA_GATEWAY,
        signMethod: 'hmac'
      };
      const { client, send } = clientFor(
        {
          alibaba_icbu_product_type_available_get_response: topFixture.response
        },
        settings
      );
      await expect(
        executeCapabilityCall(
          client,
          {
            method: fixture.method,
            parameters: fixture.request
          },
          validation
        )
      ).resolves.toMatchObject({
        contractValid: true,
        data: topFixture.response
      });
      expect(send).toHaveBeenCalledOnce();
      const body = send.mock.calls[0]?.[1].body as URLSearchParams;
      expect(JSON.parse(body.get('type_request') ?? '')).toEqual(fixture.request.type_request);
      expect(body.get('session')).toBe(settings.accessToken);
      expect(body.has('cat_id')).toBe(false);
      expect(body.has('access_token')).toBe(false);
    }
  );
  it.each([undefined, null, false, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '001', '1e3', 'ciphertext'])(
    'rejects an invalid category before network: %s',
    async (cat_id) => {
      const { client, send } = clientFor(fixture.response);
      await expect(
        client.call(fixture.method, {
          type_request: { ...fixture.request.type_request, cat_id }
        })
      ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, null, false, '', ' '])(
    'rejects invalid language before network: %s',
    async (language) => {
      const { client, send } = clientFor(fixture.response);
      await expect(
        client.call(fixture.method, {
          type_request: { ...fixture.request.type_request, language }
        })
      ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it('does not drop unsupported fields or accept a mixed root and DTO', async () => {
    const { client, send } = clientFor(fixture.response);
    await expect(
      client.call(fixture.method, {
        type_request: { ...fixture.request.type_request, market: 'wholesale' }
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'ALIBABA_IOP_PARAMETER_UNSUPPORTED' } });
    await expect(
      client.call(fixture.method, {
        ...fixture.request,
        cat_id: 999
      })
    ).rejects.toMatchObject({ gatewayError: { code: 'REQUEST_CONTRACT_INVALID' } });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { supportPostWholeSale: true },
    { supportPostSourcing: false },
    { supportPostWholeSale: 'false', supportPostSourcing: true },
    { support_post_whole_sale: true, support_post_sourcing: true }
  ])('keeps missing or malformed permissions unknown: %j', (data) => {
    expect(() =>
      normalizeIopBusinessResponse(
        {
          ...fixture.response,
          result: { ...fixture.response.result, data }
        },
        fixture.method,
        credentials
      )
    ).toThrow('ALIBABA_IOP_RESPONSE_INVALID');
  });
  it('preserves business refusals and never retries or manufactures success', async () => {
    for (const result of [
      { ...fixture.response.result, success: false, msg_code: 'DENIED' },
      { ...fixture.response.result, msg_code: 'DENIED' }
    ]) {
      const { client, send } = clientFor({ ...fixture.response, result });
      await expect(client.call(fixture.method, fixture.request)).rejects.toMatchObject({
        gatewayError: { code: 'ALIBABA_IOP_API_REJECTED', subCode: 'DENIED', retryable: false }
      });
      expect(send).toHaveBeenCalledOnce();
    }
  });
});
