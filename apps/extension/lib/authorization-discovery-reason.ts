/** Only public reason codes may cross into the Alibaba page guide. */
export const AUTHORIZATION_DISCOVERY_REASONS = [
  'IOP_APP_READ_FAILED',
  'IOP_APP_CENTER_UNAVAILABLE',
  'IOP_APP_PAGE_UNAVAILABLE',
  'IOP_APP_SECRET_CONTROL_UNAVAILABLE',
  'IOP_APP_SECRET_UNAVAILABLE',
  'IOP_APP_SECURITY_CHECK',
  'IOP_APP_LOGIN_REQUIRED',
  'IOP_APP_PREREQUISITE_REQUIRED',
  'IOP_APP_SELECTION_REQUIRED',
  'IOP_APP_CHANGED',
  'CALLBACK_INVALID',
  'TOP_APP_NOT_AVAILABLE',
  'TOP_APP_SELECTION_REQUIRED'
] as const;

export type AuthorizationDiscoveryReason = (typeof AUTHORIZATION_DISCOVERY_REASONS)[number];

export function authorizationDiscoveryReason(value: unknown): AuthorizationDiscoveryReason | undefined {
  return typeof value === 'string' && (AUTHORIZATION_DISCOVERY_REASONS as readonly string[]).includes(value)
    ? (value as AuthorizationDiscoveryReason)
    : undefined;
}
