import { describe, expect, it, vi } from 'vitest';
import { createRequestId, GatewayException } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { testGatewayCredential } from '../src/gateway/credential-test';
import { EnvironmentAlibabaCredentialProvider } from '../src/gateway/credentials';
import fixture from '../../../mock/data/node-gateway-credentials.json';

const legacy = new EnvironmentAlibabaCredentialProvider({
  ONE_VEGETABLE_ALIBABA_APP_KEY: fixture.manual.appKey,
  ONE_VEGETABLE_ALIBABA_APP_SECRET: fixture.manual.appSecret,
  ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN: fixture.manual.accessToken
});
const provider = {
  status: () => Promise.resolve(legacy.status()),
  requireCredentials: () => Promise.resolve(legacy.requireCredentials())
};
describe('explicit read-only credential test', () => {
  it('uses exactly one minimal list operation and does not expose product data', async () => {
    const client = new MockGatewayClient(0);
    const spy = vi.spyOn(client, 'request');
    const id = createRequestId();
    const result = await testGatewayCredential(provider, id, () => client);
    expect(result.status).toBe('passed');
    expect(spy).toHaveBeenCalledExactlyOnceWith('listProducts', { page: 1, pageSize: 1 }, { requestId: id });
    expect(Object.keys(result)).not.toContain('items');
    expect(JSON.stringify(result)).not.toContain(fixture.manual.accessToken);
  });
  it('normalizes permissions without echoing remote error bodies or retrying', async () => {
    const client = new MockGatewayClient(0);
    const spy = vi.spyOn(client, 'request').mockRejectedValue(
      new GatewayException({
        code: 'PERMISSION_DENIED',
        message: 'sensitive-remote-response',
        retryable: false
      })
    );
    const result = await testGatewayCredential(provider, createRequestId(), () => client);
    expect(result.status).toBe('permission-denied');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('sensitive-remote-response');
  });
});
