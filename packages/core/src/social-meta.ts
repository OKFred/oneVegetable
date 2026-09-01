import type { components } from './generated/api';

export const META_GRAPH_API_VERSION = 'v26.0';
export const META_GRAPH_ORIGIN = 'https://graph.facebook.com';
export const META_OAUTH_ORIGIN = 'https://www.facebook.com';

export const META_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish'
] as const;

export const META_PAGE_PUBLISH_TASKS = ['CREATE_CONTENT', 'PROFILE_PLUS_CREATE_CONTENT'] as const;

export type SocialPlatform = components['schemas']['SocialPlatform'];
export type MetaAppConfigurationSummary = components['schemas']['MetaAppConfigurationSummary'];
export type MetaAppConfigurationUpdateRequest = components['schemas']['MetaAppConfigurationUpdateRequest'];
export type MetaConnectionTargetRequest = components['schemas']['MetaConnectionTargetRequest'];
export type SocialAccountConnection = components['schemas']['SocialAccountConnection'];
export type SocialDestination = components['schemas']['SocialDestination'];
export type SocialPublishJob = components['schemas']['SocialPublishJob'];
export type ExtensionSocialDevice = components['schemas']['ExtensionSocialDevice'];
export type SocialPostPrepareRequest = components['schemas']['SocialPostPrepareRequest'];
export type SocialPostTargetRequest = components['schemas']['SocialPostTargetRequest'];

export interface MetaDestinationPermissionInput {
  platform: SocialPlatform;
  grantedScopes: readonly string[];
  pageTasks: readonly string[];
  hasLinkedInstagramAccount?: boolean;
}

export interface MetaDestinationPermissionDecision {
  allowed: boolean;
  reasonCode: string | null;
  missingScopes: string[];
}

export function evaluateMetaDestinationPermission(
  input: MetaDestinationPermissionInput
): MetaDestinationPermissionDecision {
  const requiredScopes =
    input.platform === 'facebook'
      ? ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']
      : ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
  const scopes = new Set(input.grantedScopes);
  const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    return { allowed: false, reasonCode: 'META_PERMISSION_MISSING', missingScopes };
  }
  const taskSet = new Set(input.pageTasks);
  if (!META_PAGE_PUBLISH_TASKS.some((task) => taskSet.has(task))) {
    return { allowed: false, reasonCode: 'META_PAGE_TASK_MISSING', missingScopes: [] };
  }
  if (input.platform === 'instagram' && input.hasLinkedInstagramAccount !== true) {
    return { allowed: false, reasonCode: 'INSTAGRAM_ACCOUNT_NOT_LINKED', missingScopes: [] };
  }
  return { allowed: true, reasonCode: null, missingScopes: [] };
}

export function validateMetaOAuthCallback(input: {
  expectedCallbackUrl: string;
  actualCallbackUrl: string;
  expectedState: string;
}): URL {
  const expected = new URL(input.expectedCallbackUrl);
  const actual = new URL(input.actualCallbackUrl);
  if (expected.protocol !== 'https:' && !isLoopbackHttp(expected)) {
    throw new Error('Meta OAuth Callback 必须使用 HTTPS');
  }
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
    throw new Error('Meta OAuth Callback 与登记地址不匹配');
  }
  if (actual.searchParams.get('state') !== input.expectedState) {
    throw new Error('Meta OAuth state 不匹配');
  }
  if (actual.searchParams.has('error')) {
    throw new Error('Meta OAuth 授权被拒绝');
  }
  if (!actual.searchParams.get('code')) {
    throw new Error('Meta OAuth Callback 缺少 code');
  }
  return actual;
}

export function normalizeMetaPublicOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !isLoopbackHttp(url)) {
    throw new Error('公开 Origin 必须使用 HTTPS');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('公开 Origin 不能包含路径、凭据、query 或 fragment');
  }
  return url.origin;
}

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}
