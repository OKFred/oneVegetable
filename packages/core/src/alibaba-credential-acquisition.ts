import type { AlibabaOpenApiCredentialBundle } from './alibaba-credential-bundle';
import type { components } from './generated/api';
import type { GatewayError } from './types';

export const ALIBABA_CREDENTIAL_ACQUISITION_JOB_TTL_MILLISECONDS = 10 * 60 * 1_000;
export const ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_WINDOW_MILLISECONDS = 30 * 60 * 1_000;
export const ALIBABA_CREDENTIAL_ACQUISITION_RATE_LIMIT_MAXIMUM = 3;

export type AlibabaCredentialApplicationSummary =
  components['schemas']['AlibabaCredentialAcquisitionApplicationSummary'];
export type AlibabaCredentialApplicationSource = AlibabaCredentialApplicationSummary['source'];
export type AlibabaCredentialPermissionSummary =
  components['schemas']['AlibabaCredentialAcquisitionCompletedSummary']['permissions'];
export type AlibabaCredentialAcquisitionCompletedSummary =
  components['schemas']['AlibabaCredentialAcquisitionCompletedSummary'];
export type AlibabaCredentialAcquisitionExtensionFallbackReason =
  components['schemas']['AlibabaCredentialAcquisitionExtensionRequiredState']['reasonCode'];
export type AlibabaCredentialAcquisitionStartRequest =
  components['schemas']['AlibabaCredentialAcquisitionStartRequest'];
export type AlibabaCredentialAcquisitionContinueCommand =
  components['schemas']['AlibabaCredentialAcquisitionContinueCommand'];
export type AlibabaCredentialAcquisitionContinueRequest =
  components['schemas']['AlibabaCredentialAcquisitionContinueRequest'];
export type AlibabaCredentialAcquisitionJobRequest =
  components['schemas']['AlibabaCredentialAcquisitionJobRequest'];
export type AlibabaCredentialAcquisitionState = components['schemas']['AlibabaCredentialAcquisitionState'];
export type AlibabaCredentialAcquisitionPrerequisiteReason =
  components['schemas']['AlibabaCredentialAcquisitionPrerequisiteState']['reasonCode'];

export interface AlibabaCredentialApplicationCandidate {
  applicationId: string;
  appName: string;
  appKey: string;
  status: string;
  source: AlibabaCredentialApplicationSource;
}

export type AlibabaCredentialAcquisitionFailureCode =
  | 'ACQUISITION_CANCELLED'
  | 'ACQUISITION_EXPIRED'
  | 'APPLICATION_NOT_FOUND'
  | 'APPLICATION_SELECTION_INVALID'
  | 'CALLBACK_INVALID'
  | 'CALLBACK_UPDATE_FAILED'
  | 'CREDENTIAL_STORE_FAILED'
  | 'INTERNAL_ERROR'
  | 'LOGIN_FAILED'
  | 'NO_APPLICATION'
  | 'OAUTH_CODE_MISSING'
  | 'OAUTH_FAILED'
  | 'OAUTH_PROVIDER_ERROR'
  | 'OAUTH_STATE_MISMATCH'
  | 'TOKEN_EXCHANGE_FAILED';

type AlibabaCredentialAcquisitionTerminalState = Extract<
  AlibabaCredentialAcquisitionState,
  { status: 'completed' | 'extension-required' | 'failed' | 'prerequisite-required' }
>;

export type AlibabaCredentialAcquisitionTransition =
  | { type: 'require-application-selection'; applications: AlibabaCredentialApplicationSummary[] }
  | { type: 'require-callback-confirmation'; currentUrl: string; requestedUrl: string }
  | { type: 'resume' }
  | { type: 'require-prerequisite'; reasonCode: AlibabaCredentialAcquisitionPrerequisiteReason }
  | { type: 'require-extension'; reasonCode: AlibabaCredentialAcquisitionExtensionFallbackReason }
  | { type: 'complete'; credential: AlibabaCredentialAcquisitionCompletedSummary }
  | { type: 'fail'; code: AlibabaCredentialAcquisitionFailureCode }
  | { type: 'cancel' };

export type AlibabaCredentialApplicationSelection =
  | { kind: 'selected'; application: AlibabaCredentialApplicationCandidate }
  | { kind: 'selection-required'; applications: AlibabaCredentialApplicationSummary[] }
  | {
      kind: 'failed';
      code: 'NO_APPLICATION' | 'APPLICATION_NOT_FOUND' | 'APPLICATION_SELECTION_INVALID';
    };

export interface AlibabaCredentialApplicationSelector {
  appKey?: string | null;
  appName?: string | null;
}

export class AlibabaCredentialAcquisitionContractError extends Error {
  constructor(
    public readonly code: AlibabaCredentialAcquisitionFailureCode,
    message: string
  ) {
    super(message);
    this.name = 'AlibabaCredentialAcquisitionContractError';
  }
}

export function createAlibabaCredentialAcquisitionState(
  jobId: string,
  now = Date.now()
): AlibabaCredentialAcquisitionState {
  if (!isUuid(jobId)) {
    throw new AlibabaCredentialAcquisitionContractError('INTERNAL_ERROR', 'Alibaba 凭据获取任务 ID 无效');
  }
  return {
    status: 'running',
    jobId,
    expiresAtUtc: now + ALIBABA_CREDENTIAL_ACQUISITION_JOB_TTL_MILLISECONDS
  };
}

export function transitionAlibabaCredentialAcquisitionState(
  state: AlibabaCredentialAcquisitionState,
  transition: AlibabaCredentialAcquisitionTransition,
  now = Date.now()
): AlibabaCredentialAcquisitionState {
  if (isTerminalState(state)) {
    throw new AlibabaCredentialAcquisitionContractError('INTERNAL_ERROR', 'Alibaba 凭据获取任务已经结束');
  }
  if (now >= state.expiresAtUtc) {
    return failedState('ACQUISITION_EXPIRED');
  }
  if (transition.type === 'require-extension') {
    return { status: 'extension-required', reasonCode: transition.reasonCode };
  }
  if (transition.type === 'require-prerequisite') {
    return { status: 'prerequisite-required', reasonCode: transition.reasonCode, checkedAtUtc: now };
  }
  if (transition.type === 'fail') return failedState(transition.code);
  if (transition.type === 'cancel') return failedState('ACQUISITION_CANCELLED');
  if (transition.type === 'resume') {
    if (state.status === 'running') return state;
    return { status: 'running', jobId: state.jobId, expiresAtUtc: state.expiresAtUtc };
  }
  if (state.status !== 'running') {
    throw new AlibabaCredentialAcquisitionContractError(
      'INTERNAL_ERROR',
      'Alibaba 凭据获取任务当前不能执行该转换'
    );
  }
  if (transition.type === 'require-application-selection') {
    if (transition.applications.length < 2) {
      throw new AlibabaCredentialAcquisitionContractError(
        'APPLICATION_SELECTION_INVALID',
        '只有多个应用时才能请求选择'
      );
    }
    return {
      status: 'selection-required',
      jobId: state.jobId,
      expiresAtUtc: state.expiresAtUtc,
      applications: transition.applications.map((application) => ({ ...application }))
    };
  }
  if (transition.type === 'require-callback-confirmation') {
    const currentUrl = parseAlibabaCredentialCallbackUrl(transition.currentUrl).href;
    const requestedUrl = parseAlibabaCredentialCallbackUrl(transition.requestedUrl).href;
    if (currentUrl === requestedUrl) return state;
    return {
      status: 'callback-confirmation-required',
      jobId: state.jobId,
      expiresAtUtc: state.expiresAtUtc,
      currentUrl,
      requestedUrl
    };
  }
  return { status: 'completed', credential: transition.credential };
}

export function resolveAlibabaCredentialApplication(
  candidates: readonly AlibabaCredentialApplicationCandidate[],
  selector: AlibabaCredentialApplicationSelector = {}
): AlibabaCredentialApplicationSelection {
  if (candidates.length === 0) return { kind: 'failed', code: 'NO_APPLICATION' };
  const appKey = normalizedSelector(selector.appKey);
  const appName = normalizedSelector(selector.appName);
  if (appKey || appName) {
    const matches = candidates.filter(
      (candidate) => (!appKey || candidate.appKey === appKey) && (!appName || candidate.appName === appName)
    );
    const [match] = matches;
    if (matches.length === 1 && match) return { kind: 'selected', application: match };
    return {
      kind: 'failed',
      code: matches.length === 0 ? 'APPLICATION_NOT_FOUND' : 'APPLICATION_SELECTION_INVALID'
    };
  }
  const [candidate] = candidates;
  if (candidates.length === 1 && candidate) return { kind: 'selected', application: candidate };
  return {
    kind: 'selection-required',
    applications: candidates.map(toAlibabaCredentialApplicationSummary)
  };
}

export function toAlibabaCredentialApplicationSummary(
  candidate: AlibabaCredentialApplicationCandidate
): AlibabaCredentialApplicationSummary {
  return {
    applicationId: candidate.applicationId,
    appName: candidate.appName,
    appKeySuffix: secretSuffix(candidate.appKey),
    status: candidate.status,
    source: candidate.source
  };
}

export function createAlibabaCredentialAcquisitionCompletedSummary(
  bundle: AlibabaOpenApiCredentialBundle
): AlibabaCredentialAcquisitionCompletedSummary {
  return {
    appName: bundle.application.appName,
    appKeySuffix: secretSuffix(bundle.application.appKey),
    applicationStatus: bundle.application.status,
    permissions: {
      total: bundle.application.permissions.length,
      items: bundle.application.permissions.map((permission) => ({ ...permission }))
    },
    accessTokenExpiresTimeUtc: optionalDateToEpoch(bundle.oauth.expiresAtUtc),
    refreshTokenExpiresTimeUtc: optionalDateToEpoch(bundle.oauth.refreshExpiresAtUtc)
  };
}

export function parseAlibabaCredentialCallbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AlibabaCredentialAcquisitionContractError('CALLBACK_INVALID', 'Callback URL 无效');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    url.hostname === 'localhost' ||
    isPrivateHost(url.hostname)
  ) {
    throw new AlibabaCredentialAcquisitionContractError(
      'CALLBACK_INVALID',
      'Callback 必须是公共 HTTPS URL，且不能包含凭据或 fragment'
    );
  }
  return url;
}

export function optionalAlibabaCredentialCallbackUrl(value: string | null | undefined): URL | null {
  const candidate = value?.trim() ?? '';
  return candidate === '' ? null : parseAlibabaCredentialCallbackUrl(candidate);
}

export function callbackMatchesAlibabaRegistration(expected: URL, actual: URL): boolean {
  return (
    expected.origin === actual.origin && normalizePath(expected.pathname) === normalizePath(actual.pathname)
  );
}

export function validateAlibabaOAuthCallback(
  callbackUrl: URL,
  registeredCallbackUrl: URL,
  expectedState: string
): string {
  if (!callbackMatchesAlibabaRegistration(registeredCallbackUrl, callbackUrl)) {
    throw new AlibabaCredentialAcquisitionContractError(
      'CALLBACK_INVALID',
      'OAuth Callback 与应用登记地址不匹配'
    );
  }
  if (callbackUrl.searchParams.has('error')) {
    throw new AlibabaCredentialAcquisitionContractError(
      'OAUTH_PROVIDER_ERROR',
      'Alibaba 拒绝了本次 OAuth 授权'
    );
  }
  if (callbackUrl.searchParams.get('state') !== expectedState) {
    throw new AlibabaCredentialAcquisitionContractError(
      'OAUTH_STATE_MISMATCH',
      'OAuth Callback state 不匹配'
    );
  }
  const code = callbackUrl.searchParams.get('code');
  if (!code) {
    throw new AlibabaCredentialAcquisitionContractError('OAUTH_CODE_MISSING', 'OAuth Callback 缺少授权码');
  }
  return code;
}

export function createAlibabaCredentialAcquisitionFailure(
  code: AlibabaCredentialAcquisitionFailureCode
): GatewayError {
  return {
    code,
    message: FAILURE_MESSAGES[code],
    retryable: code === 'INTERNAL_ERROR' || code === 'TOKEN_EXCHANGE_FAILED'
  };
}

const FAILURE_MESSAGES: Record<AlibabaCredentialAcquisitionFailureCode, string> = {
  ACQUISITION_CANCELLED: 'Alibaba 凭据获取任务已取消',
  ACQUISITION_EXPIRED: 'Alibaba 凭据获取任务已过期，请重新开始',
  APPLICATION_NOT_FOUND: '没有找到与所选条件匹配的 Alibaba 应用',
  APPLICATION_SELECTION_INVALID: 'Alibaba 应用选择无效',
  CALLBACK_INVALID: 'Alibaba 应用 Callback 配置无效',
  CALLBACK_UPDATE_FAILED: 'Alibaba 应用 Callback 更新失败',
  CREDENTIAL_STORE_FAILED: 'Alibaba 凭据安全保存失败',
  INTERNAL_ERROR: 'Alibaba 凭据获取暂时失败，请稍后重试',
  LOGIN_FAILED: 'Alibaba 登录失败',
  NO_APPLICATION: '当前账号没有可复用的 Alibaba 应用',
  OAUTH_CODE_MISSING: 'Alibaba OAuth 回调缺少授权码',
  OAUTH_FAILED: 'Alibaba OAuth 授权失败',
  OAUTH_PROVIDER_ERROR: 'Alibaba 拒绝了本次 OAuth 授权',
  OAUTH_STATE_MISMATCH: 'Alibaba OAuth 安全校验失败',
  TOKEN_EXCHANGE_FAILED: 'Alibaba Access Token 获取失败'
};

function failedState(code: AlibabaCredentialAcquisitionFailureCode): AlibabaCredentialAcquisitionState {
  return { status: 'failed', error: createAlibabaCredentialAcquisitionFailure(code) };
}

function isTerminalState(
  state: AlibabaCredentialAcquisitionState
): state is AlibabaCredentialAcquisitionTerminalState {
  return (
    state.status === 'completed' ||
    state.status === 'failed' ||
    state.status === 'extension-required' ||
    state.status === 'prerequisite-required'
  );
}

function normalizedSelector(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function secretSuffix(value: string): string {
  return value.slice(-4);
}

function optionalDateToEpoch(value: string | null): number | null {
  return value === null ? null : Date.parse(value);
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (normalized === '::1' || normalized === '0.0.0.0') return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
