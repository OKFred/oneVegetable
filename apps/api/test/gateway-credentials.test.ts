import { describe, expect, it } from 'vitest';

import { EnvironmentAlibabaCredentialProvider } from '../src/gateway/credentials';

import type { GatewayConfigurationError } from '../src/gateway/credentials';

describe('server Alibaba credential provider', () => {
  it('returns only redacted configuration status', () => {
    const provider = new EnvironmentAlibabaCredentialProvider({
      ONE_VEGETABLE_ALIBABA_APP_KEY: 'app-key-value',
      ONE_VEGETABLE_ALIBABA_APP_SECRET: 'app-secret-value',
      ONE_VEGETABLE_ALIBABA_ACCESS_TOKEN: 'access-token-value',
      ONE_VEGETABLE_ALIBABA_ENDPOINT: 'https://eco.taobao.com/router/rest',
      ONE_VEGETABLE_ALIBABA_SIGN_METHOD: 'hmac-sha256'
    });

    expect(provider.status()).toEqual({
      source: 'environment',
      configured: true,
      hasAppKey: true,
      hasAppSecret: true,
      hasAccessToken: true,
      endpointOrigin: 'https://eco.taobao.com',
      signMethod: 'hmac-sha256'
    });
    expect(JSON.stringify(provider.status())).not.toContain('value');
    expect(provider.requireCredentials()).toMatchObject({ appKey: 'app-key-value' });
  });

  it('fails closed for partial credentials without putting values in the error', () => {
    const provider = new EnvironmentAlibabaCredentialProvider({
      ONE_VEGETABLE_ALIBABA_APP_KEY: 'app-key-value',
      ONE_VEGETABLE_ALIBABA_APP_SECRET: 'app-secret-value'
    });

    expect(provider.status()).toMatchObject({ configured: false, hasAccessToken: false });
    expect(() => provider.requireCredentials()).toThrow(
      expect.objectContaining<Partial<GatewayConfigurationError>>({ code: 'ALIBABA_CREDENTIALS_INCOMPLETE' })
    );
    expect(captureError(() => provider.requireCredentials())).not.toContain('app-secret-value');
  });

  it('rejects non-HTTPS endpoints, credential URLs and unsupported signing methods', () => {
    expect(
      () => new EnvironmentAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_ENDPOINT: 'http://example.com' })
    ).toThrow('HTTPS');
    expect(
      () =>
        new EnvironmentAlibabaCredentialProvider({
          ONE_VEGETABLE_ALIBABA_ENDPOINT: 'https://name:password@example.com/router/rest'
        })
    ).toThrow('HTTPS');
    expect(
      () => new EnvironmentAlibabaCredentialProvider({ ONE_VEGETABLE_ALIBABA_SIGN_METHOD: 'sha1' })
    ).toThrow('签名算法');
  });
});

function captureError(action: () => void): string {
  try {
    action();
    return '';
  } catch (error: unknown) {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  }
}
