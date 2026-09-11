/** Server-side configuration input; secrets must never be returned or persisted in the browser. */
export interface ManualGatewayCredentialInput {
  appName: string | null;
  appKey: string;
  appSecret: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresTimeUtc: number | null;
  refreshTokenExpiresTimeUtc: number | null;
}

export interface GatewayCredentialTestResult {
  status:
    'passed' | 'no-data' | 'permission-denied' | 'credentials-invalid' | 'network-error' | 'contract-drift';
  requestId: string;
  checkedAtUtc: number;
  durationMilliseconds: number;
  configurationId: string | null;
  errorCode: string | null;
}

export function parseManualGatewayCredential(value: unknown): ManualGatewayCredentialInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_CREDENTIAL_INPUT');
  const input = value as Record<string, unknown>;
  const allowed = [
    'appName',
    'appKey',
    'appSecret',
    'accessToken',
    'refreshToken',
    'accessTokenExpiresTimeUtc',
    'refreshTokenExpiresTimeUtc'
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('INVALID_CREDENTIAL_INPUT');
  const secret = (key: string): string => {
    const entry = input[key];
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 4096)
      throw new Error('INVALID_CREDENTIAL_INPUT');
    return entry.trim();
  };
  const timestamp = (key: string): number | null => {
    const entry = input[key];
    if (entry === null || entry === undefined) return null;
    if (
      typeof entry !== 'number' ||
      !Number.isSafeInteger(entry) ||
      entry < 0 ||
      entry > 8_640_000_000_000_000
    )
      throw new Error('INVALID_CREDENTIAL_INPUT');
    return entry;
  };
  if (
    input.appName !== null &&
    input.appName !== undefined &&
    (typeof input.appName !== 'string' || input.appName.length > 256)
  )
    throw new Error('INVALID_CREDENTIAL_INPUT');
  return {
    appName: typeof input.appName === 'string' ? input.appName.trim() || null : null,
    appKey: secret('appKey'),
    appSecret: secret('appSecret'),
    accessToken: secret('accessToken'),
    refreshToken:
      input.refreshToken === null || input.refreshToken === undefined || input.refreshToken === ''
        ? null
        : secret('refreshToken'),
    accessTokenExpiresTimeUtc: timestamp('accessTokenExpiresTimeUtc'),
    refreshTokenExpiresTimeUtc: timestamp('refreshTokenExpiresTimeUtc')
  };
}
