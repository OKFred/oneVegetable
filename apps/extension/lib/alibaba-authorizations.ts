import {
  authorizationBindingMatches,
  GatewayException,
  selectAlibabaOperationProtocol,
  type AlibabaAuthorizationsSummary,
  type GatewayCredentialSettings,
  type GatewayCredentials,
  type GatewaySettings,
  type OperationId
} from '@one-vegetable/core';
import { galleryGatewayId } from '@one-vegetable/core/gallery-transfer-context';

export type AuthorizationProtocol = 'top' | 'iop';

/** Runtime-only identity: refresh rotates tokens, not the pinned configuration. Never persist this field. */
export function runtimeAuthorization(
  profile: GatewayCredentialSettings
): GatewaySettings & GatewayCredentials {
  return {
    ...profile,
    ...(profile.configurationId ? { galleryAccountGeneration: profile.configurationId } : {})
  };
}

export function configuredAuthorization(value: GatewayCredentialSettings | undefined): boolean {
  return Boolean(value?.appKey && value.appSecret && value.accessToken);
}

export function authorizationProfiles(settings: GatewaySettings) {
  const profiles = { ...settings.protocolCredentials };
  const { protocolCredentials: _profiles, authorizationBinding: _binding, ...primary } = settings;
  profiles[settings.protocol ?? 'top'] = primary;
  return profiles;
}

/** Backfill old ciphertext identities once, inside the vault, before exposing summaries. */
export function initializeAuthorizationIdentities(settings: GatewaySettings): GatewaySettings {
  let next = settings;
  const profiles = authorizationProfiles(settings);
  for (const protocol of ['top', 'iop'] as const) {
    const profile = profiles[protocol];
    if (configuredAuthorization(profile) && profile && !profile.configurationId)
      next = replaceAuthorization(next, protocol, { ...profile, configurationId: crypto.randomUUID() });
  }
  return next;
}

export function replaceAuthorization(
  settings: GatewaySettings,
  protocol: AuthorizationProtocol,
  profile: GatewayCredentialSettings
): GatewaySettings {
  const { authorizationBinding: _binding, ...rest } = settings;
  if ((settings.protocol ?? 'top') === protocol) return { ...rest, ...profile };
  return { ...rest, protocolCredentials: { ...rest.protocolCredentials, [protocol]: profile } };
}

export function saveAuthorizationPatch(settings: GatewaySettings, patch: GatewaySettings): GatewaySettings {
  const protocol = patch.protocol ?? settings.protocol ?? 'top';
  const previous = authorizationProfiles(settings)[protocol];
  const old = previous ?? { ...patch, appKey: '', appSecret: '', accessToken: '' };
  const replacement =
    Boolean(patch.appSecret) ||
    Boolean(patch.accessToken) ||
    Boolean(patch.refreshToken) ||
    Boolean(patch.appKey && patch.appKey !== old.appKey);
  const next: GatewayCredentialSettings = {
    ...old,
    ...patch,
    appKey: patch.appKey || old.appKey,
    appSecret: patch.appSecret || old.appSecret,
    accessToken: patch.accessToken || old.accessToken,
    ...(old.configurationId === undefined ? {} : { configurationId: old.configurationId }),
    // Never reuse the other slot's blanks, identity or refresh state for a new credential import.
    ...(replacement
      ? {
          configurationId: crypto.randomUUID(),
          refreshToken: patch.refreshToken ?? null,
          refreshTokenExpiresTimeUtc: patch.refreshTokenExpiresTimeUtc ?? null,
          accessTokenExpiresTimeUtc: patch.accessTokenExpiresTimeUtc ?? null,
          accessTokenCapturedTimeUtc: patch.accessTokenCapturedTimeUtc ?? null,
          systemApiPermission: patch.systemApiPermission ?? 'unknown',
          permissionCapturedTimeUtc: patch.permissionCapturedTimeUtc ?? null
        }
      : {})
  };
  if ((settings.protocol ?? 'top') !== protocol) next.protocol = protocol;
  const changed = replacement || next.endpoint !== old.endpoint || next.signMethod !== old.signMethod;
  if (!configuredAuthorization(next))
    throw new GatewayException({
      code: 'CREDENTIAL_VAULT_EMPTY',
      message: 'CREDENTIAL_VAULT_EMPTY',
      retryable: false
    });
  if (changed && !replacement) next.configurationId = crypto.randomUUID();
  // Protection can be prepared before either authorization exists. Its blank TOP
  // placeholder is not a saved protocol preference: use the first real profile.
  if (!Object.values(authorizationProfiles(settings)).some(configuredAuthorization))
    return { ...next, protocol };
  const result = replaceAuthorization(settings, protocol, next);
  return !changed && settings.authorizationBinding
    ? { ...result, authorizationBinding: settings.authorizationBinding }
    : result;
}

export function clearAuthorizationProfile(
  settings: GatewaySettings,
  protocol: AuthorizationProtocol
): GatewaySettings {
  const { authorizationBinding: _binding, protocolCredentials, ...primary } = settings;
  const profiles = { ...protocolCredentials };
  Reflect.deleteProperty(profiles, protocol);
  if ((settings.protocol ?? 'top') !== protocol) return { ...primary, protocolCredentials: profiles };
  const other = protocol === 'top' ? 'iop' : 'top';
  const remaining = profiles[other];
  if (remaining && configuredAuthorization(remaining)) return { ...remaining, protocol: other };
  return {
    protocol,
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: primary.endpoint,
    signMethod: primary.signMethod
  };
}

/** Promote a saved profile without re-importing it or changing either account identity. */
export function setDefaultAuthorization(
  settings: GatewaySettings,
  protocol: AuthorizationProtocol,
  configurationId: string
): GatewaySettings {
  const profiles = authorizationProfiles(settings);
  const selected = profiles[protocol];
  if (!selected || !configuredAuthorization(selected))
    throw new GatewayException({
      code: 'CREDENTIAL_VAULT_EMPTY',
      message: 'CREDENTIAL_VAULT_EMPTY',
      retryable: false
    });
  if (!selected.configurationId || selected.configurationId !== configurationId)
    throw new GatewayException({
      code: 'ENTITY_VERSION_CONFLICT',
      message: 'ENTITY_VERSION_CONFLICT',
      retryable: false
    });
  const other = protocol === 'top' ? 'iop' : 'top';
  return {
    ...selected,
    protocol,
    protocolCredentials: profiles[other] ? { [other]: profiles[other] } : {},
    ...(settings.authorizationBinding ? { authorizationBinding: settings.authorizationBinding } : {})
  };
}

export function summarizeAuthorizations(settings?: GatewaySettings): AlibabaAuthorizationsSummary {
  const profiles = settings ? authorizationProfiles(settings) : {};
  const summary = (protocol: AuthorizationProtocol): AlibabaAuthorizationsSummary['top'] => {
    const profile = profiles[protocol];
    if (!profile || !configuredAuthorization(profile)) return null;
    return {
      protocol,
      configured: true,
      configurationId: profile.configurationId ?? null,
      appKeySuffix: profile.appKey.slice(-4),
      canRefresh:
        Boolean(profile.refreshToken) &&
        (profile.refreshTokenExpiresTimeUtc == null || profile.refreshTokenExpiresTimeUtc > Date.now()),
      managementAvailable: true,
      revision: null,
      accessTokenExpiresTimeUtc: profile.accessTokenExpiresTimeUtc ?? null,
      accessTokenCapturedTimeUtc: profile.accessTokenCapturedTimeUtc ?? null,
      refreshTokenExpiresTimeUtc: profile.refreshTokenExpiresTimeUtc ?? null,
      lastRefreshTimeUtc: null,
      lastRefreshErrorCode: null,
      updateTimeUtc: null,
      updaterId: null,
      remark: null
    };
  };
  const top = summary('top');
  const iop = summary('iop');
  const ids = { top: top?.configurationId ?? null, iop: iop?.configurationId ?? null };
  const confirmed = authorizationBindingMatches(settings?.authorizationBinding, ids);
  return {
    top,
    iop,
    defaultProtocol: settings?.protocol ?? 'top',
    binding: {
      confirmed,
      topConfigurationId: ids.top,
      iopConfigurationId: ids.iop,
      confirmedAtUtc: confirmed ? (settings?.authorizationBinding?.confirmedAtUtc ?? null) : null
    }
  };
}

export function authorizationAvailability(settings: GatewaySettings) {
  const summary = summarizeAuthorizations(settings);
  return {
    top: summary.top !== null,
    iop: summary.iop !== null,
    defaultProtocol: summary.defaultProtocol,
    bindingConfirmed: summary.binding.confirmed
  };
}

export function editableAuthorization(profile: GatewayCredentialSettings): GatewaySettings {
  return {
    ...(profile.protocol === undefined ? {} : { protocol: profile.protocol }),
    ...(profile.configurationId === undefined ? {} : { configurationId: profile.configurationId }),
    appKey: profile.appKey,
    appSecret: '',
    accessToken: '',
    endpoint: profile.endpoint,
    signMethod: profile.signMethod,
    accessTokenExpiresTimeUtc: profile.accessTokenExpiresTimeUtc ?? null,
    accessTokenCapturedTimeUtc: profile.accessTokenCapturedTimeUtc ?? null,
    systemApiPermission: profile.systemApiPermission ?? 'unknown',
    permissionCapturedTimeUtc: profile.permissionCapturedTimeUtc ?? null
  };
}

/** Match pinned tasks against every saved profile. Never reinterpret a pinned context as a preference. */
export async function resolveAuthorization(
  settings: GatewaySettings,
  operation?: OperationId,
  payload?: unknown,
  pinnedGateway?: string,
  contextError = 'PRODUCT_CONTEXT_CHANGED'
): Promise<GatewaySettings & GatewayCredentials> {
  const profiles = authorizationProfiles(settings);
  if (pinnedGateway !== undefined) {
    for (const protocol of ['top', 'iop'] as const) {
      const profile = profiles[protocol];
      if (
        profile &&
        configuredAuthorization(profile) &&
        (await galleryGatewayId(runtimeAuthorization(profile))) === pinnedGateway
      )
        return runtimeAuthorization(profile);
    }
    throw new GatewayException({ code: contextError, message: contextError, retryable: false });
  }
  const protocol = operation
    ? selectAlibabaOperationProtocol(operation, payload, authorizationAvailability(settings))
    : (settings.protocol ?? 'top');
  const selected = profiles[protocol];
  if (!selected || !configuredAuthorization(selected))
    throw new GatewayException({
      code: 'CREDENTIAL_VAULT_EMPTY',
      message: 'CREDENTIAL_VAULT_EMPTY',
      retryable: false
    });
  return runtimeAuthorization(selected);
}
