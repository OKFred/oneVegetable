import {
  evaluateMetaDestinationPermission,
  META_GRAPH_API_VERSION,
  META_GRAPH_ORIGIN,
  META_OAUTH_ORIGIN,
  META_REQUIRED_SCOPES,
  NetworkManager,
  normalizeMetaPublicOrigin,
  normalizeRemark
} from '@one-vegetable/core';

import { MetaEntityVersionConflictError, summarizeMetaConfiguration } from './repository';

import type {
  MetaAppConfigurationSummary,
  NetworkTransport,
  SocialAccountConnection,
  SocialDestination
} from '@one-vegetable/core';
import type { MetaAppConfigurationRecord, MetaSocialRepository, SocialDestinationRecord } from './repository';
import type { MetaSecretCipher } from './secret-cipher';

const OAUTH_STATE_TTL_MILLISECONDS = 10 * 60_000;

interface MetaTokenResponse {
  accessToken: string;
  expiresInSeconds: number | null;
}

interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
  instagramAccountId: string | null;
}

export interface MetaPublishingDestination {
  destination: SocialDestinationRecord;
  accessToken: string;
  graphApiVersion: string;
  publicOrigin: string;
  apiPrefix: string;
}

export class MetaSocialServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'MetaSocialServiceError';
  }
}

export class MetaSocialService {
  readonly #network: NetworkManager;

  constructor(
    private readonly repository: MetaSocialRepository,
    private readonly cipher: MetaSecretCipher,
    options: {
      transport?: NetworkTransport;
      clock?: () => number;
      apiPrefix?: string;
    } = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.apiPrefix = options.apiPrefix ?? '/api/v1';
    this.#network = new NetworkManager({
      ...(options.transport ? { transport: options.transport } : {}),
      policies: {
        meta: {
          allowedOrigins: [META_GRAPH_ORIGIN],
          timeoutMilliseconds: 30_000,
          maxRequestBytes: 64 * 1024,
          maxResponseBytes: 4 * 1024 * 1024,
          redirect: 'error'
        }
      }
    });
  }

  private readonly clock: () => number;
  private readonly apiPrefix: string;

  async configuration(): Promise<MetaAppConfigurationSummary> {
    const record = await this.repository.findConfiguration();
    return summarizeMetaConfiguration(record, record ? callbackUrl(record, this.apiPrefix) : null);
  }

  async configure(input: {
    appId: string;
    appSecret: string;
    publicOrigin: string;
    expectedRevision: number | null;
    actorId: string;
    remark: string | null;
  }): Promise<MetaAppConfigurationSummary> {
    const appId = normalizeAppId(input.appId);
    const appSecret = normalizeSecret(input.appSecret);
    const publicOrigin = normalizeMetaPublicOrigin(input.publicOrigin);
    const current = await this.repository.findConfiguration();
    if (
      (current === null && input.expectedRevision !== null) ||
      (current !== null && current.revision !== input.expectedRevision)
    ) {
      throw new MetaEntityVersionConflictError();
    }
    if (
      current &&
      (current.appId !== appId || current.publicOrigin !== publicOrigin) &&
      (await this.repository.countConnections()) > 0
    ) {
      throw new MetaSocialServiceError(
        'META_CONNECTIONS_MUST_BE_DISCONNECTED',
        '修改 App ID 或公开 Origin 前请先断开现有 Meta 连接',
        409
      );
    }
    const encrypted = await this.cipher.encrypt('app-secret', 'primary', appSecret);
    const saved = await this.repository.saveConfiguration({
      appId,
      encryptedAppSecret: encrypted.ciphertext,
      initializationVector: encrypted.initializationVector,
      graphApiVersion: META_GRAPH_API_VERSION,
      publicOrigin,
      actorId: input.actorId,
      expectedRevision: input.expectedRevision,
      remark: normalizeRemark(input.remark),
      now: this.clock()
    });
    return summarizeMetaConfiguration(saved, callbackUrl(saved, this.apiPrefix));
  }

  async clearConfiguration(expectedRevision: number): Promise<void> {
    if ((await this.repository.countConnections()) > 0) {
      throw new MetaSocialServiceError(
        'META_CONNECTIONS_MUST_BE_DISCONNECTED',
        '清除 Meta 应用配置前请先断开现有连接',
        409
      );
    }
    if (!(await this.repository.deleteConfiguration(expectedRevision))) {
      throw new MetaEntityVersionConflictError();
    }
  }

  async startOAuth(input: {
    actorId: string;
  }): Promise<{ authorizationUrl: string; expiresTimeUtc: number }> {
    const configuration = await this.requireConfiguration();
    const state = randomToken(32);
    const now = this.clock();
    const expiresTimeUtc = now + OAUTH_STATE_TTL_MILLISECONDS;
    await this.repository.createOAuthState({
      id: crypto.randomUUID(),
      stateHash: await sha256(state),
      actorId: input.actorId,
      callbackUrl: callbackUrl(configuration, this.apiPrefix),
      expiresTimeUtc,
      consumedTimeUtc: null,
      createTimeUtc: now
    });
    const url = new URL(`/${configuration.graphApiVersion}/dialog/oauth`, META_OAUTH_ORIGIN);
    url.searchParams.set('client_id', configuration.appId);
    url.searchParams.set('redirect_uri', callbackUrl(configuration, this.apiPrefix));
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', META_REQUIRED_SCOPES.join(','));
    return { authorizationUrl: url.href, expiresTimeUtc };
  }

  async completeOAuth(input: {
    state: string;
    code: string;
    requestId: string;
  }): Promise<{ actorId: string; connection: SocialAccountConnection; destinations: SocialDestination[] }> {
    const state = input.state.trim();
    const code = input.code.trim();
    if (!state || state.length > 512 || !code || code.length > 4096) {
      throw new MetaSocialServiceError('META_OAUTH_CALLBACK_INVALID', 'Meta OAuth Callback 无效', 400);
    }
    const consumed = await this.repository.consumeOAuthState(await sha256(state), this.clock());
    if (!consumed) {
      throw new MetaSocialServiceError('META_OAUTH_STATE_INVALID', 'Meta OAuth state 无效或已过期', 400);
    }
    const configuration = await this.requireConfiguration();
    if (callbackUrl(configuration, this.apiPrefix) !== consumed.callbackUrl) {
      throw new MetaSocialServiceError('META_OAUTH_CALLBACK_MISMATCH', 'Meta OAuth Callback 已变更', 409);
    }
    const appSecret = await this.cipher.decrypt('app-secret', 'primary', {
      ciphertext: configuration.encryptedAppSecret,
      initializationVector: configuration.initializationVector,
      keyVersion: configuration.keyVersion
    });
    const shortLived = await this.exchangeAuthorizationCode(configuration, appSecret, code, input.requestId);
    const longLived = await this.exchangeLongLivedToken(
      configuration,
      appSecret,
      shortLived.accessToken,
      input.requestId
    );
    const account = await this.readAccount(configuration, longLived.accessToken, input.requestId);
    const grantedScopes = await this.readGrantedScopes(configuration, longLived.accessToken, input.requestId);
    const pages = await this.readPages(configuration, longLived.accessToken, input.requestId);
    const current = await this.repository.findConnectionByExternalId(account.id);
    const connectionId = current?.id ?? crypto.randomUUID();
    const encryptedUserToken = await this.cipher.encrypt('user-token', connectionId, longLived.accessToken);
    const expiresTimeUtc =
      longLived.expiresInSeconds === null ? null : this.clock() + longLived.expiresInSeconds * 1000;
    const stored = await this.repository.saveConnection({
      id: connectionId,
      accountExternalId: account.id,
      accountName: account.name,
      encryptedUserToken: encryptedUserToken.ciphertext,
      initializationVector: encryptedUserToken.initializationVector,
      grantedScopes,
      tokenExpiresTimeUtc: expiresTimeUtc,
      actorId: consumed.actorId,
      now: this.clock()
    });
    const destinationIds: string[] = [];
    for (const page of pages) {
      destinationIds.push(
        await this.saveDiscoveredDestination({
          connectionId: stored.id,
          platform: 'facebook',
          externalId: page.id,
          name: page.name,
          page,
          grantedScopes
        })
      );
      if (page.instagramAccountId) {
        const profile = await this.readInstagramProfile(
          configuration,
          page.instagramAccountId,
          page.accessToken,
          input.requestId
        );
        destinationIds.push(
          await this.saveDiscoveredDestination({
            connectionId: stored.id,
            platform: 'instagram',
            externalId: page.instagramAccountId,
            name: profile.name,
            page,
            grantedScopes
          })
        );
      }
    }
    await this.repository.removeConnectionDestinationsExcept(stored.id, destinationIds);
    const connections = await this.repository.listConnections(this.clock());
    const connection = connections.find((candidate) => candidate.id === stored.id);
    if (!connection) throw new Error('Meta 连接完成后无法读取');
    const destinations = (await this.repository.listDestinations()).filter(
      (destination) => destination.connectionId === stored.id
    );
    return { actorId: consumed.actorId, connection, destinations };
  }

  listConnections(): Promise<SocialAccountConnection[]> {
    return this.repository.listConnections(this.clock());
  }

  listDestinations(): Promise<SocialDestination[]> {
    return this.repository.listDestinations();
  }

  async disconnect(input: {
    connectionId: string;
    expectedRevision: number;
    actorId: string;
  }): Promise<void> {
    if (
      !(await this.repository.disconnectConnection(
        input.connectionId,
        input.expectedRevision,
        input.actorId,
        this.clock()
      ))
    ) {
      throw new MetaEntityVersionConflictError();
    }
  }

  async requireDestinationToken(destination: SocialDestinationRecord): Promise<string> {
    return this.cipher.decrypt('destination-token', destination.id, {
      ciphertext: destination.encryptedAccessToken,
      initializationVector: destination.initializationVector,
      keyVersion: 1
    });
  }

  async resolvePublishingDestination(destinationId: string): Promise<MetaPublishingDestination> {
    const [configuration, destination] = await Promise.all([
      this.requireConfiguration(),
      this.repository.findDestination(destinationId)
    ]);
    if (!destination?.canPublish) {
      throw new MetaSocialServiceError(
        destination?.unavailableReasonCode ?? 'META_DESTINATION_NOT_AVAILABLE',
        '发布目标不存在或当前没有发布权限',
        403
      );
    }
    const connection = await this.repository.findConnection(destination.connectionId);
    if (connection?.status !== 'connected') {
      throw new MetaSocialServiceError('META_CONNECTION_RECONNECT_REQUIRED', 'Meta 账号需要重新连接', 409);
    }
    if (connection.tokenExpiresTimeUtc !== null && connection.tokenExpiresTimeUtc <= this.clock()) {
      await this.repository.markConnectionReconnectRequired(connection.id, this.clock());
      throw new MetaSocialServiceError(
        'META_CONNECTION_RECONNECT_REQUIRED',
        'Meta 账号令牌已过期，请重新连接',
        409
      );
    }
    return {
      destination,
      accessToken: await this.requireDestinationToken(destination),
      graphApiVersion: configuration.graphApiVersion,
      publicOrigin: configuration.publicOrigin,
      apiPrefix: this.apiPrefix
    };
  }

  markConnectionReconnectRequired(connectionId: string): Promise<void> {
    return this.repository.markConnectionReconnectRequired(connectionId, this.clock());
  }

  private async saveDiscoveredDestination(input: {
    connectionId: string;
    platform: SocialDestination['platform'];
    externalId: string;
    name: string;
    page: MetaPage;
    grantedScopes: string[];
  }): Promise<string> {
    const current = await this.repository.findDestinationByExternalId(input.platform, input.externalId);
    const id = current?.id ?? crypto.randomUUID();
    const encrypted = await this.cipher.encrypt('destination-token', id, input.page.accessToken);
    const decision = evaluateMetaDestinationPermission({
      platform: input.platform,
      grantedScopes: input.grantedScopes,
      pageTasks: input.page.tasks,
      ...(input.platform === 'instagram' ? { hasLinkedInstagramAccount: true } : {})
    });
    const destination = await this.repository.saveDestination({
      id,
      connectionId: input.connectionId,
      platform: input.platform,
      externalId: input.externalId,
      name: input.name,
      pageExternalId: input.page.id,
      pageName: input.page.name,
      encryptedAccessToken: encrypted.ciphertext,
      initializationVector: encrypted.initializationVector,
      tasks: input.page.tasks,
      canPublish: decision.allowed,
      unavailableReasonCode: decision.reasonCode,
      now: this.clock()
    });
    return destination.id;
  }

  private async exchangeAuthorizationCode(
    configuration: MetaAppConfigurationRecord,
    appSecret: string,
    code: string,
    requestId: string
  ): Promise<MetaTokenResponse> {
    return this.readToken(
      configuration,
      '/oauth/access_token',
      {
        client_id: configuration.appId,
        client_secret: appSecret,
        redirect_uri: callbackUrl(configuration, this.apiPrefix),
        code
      },
      requestId
    );
  }

  private async exchangeLongLivedToken(
    configuration: MetaAppConfigurationRecord,
    appSecret: string,
    accessToken: string,
    requestId: string
  ): Promise<MetaTokenResponse> {
    return this.readToken(
      configuration,
      '/oauth/access_token',
      {
        grant_type: 'fb_exchange_token',
        client_id: configuration.appId,
        client_secret: appSecret,
        fb_exchange_token: accessToken
      },
      requestId
    );
  }

  private async readToken(
    configuration: MetaAppConfigurationRecord,
    path: string,
    parameters: Record<string, string>,
    requestId: string
  ): Promise<MetaTokenResponse> {
    const data = await this.graphRequest(configuration, path, parameters, requestId);
    return {
      accessToken: requiredString(data, 'access_token'),
      expiresInSeconds: optionalPositiveInteger(data.expires_in)
    };
  }

  private async readAccount(
    configuration: MetaAppConfigurationRecord,
    accessToken: string,
    requestId: string
  ): Promise<{ id: string; name: string }> {
    const data = await this.graphRequest(
      configuration,
      '/me',
      { fields: 'id,name', access_token: accessToken },
      requestId
    );
    return { id: requiredString(data, 'id'), name: requiredString(data, 'name') };
  }

  private async readGrantedScopes(
    configuration: MetaAppConfigurationRecord,
    accessToken: string,
    requestId: string
  ): Promise<string[]> {
    const result = await this.graphRequest(
      configuration,
      '/me/permissions',
      { access_token: accessToken },
      requestId
    );
    return requiredRecordArray(result, 'data')
      .filter((item) => item.status === 'granted')
      .map((item) => requiredString(item, 'permission'));
  }

  private async readPages(
    configuration: MetaAppConfigurationRecord,
    accessToken: string,
    requestId: string
  ): Promise<MetaPage[]> {
    const result = await this.graphRequest(
      configuration,
      '/me/accounts',
      {
        fields: 'id,name,access_token,tasks,instagram_business_account',
        limit: '100',
        access_token: accessToken
      },
      requestId
    );
    return requiredRecordArray(result, 'data').map((page) => ({
      id: requiredString(page, 'id'),
      name: requiredString(page, 'name'),
      accessToken: requiredString(page, 'access_token'),
      tasks: requiredStringArray(page, 'tasks'),
      instagramAccountId: optionalNestedId(page.instagram_business_account)
    }));
  }

  private async readInstagramProfile(
    configuration: MetaAppConfigurationRecord,
    instagramAccountId: string,
    accessToken: string,
    requestId: string
  ): Promise<{ name: string }> {
    const result = await this.graphRequest(
      configuration,
      `/${encodeURIComponent(instagramAccountId)}`,
      { fields: 'id,username,name', access_token: accessToken },
      requestId
    );
    return {
      name:
        optionalString(result.username) ?? optionalString(result.name) ?? `Instagram ${instagramAccountId}`
    };
  }

  private async graphRequest(
    configuration: MetaAppConfigurationRecord,
    path: string,
    parameters: Record<string, string>,
    requestId: string
  ): Promise<Record<string, unknown>> {
    const url = new URL(`/${configuration.graphApiVersion}${path}`, META_GRAPH_ORIGIN);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    const response = await this.#network.request({
      service: 'meta',
      url,
      requestId,
      method: 'GET',
      responseType: 'json',
      maxAttempts: 1
    });
    const data = asRecord(response.data);
    const graphError = isRecord(data.error) ? data.error : null;
    if (!response.ok || graphError !== null) {
      const code = optionalInteger(graphError?.code);
      const subcode = optionalInteger(graphError?.error_subcode);
      throw new MetaSocialServiceError(
        `META_GRAPH_${code ?? response.status}${subcode === null ? '' : `_${subcode}`}`,
        'Meta 请求失败，请检查应用配置、权限或重新连接',
        code === 190 ? 401 : 502,
        response.status >= 500
      );
    }
    return data;
  }

  private async requireConfiguration(): Promise<MetaAppConfigurationRecord> {
    const configuration = await this.repository.findConfiguration();
    if (!configuration) {
      throw new MetaSocialServiceError('META_APP_NOT_CONFIGURED', '请先配置 Meta 应用', 503);
    }
    return configuration;
  }
}

function callbackUrl(configuration: MetaAppConfigurationRecord, apiPrefix: string): string {
  return `${configuration.publicOrigin}${apiPrefix}/social/meta/oauth/callback`;
}

function normalizeAppId(value: string): string {
  const appId = value.trim();
  if (!/^\d{5,32}$/u.test(appId)) throw new MetaSocialServiceError('META_APP_ID_INVALID', 'App ID 无效', 400);
  return appId;
}

function normalizeSecret(value: string): string {
  const secret = value.trim();
  if (!secret || secret.length > 512) {
    throw new MetaSocialServiceError('META_APP_SECRET_INVALID', 'App Secret 无效', 400);
  }
  return secret;
}

function randomToken(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) {
    throw new MetaSocialServiceError('META_RESPONSE_INVALID', `Meta 响应缺少 ${key}`, 502);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredRecordArray(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new MetaSocialServiceError('META_RESPONSE_INVALID', `Meta 响应缺少 ${key}`, 502);
  }
  return value.map(asRecord);
}

function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return [];
  return value;
}

function optionalNestedId(value: unknown): string | null {
  return optionalString(asRecord(value).id);
}

function optionalInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function optionalPositiveInteger(value: unknown): number | null {
  const number = optionalInteger(value);
  return number !== null && number > 0 ? number : null;
}
