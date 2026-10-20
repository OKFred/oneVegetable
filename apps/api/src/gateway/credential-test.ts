import { credentialTestFailure, GatewayException } from '@one-vegetable/core';
import { galleryGatewayId } from '@one-vegetable/core/gallery-transfer-context';
import { GatewayConfigurationError } from './credentials';
import { AlibabaReadGatewayClient } from './alibaba-read-gateway';
import type { AsyncAlibabaCredentialProvider } from './credentials';
import type { GatewayCredentialTestResult, GatewayCredentials, GatewayClient } from '@one-vegetable/core';

export async function testGatewayCredential(
  provider: AsyncAlibabaCredentialProvider,
  requestId: string,
  createGateway: (credentials: GatewayCredentials) => GatewayClient = (credentials) =>
    new AlibabaReadGatewayClient(credentials, { maxAttempts: 1 }),
  clock: () => number = Date.now
): Promise<GatewayCredentialTestResult> {
  const started = clock();
  let configurationId: string | null = null;
  try {
    const credentials = await provider.requireCredentials(requestId);
    configurationId = credentials.galleryAccountGeneration ?? (await galleryGatewayId(credentials));
    const page = await createGateway(credentials).request(
      'listProducts',
      { page: 1, pageSize: 1 },
      { requestId }
    );
    return {
      status: page.items.length ? 'passed' : 'no-data',
      requestId,
      checkedAtUtc: clock(),
      durationMilliseconds: Math.max(0, clock() - started),
      configurationId,
      errorCode: null
    };
  } catch (error: unknown) {
    const code =
      error instanceof GatewayConfigurationError
        ? error.code
        : error instanceof GatewayException
          ? (error.gatewayError.subCode ?? error.gatewayError.code)
          : 'GATEWAY_CONNECTION_FAILED';
    return {
      ...credentialTestFailure(code, error instanceof GatewayConfigurationError),
      requestId,
      checkedAtUtc: clock(),
      durationMilliseconds: Math.max(0, clock() - started),
      configurationId
    };
  }
}
