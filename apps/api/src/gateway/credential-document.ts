import { parseAlibabaOpenApiCredentialBundle, parseManualGatewayCredential } from '@one-vegetable/core';
import type { AlibabaOpenApiCredentialBundle, ManualGatewayCredentialInput } from '@one-vegetable/core';

export interface GatewayCredentialDocument {
  schemaVersion: 2;
  configurationId: string;
  source: 'oauth-import' | 'manual';
  credentials: ManualGatewayCredentialInput;
  /** OAuth evidence is retained only when genuinely supplied by a validated bundle. */
  authorization: AlibabaOpenApiCredentialBundle | null;
}

export function credentialDocumentFromBundle(
  bundle: AlibabaOpenApiCredentialBundle,
  configurationId: string = crypto.randomUUID()
): GatewayCredentialDocument {
  return {
    schemaVersion: 2,
    configurationId,
    source: 'oauth-import',
    authorization: bundle,
    credentials: {
      appName: bundle.application.appName,
      appKey: bundle.application.appKey,
      appSecret: bundle.application.appSecret,
      accessToken: bundle.oauth.accessToken,
      refreshToken: bundle.oauth.refreshToken,
      accessTokenExpiresTimeUtc:
        bundle.oauth.expiresAtUtc === null ? null : Date.parse(bundle.oauth.expiresAtUtc),
      refreshTokenExpiresTimeUtc:
        bundle.oauth.refreshExpiresAtUtc === null ? null : Date.parse(bundle.oauth.refreshExpiresAtUtc)
    }
  };
}

export function parseCredentialDocument(value: unknown): GatewayCredentialDocument {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value))
    throw new Error('INVALID_CREDENTIAL_DOCUMENT');
  if (value.schemaVersion === 1) {
    const bundle = parseAlibabaOpenApiCredentialBundle(value);
    return credentialDocumentFromBundle(bundle, `legacy:${bundle.capturedAtUtc}`);
  }
  if (
    value.schemaVersion !== 2 ||
    !('configurationId' in value) ||
    typeof value.configurationId !== 'string' ||
    value.configurationId.length > 128 ||
    !value.configurationId ||
    !('credentials' in value) ||
    !('source' in value) ||
    !('authorization' in value)
  )
    throw new Error('INVALID_CREDENTIAL_DOCUMENT');
  if (value.source !== 'manual' && value.source !== 'oauth-import')
    throw new Error('INVALID_CREDENTIAL_DOCUMENT');
  if (value.source === 'manual' && value.authorization !== null)
    throw new Error('INVALID_CREDENTIAL_DOCUMENT');
  return {
    schemaVersion: 2,
    configurationId: value.configurationId,
    source: value.source,
    credentials: parseManualGatewayCredential(value.credentials),
    authorization:
      value.source === 'oauth-import' ? parseAlibabaOpenApiCredentialBundle(value.authorization) : null
  };
}
