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

import { IOP_VAULT_KEY, IOP_RECEIPT_KEY, TOP_VAULT_KEY, TOP_RECEIPT_KEY } from './iop-authorization-storage';
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
  canReauthorize: boolean;
  canSave: boolean;
  errorCode: string | null;
  callbackUrl: string | null;
}
export interface AuthorizationTokenClient {
  request(
    path: '/auth/token/create' | '/auth/token/refresh',
    input: {
      appKey: string;
      appSecret: string;
      value: string;
      requestId: string;
      redirectUri?: string;
    }
  ): Promise<AlibabaTokenResponse>;
}
interface AuthorizationJob {
  application: AlibabaOpenApiCredentialBundle['application'];
  state: string;
  tabId: number;
  deadline: number;
  protection: { passphrase: string } | { vault: OpenAlibabaAuthorizationVault };
}

/** Protocol is explicit; no website passwords, automatic approval or cross-protocol fallback. */
export class IopAuthorizationController {
  private unlocked: OpenAlibabaAuthorizationVault | null = null;
  private job: AuthorizationJob | null = null;
  private busy = false;
  private errorCode: string | null = null;
  private pendingSave = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: AuthorizationStorage,
    private readonly client: AuthorizationTokenClient,
    private readonly openTab: (url: string) => Promise<number>,
    private readonly clock: () => number = Date.now,
    private readonly protocol: 'iop' | 'top' = 'iop'
  ) {}

  private get vaultKey(): string {
    return this.protocol === 'iop' ? IOP_VAULT_KEY : TOP_VAULT_KEY;
  }
  private get receiptKey(): string {
    return this.protocol === 'iop' ? IOP_RECEIPT_KEY : TOP_RECEIPT_KEY;
  }

  async status(): Promise<IopAuthorizationSummary> {
    if (this.job && this.job.deadline <= this.clock()) {
      this.endJob();
      this.errorCode = 'AUTH_TASK_EXPIRED';
    }
    const receipt = (await this.storage.get(this.receiptKey))[this.receiptKey];
    const pending = receipt !== null && receipt !== undefined;
    const exists = (await this.storage.get(this.vaultKey))[this.vaultKey] !== undefined;
    if (!exists && !this.pendingSave) this.unlocked = null;
    const bundle = this.unlocked?.bundle;
    return {
      state: this.busy
        ? 'busy'
        : this.job
          ? 'waiting'
          : !this.unlocked && exists
            ? 'locked'
            : pending
              ? 'unknown'
              : this.unlocked
                ? 'ready'
                : 'empty',
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
      canReauthorize: !!this.unlocked && !this.busy && !this.job,
      errorCode: this.errorCode ?? (pending ? 'AUTH_REFRESH_RESULT_UNKNOWN' : null),
      callbackUrl: bundle?.application.callbackUrl ?? null
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
      if (input.passphrase === '' && this.unlocked) {
        await this.beginJob(application, { vault: this.unlocked });
      } else {
        validateVaultPassphrase(input.passphrase);
        await this.beginJob(application, { passphrase: input.passphrase });
      }
    });
  }

  async reauthorize(): Promise<void> {
    await this.exclusive(async () => {
      if (this.job) throw failure('AUTH_TASK_ACTIVE');
      const vault = this.requireUnlocked();
      // A fresh OAuth code is not a retry of an uncertain token refresh. Retain
      // its receipt until a newly authorized bundle has been safely persisted.
      await this.beginJob(vault.bundle.application, { vault });
    });
  }

  private async beginJob(
    application: AlibabaOpenApiCredentialBundle['application'],
    protection: AuthorizationJob['protection']
  ): Promise<void> {
    const callback = parseCallback(application.callbackUrl);
    const state = crypto.randomUUID();
    const url = new URL(
      this.protocol === 'iop' ? IOP_AUTHORIZE_ENDPOINT : 'https://oauth.alibaba.com/authorize'
    );
    url.search = new URLSearchParams({
      client_id: application.appKey,
      response_type: 'code',
      redirect_uri: callback.href,
      state
    }).toString();
    if (this.protocol === 'top') {
      url.searchParams.set('view', 'web');
      url.searchParams.set('sp', 'ICBU');
    }
    const tabId = await this.openTab(url.href);
    this.job = { application, protection, state, tabId, deadline: this.clock() + 600_000 };
    this.expiryTimer = setTimeout(() => {
      this.endJob();
      this.errorCode = 'AUTH_TASK_EXPIRED';
    }, 600_000);
    this.errorCode = null;
  }

  callbackUrl(): string {
    return this.requireUnlocked().bundle.application.callbackUrl;
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
      const previousReceipt = (await this.storage.get(this.receiptKey))[this.receiptKey];
      await this.storage.set({
        [this.receiptKey]: { requestId: crypto.randomUUID(), status: 'exchanging', timeUtc: this.clock() }
      });
      let token: AlibabaTokenResponse;
      try {
        token = await this.client.request('/auth/token/create', {
          appKey: job.application.appKey,
          appSecret: job.application.appSecret,
          value: code,
          requestId: crypto.randomUUID(),
          redirectUri: job.application.callbackUrl
        });
      } catch (error) {
        if (isDefiniteRejection(error)) {
          if (previousReceipt !== null && previousReceipt !== undefined)
            await this.storage.set({ [this.receiptKey]: previousReceipt });
          else await this.storage.remove([this.receiptKey]);
        }
        throw error;
      }
      const bundle = {
        ...createAlibabaOpenApiCredentialBundle({
          capturedAtTimeUtc: this.clock(),
          application: job.application,
          token,
          receivedCallbackUrl: actual.href
        }),
        protocol: this.protocol
      };
      this.unlocked =
        'passphrase' in job.protection
          ? await sealAlibabaAuthorization(bundle, job.protection.passphrase, this.protocol)
          : {
              ...job.protection.vault,
              bundle,
              record: await resealAlibabaAuthorization(
                bundle,
                job.protection.vault.key,
                job.protection.vault.record.salt,
                this.protocol
              )
            };
      this.pendingSave = true;
      await this.storage.set({ [this.vaultKey]: this.unlocked.record, [this.receiptKey]: null });
      this.pendingSave = false;
      this.errorCode = null;
    });
    return true;
  }

  async unlock(passphrase: string): Promise<void> {
    await this.exclusive(async () => {
      const value = (await this.storage.get(this.vaultKey))[this.vaultKey];
      this.unlocked = await openAlibabaAuthorization(value, passphrase, this.protocol);
    });
  }

  async import(bundle: unknown, passphrase: string): Promise<void> {
    await this.exclusive(async () => {
      if (this.job) throw failure('AUTH_TASK_ACTIVE');
      const checked = parseAlibabaOpenApiCredentialBundle(bundle);
      if ((checked.protocol ?? 'top') !== this.protocol)
        throw failure(this.protocol === 'iop' ? 'IOP_REQUIRED' : 'TOP_REQUIRED');
      const unlocked = await sealAlibabaAuthorization(
        { ...checked, protocol: this.protocol },
        passphrase,
        this.protocol
      );
      await this.storage.set({ [this.vaultKey]: unlocked.record, [this.receiptKey]: null });
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
      const pending = (await this.storage.get(this.receiptKey))[this.receiptKey];
      if (pending !== null && pending !== undefined) throw failure('AUTH_REFRESH_RESULT_UNKNOWN');
      if (
        !bundle.oauth.refreshToken ||
        (bundle.oauth.refreshExpiresAtUtc !== null &&
          Date.parse(bundle.oauth.refreshExpiresAtUtc) <= this.clock())
      )
        throw failure('AUTH_REFRESH_EXPIRED');
      const requestId = crypto.randomUUID();
      // Commit the send intent before out-of-process I/O. Worker termination makes it unknown, never retryable.
      await this.storage.set({ [this.receiptKey]: { requestId, status: 'sending', timeUtc: this.clock() } });
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
        const record = await resealAlibabaAuthorization(
          next,
          unlocked.key,
          unlocked.record.salt,
          this.protocol
        );
        // Keep rotated tokens in memory even if local storage fails; no second network call is allowed.
        this.unlocked = { ...unlocked, record, bundle: next };
        this.pendingSave = true;
        await this.storage.set({ [this.vaultKey]: record, [this.receiptKey]: null });
        this.pendingSave = false;
        this.errorCode = null;
      } catch (error) {
        if (isDefiniteRejection(error)) {
          await this.storage.remove([this.receiptKey]);
        }
        throw error;
      }
    });
  }

  async export(): Promise<AlibabaOpenApiCredentialBundle> {
    if (this.busy || this.job) throw failure('AUTH_TASK_ACTIVE');
    const status = await this.status();
    if (status.state === 'locked' || status.state === 'empty') throw failure('AUTH_VAULT_LOCKED');
    if (status.state !== 'ready') throw failure('AUTH_REFRESH_RESULT_UNKNOWN');
    return structuredClone(this.requireUnlocked().bundle);
  }

  async save(): Promise<void> {
    await this.exclusive(async () => {
      if (!this.pendingSave) throw failure('AUTH_INPUT_INVALID');
      await this.storage.set({ [this.vaultKey]: this.requireUnlocked().record, [this.receiptKey]: null });
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
      await this.storage.remove([this.vaultKey, this.receiptKey]);
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
function isDefiniteRejection(error: unknown): boolean {
  return (
    error instanceof GatewayException &&
    ['IOP_TOKEN_REJECTED', 'TOP_TOKEN_REJECTED'].includes(error.gatewayError.code)
  );
}
export { isRecord };
