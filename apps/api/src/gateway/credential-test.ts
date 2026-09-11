import { GatewayException } from '@one-vegetable/core';
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
    configurationId = await galleryGatewayId(credentials);
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
    const safeCode = /^[A-Za-z0-9._:-]{1,128}$/u.test(code) ? code : 'GATEWAY_CONNECTION_FAILED';
    const status =
      error instanceof GatewayConfigurationError ||
      /TOKEN|CREDENTIAL|SIGNATURE|invalid-session|invalid-signature/iu.test(safeCode)
        ? 'credentials-invalid'
        : /PERMISSION|AUTHORITY|ACCESS_DENIED|insufficient-isv-permissions|insufficient-user-permissions/iu.test(
              safeCode
            )
          ? 'permission-denied'
          : /CONTRACT|RESPONSE_INVALID/iu.test(safeCode)
            ? 'contract-drift'
            : 'network-error';
    return {
      status,
      requestId,
      checkedAtUtc: clock(),
      durationMilliseconds: Math.max(0, clock() - started),
      configurationId,
      errorCode: safeCode
    };
  }
}
