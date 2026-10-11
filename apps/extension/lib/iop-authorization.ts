import type { AlibabaIopTokenClient } from '@one-vegetable/core/alibaba-iop';
import { IOP_AUTHORIZE_ENDPOINT, isRecord } from '@one-vegetable/core/alibaba-iop';
import {
  openAlibabaAuthorization,
  sealAlibabaAuthorization,
  resealAlibabaAuthorization,
  type OpenAlibabaAuthorizationVault
} from '@one-vegetable/core/alibaba-authorization-vault';
import {
  createAlibabaOpenApiCredentialBundle,
  credentialExpiryFromSeconds,
  parseAlibabaOpenApiCredentialBundle,
  type AlibabaOpenApiCredentialBundle,
  type AlibabaTokenResponse
} from '@one-vegetable/core/credential-bundle';
import { GatewayException } from '@one-vegetable/core/errors';
import { validateVaultPassphrase } from '@one-vegetable/core/credential-vault';

import { IOP_VAULT_KEY, IOP_RECEIPT_KEY } from './iop-authorization-storage';
export { IOP_VAULT_KEY, IOP_RECEIPT_KEY } from './iop-authorization-storage';
export interface AuthorizationStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface IopAuthorizationSummary {
  state: 'empty' | 'locked' | 'ready' | 'waiting' | 'busy' | 'unknown';
  appName: string | null;
  appKeySuffix: string | null;
  expiresAtUtc: string | null;
  refreshExpiresAtUtc: string | null;
  canRefresh: boolean;
  canSave: boolean;
  errorCode: string | null;
}
interface AuthorizationJob {
  application: AlibabaOpenApiCredentialBundle['application'];
  state: string;
  tabId: number;
  deadline: number;
  passphrase: string;
}

/** No website passwords, remote code, automatic authorization confirmation or TOP fallback. */
export class IopAuthorizationController {
  private unlocked: OpenAlibabaAuthorizationVault | null = null;
  private job: AuthorizationJob | null = null;
  private busy = false;
  private errorCode: string | null = null;
  private pendingSave = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: AuthorizationStorage,
    private readonly client: Pick<AlibabaIopTokenClient, 'request'>,
    private readonly openTab: (url: string) => Promise<number>,
    private readonly clock: () => number = Date.now
  ) {}

  async status(): Promise<IopAuthorizationSummary> {
    if (this.job && this.job.deadline <= this.clock()) {
      this.endJob();
      this.errorCode = 'AUTH_TASK_EXPIRED';
    }
    const receipt = (await this.storage.get(IOP_RECEIPT_KEY))[IOP_RECEIPT_KEY];
    const pending = receipt !== null && receipt !== undefined;
    const exists = (await this.storage.get(IOP_VAULT_KEY))[IOP_VAULT_KEY] !== undefined;
    if (!exists && !this.pendingSave) this.unlocked = null;
    const bundle = this.unlocked?.bundle;
    return {
      state: this.busy
        ? 'busy'
        : this.job
          ? 'waiting'
          : pending
            ? 'unknown'
            : !this.unlocked
              ? exists
                ? 'locked'
                : 'empty'
              : 'ready',
      appName: bundle?.application.appName ?? null,
      appKeySuffix: bundle?.application.appKey.slice(-4) ?? null,
      expiresAtUtc: bundle?.oauth.expiresAtUtc ?? null,
      refreshExpiresAtUtc: bundle?.oauth.refreshExpiresAtUtc ?? null,
      canRefresh:
        !!bundle?.oauth.refreshToken &&
        !pending &&
        !this.busy &&
        !this.job &&
        (bundle.oauth.refreshExpiresAtUtc === null ||
          Date.parse(bundle.oauth.refreshExpiresAtUtc) > this.clock()),
      canSave: this.pendingSave && !!this.unlocked && !this.busy,
      errorCode: this.errorCode ?? (pending ? 'AUTH_REFRESH_RESULT_UNKNOWN' : null)
    };
  }

  async start(input: {
    appName: string;
    appKey: string;
    appSecret: string;
    callbackUrl: string;
    passphrase: string;
  }): Promise<void> {
    await this.exclusive(async () => {
      if (this.job) throw failure('AUTH_TASK_ACTIVE');
      const callback = parseCallback(input.callbackUrl);
      const application = {
        appName: required(input.appName),
        appKey: required(input.appKey),
        appSecret: required(input.appSecret),
        callbackUrl: callback.href,
        status: 'user-provided',
        permissions: []
      };
      // Validate the passphrase and application before opening any remote page.
      validateVaultPassphrase(input.passphrase);
      const state = crypto.randomUUID();
      const url = new URL(IOP_AUTHORIZE_ENDPOINT);
      url.search = new URLSearchParams({
        client_id: application.appKey,
        response_type: 'code',
        redirect_uri: callback.href,
        state
      }).toString();
      const tabId = await this.openTab(url.href);
      this.job = {
        application,
        state,
        tabId,
        deadline: this.clock() + 600_000,
        passphrase: input.passphrase
      };
      this.expiryTimer = setTimeout(() => {
        this.endJob();
        this.errorCode = 'AUTH_TASK_EXPIRED';
      }, 600_000);
      this.errorCode = null;
    });
  }

  async acceptCallback(urlText: string, tabId?: number): Promise<boolean> {
    const job = this.job;
    if (!job || this.busy) return false;
    if (job.deadline <= this.clock()) {
      this.endJob();
      this.errorCode = 'AUTH_TASK_EXPIRED';
      throw failure('AUTH_TASK_EXPIRED');
    }
    if (tabId !== undefined && tabId !== job.tabId) return false;
    const actual = new URL(urlText);
    const expected = new URL(job.application.callbackUrl);
    if (
      actual.origin !== expected.origin ||
      actual.pathname !== expected.pathname ||
      actual.username ||
      actual.password
    )
      return false;
    if (actual.searchParams.getAll('state').length !== 1 || actual.searchParams.get('state') !== job.state) {
      this.errorCode = 'OAUTH_STATE_MISMATCH';
      throw failure('OAUTH_STATE_MISMATCH');
    }
    if (actual.searchParams.has('error')) {
      this.endJob();
      this.errorCode = 'OAUTH_PROVIDER_ERROR';
      throw failure('OAUTH_PROVIDER_ERROR');
    }
    const codes = actual.searchParams.getAll('code');
    if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) {
      this.errorCode = 'OAUTH_CODE_MISSING';
      throw failure('OAUTH_CODE_MISSING');
    }
    const code = codes[0];
    await this.exclusive(async () => {
      // Consume once, before the request: navigation events and polling cannot re-exchange a code.
      this.endJob();
      await this.storage.set({
        [IOP_RECEIPT_KEY]: { requestId: crypto.randomUUID(), status: 'exchanging', timeUtc: this.clock() }
      });
      let token: AlibabaTokenResponse;
      try {
        token = await this.client.request('/auth/token/create', {
          appKey: job.application.appKey,
          appSecret: job.application.appSecret,
          value: code,
          requestId: crypto.randomUUID()
        });
      } catch (error) {
        if (error instanceof GatewayException && error.gatewayError.code === 'IOP_TOKEN_REJECTED')
          await this.storage.remove([IOP_RECEIPT_KEY]);
        throw error;
      }
      const bundle = {
        ...createAlibabaOpenApiCredentialBundle({
          capturedAtTimeUtc: this.clock(),
          application: job.application,
          token,
          receivedCallbackUrl: actual.href
        }),
        protocol: 'iop' as const
      };
      this.unlocked = await sealAlibabaAuthorization(bundle, job.passphrase);
      this.pendingSave = true;
      await this.storage.set({ [IOP_VAULT_KEY]: this.unlocked.record, [IOP_RECEIPT_KEY]: null });
      this.pendingSave = false;
      this.errorCode = null;
    });
    return true;
  }

  async unlock(passphrase: string): Promise<void> {
    await this.exclusive(async () => {
      const value = (await this.storage.get(IOP_VAULT_KEY))[IOP_VAULT_KEY];
      this.unlocked = await openAlibabaAuthorization(value, passphrase);
    });
  }

  async import(bundle: unknown, passphrase: string): Promise<void> {
    await this.exclusive(async () => {
      if (this.job) throw failure('AUTH_TASK_ACTIVE');
      const checked = parseAlibabaOpenApiCredentialBundle(bundle);
      if (checked.protocol !== 'iop') throw failure('IOP_REQUIRED');
      const unlocked = await sealAlibabaAuthorization(checked, passphrase);
      await this.storage.set({ [IOP_VAULT_KEY]: unlocked.record, [IOP_RECEIPT_KEY]: null });
      this.unlocked = unlocked;
      this.pendingSave = false;
      this.errorCode = null;
    });
  }

  async refresh(): Promise<void> {
    await this.exclusive(async () => {
      if (this.job) throw failure('AUTH_TASK_ACTIVE');
      const unlocked = this.requireUnlocked();
      const bundle = unlocked.bundle;
      const pending = (await this.storage.get(IOP_RECEIPT_KEY))[IOP_RECEIPT_KEY];
      if (pending !== null && pending !== undefined) throw failure('AUTH_REFRESH_RESULT_UNKNOWN');
      if (
        !bundle.oauth.refreshToken ||
        (bundle.oauth.refreshExpiresAtUtc !== null &&
          Date.parse(bundle.oauth.refreshExpiresAtUtc) <= this.clock())
      )
        throw failure('AUTH_REFRESH_EXPIRED');
      const requestId = crypto.randomUUID();
      // Commit the send intent before out-of-process I/O. Worker termination makes it unknown, never retryable.
      await this.storage.set({ [IOP_RECEIPT_KEY]: { requestId, status: 'sending', timeUtc: this.clock() } });
      try {
        const token = await this.client.request('/auth/token/refresh', {
          appKey: bundle.application.appKey,
          appSecret: bundle.application.appSecret,
          value: bundle.oauth.refreshToken,
          requestId
        });
        const next: AlibabaOpenApiCredentialBundle = {
          ...bundle,
          oauth: {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken ?? bundle.oauth.refreshToken,
            expiresAtUtc: credentialExpiryFromSeconds(this.clock(), token.expiresInSeconds),
            refreshExpiresAtUtc:
              token.refreshExpiresInSeconds === null
                ? bundle.oauth.refreshExpiresAtUtc
                : credentialExpiryFromSeconds(this.clock(), token.refreshExpiresInSeconds)
          }
        };
        const record = await resealAlibabaAuthorization(next, unlocked.key, unlocked.record.salt);
        // Keep rotated tokens in memory even if local storage fails; no second network call is allowed.
        this.unlocked = { ...unlocked, record, bundle: next };
        this.pendingSave = true;
        await this.storage.set({ [IOP_VAULT_KEY]: record, [IOP_RECEIPT_KEY]: null });
        this.pendingSave = false;
        this.errorCode = null;
      } catch (error) {
        if (error instanceof GatewayException && error.gatewayError.code === 'IOP_TOKEN_REJECTED') {
          await this.storage.remove([IOP_RECEIPT_KEY]);
        }
        throw error;
      }
    });
  }

  async export(): Promise<AlibabaOpenApiCredentialBundle> {
    if (this.busy || this.job) throw failure('AUTH_TASK_ACTIVE');
    const status = await this.status();
    if (status.state !== 'ready') throw failure('AUTH_REFRESH_RESULT_UNKNOWN');
    return structuredClone(this.requireUnlocked().bundle);
  }

  async save(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.pendingSave) throw failure('AUTH_INPUT_INVALID');
      await this.storage.set({ [IOP_VAULT_KEY]: this.requireUnlocked().record, [IOP_RECEIPT_KEY]: null });
      this.pendingSave = false;
      this.errorCode = null;
    });
  }
  lock(): void {
    if (this.busy) throw failure('AUTH_TASK_ACTIVE');
    this.unlocked = null;
    this.endJob();
    this.pendingSave = false;
  }
  cancel(): void {
    if (this.busy) throw failure('AUTH_TASK_ACTIVE');
    this.endJob();
  }
  async clear(): Promise<void> {
    await this.exclusive(async () => {
      await this.storage.remove([IOP_VAULT_KEY, IOP_RECEIPT_KEY]);
      this.unlocked = null;
      this.endJob();
      this.errorCode = null;
      this.pendingSave = false;
    });
  }
  private requireUnlocked(): OpenAlibabaAuthorizationVault {
    if (!this.unlocked) throw failure('AUTH_VAULT_LOCKED');
    return this.unlocked;
  }
  private endJob(): void {
    this.job = null;
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }
  private async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.busy) throw failure('AUTH_TASK_ACTIVE');
    this.busy = true;
    try {
      await action();
    } catch (error) {
      this.errorCode =
        error instanceof GatewayException
          ? error.gatewayError.code
          : error instanceof Error && /^[A-Z_]{3,80}$/u.test(error.message)
            ? error.message
            : 'AUTH_ACTION_FAILED';
      throw error instanceof GatewayException ? error : failure(this.errorCode);
    } finally {
      this.busy = false;
    }
  }
}
export function parseCallback(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw failure('CALLBACK_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.hostname === 'localhost' ||
    /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) ||
    url.hostname.includes(':')
  )
    throw failure('CALLBACK_INVALID');
  return url;
}
export function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw failure('AUTH_INPUT_INVALID');
  return value.trim();
}
export function failure(code: string): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}
export { isRecord };
