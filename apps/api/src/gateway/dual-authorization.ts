import {
  authorizationBindingMatches,
  selectAlibabaOperationProtocol,
  type AlibabaAuthorizationsSummary,
  type AlibabaProtocol,
  type GatewayCredentials,
  type NetworkTransport,
  type OperationId
} from '@one-vegetable/core';
import { galleryGatewayId, type GalleryRequestOptions } from '@one-vegetable/core/gallery-transfer-context';
import type { SqlExecutor } from '../db/sql-executor';
import {
  GatewayCredentialService,
  SqlGatewayCredentialRepository,
  StoredAlibabaCredentialProvider,
  type GatewayCredentialCipher,
  type GatewayCredentialSummary
} from './credential-vault';
import { GatewayConfigurationError, type AsyncAlibabaCredentialProvider } from './credentials';

interface Profile {
  service: GatewayCredentialService;
  provider: AsyncAlibabaCredentialProvider;
  summary(): Promise<GatewayCredentialSummary>;
}

/** Protocol selection is pre-dispatch only. A provider failure never changes the selected profile. */
export class DualAlibabaAuthorization implements AsyncAlibabaCredentialProvider {
  private readonly slots: Record<AlibabaProtocol, Profile & { repository: SqlGatewayCredentialRepository }>;
  constructor(
    private readonly executor: SqlExecutor,
    cipher: GatewayCredentialCipher,
    private readonly primary: Profile,
    options: { source?: 'sqlite-vault' | 'd1-vault'; clock?: () => number; transport?: NetworkTransport } = {}
  ) {
    this.clock = options.clock ?? Date.now;
    const create = (protocol: AlibabaProtocol) => {
      const repository = new SqlGatewayCredentialRepository(executor, protocol);
      const service = new GatewayCredentialService(repository, cipher, this.clock, options.source);
      const provider = new StoredAlibabaCredentialProvider(repository, cipher, options);
      return { repository, service, provider, summary: () => service.status() };
    };
    this.slots = { top: create('top'), iop: create('iop') };
  }
  private readonly clock: () => number;

  private async profile(protocol: AlibabaProtocol): Promise<Profile> {
    if (await this.slots[protocol].repository.managed()) return this.slots[protocol];
    const primary = await this.primary.summary();
    return primary.configured && (primary.protocol ?? 'top') === protocol
      ? this.primary
      : this.slots[protocol];
  }

  async authorizations(): Promise<AlibabaAuthorizationsSummary> {
    const [top, iop, primary] = await Promise.all([
      this.profile('top').then((profile) => profile.summary()),
      this.profile('iop').then((profile) => profile.summary()),
      this.primary.summary()
    ]);
    const rows = await this.executor.query('SELECT * FROM alibaba_authorization_binding WHERE id = ?', [
      'primary'
    ]);
    const row = rows[0];
    const binding =
      row &&
      typeof row.top_configuration_id === 'string' &&
      typeof row.iop_configuration_id === 'string' &&
      typeof row.confirmed_time_utc === 'number'
        ? {
            topConfigurationId: row.top_configuration_id,
            iopConfigurationId: row.iop_configuration_id,
            confirmedAtUtc: row.confirmed_time_utc
          }
        : null;
    const ids = {
      top: top.configured ? (top.configurationId ?? null) : null,
      iop: iop.configured ? (iop.configurationId ?? null) : null
    };
    const preferred = primary.protocol ?? 'top';
    const defaultProtocol = (preferred === 'top' ? top : iop).configured
      ? preferred
      : top.configured
        ? 'top'
        : iop.configured
          ? 'iop'
          : preferred;
    return {
      top: top.configured ? top : null,
      iop: iop.configured ? iop : null,
      defaultProtocol,
      binding: {
        confirmed: authorizationBindingMatches(binding, ids),
        topConfigurationId: ids.top,
        iopConfigurationId: ids.iop,
        confirmedAtUtc: authorizationBindingMatches(binding, ids) ? (binding?.confirmedAtUtc ?? null) : null
      }
    };
  }

  async confirm(
    topConfigurationId: string,
    iopConfigurationId: string,
    actorId: string
  ): Promise<AlibabaAuthorizationsSummary> {
    const current = await this.authorizations();
    if (
      !current.top ||
      !current.iop ||
      current.binding.topConfigurationId !== topConfigurationId ||
      current.binding.iopConfigurationId !== iopConfigurationId
    )
      throw new GatewayConfigurationError(
        'ALIBABA_AUTHORIZATION_BINDING_CHANGED',
        '授权配置已变化，请重新检查后确认'
      );
    await this.executor.execute(
      `INSERT INTO alibaba_authorization_binding VALUES ('primary', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET top_configuration_id = excluded.top_configuration_id,
       iop_configuration_id = excluded.iop_configuration_id, confirmed_time_utc = excluded.confirmed_time_utc, actor_id = excluded.actor_id`,
      [topConfigurationId, iopConfigurationId, this.clock(), actorId]
    );
    const result = await this.authorizations();
    if (!result.binding.confirmed)
      throw new GatewayConfigurationError(
        'ALIBABA_AUTHORIZATION_BINDING_CHANGED',
        '授权配置已变化，请重新确认'
      );
    return result;
  }

  /** Legacy management calls stay compatible while a single authorization exists. */
  private async managementProtocol(protocol?: AlibabaProtocol): Promise<AlibabaProtocol> {
    if (protocol) return protocol;
    const current = await this.authorizations();
    if (current.top && current.iop)
      throw new GatewayConfigurationError(
        'ALIBABA_PROTOCOL_SELECTION_REQUIRED',
        '请明确选择要管理的 TOP 或 IOP 授权'
      );
    return current.defaultProtocol;
  }
  async service(protocol?: AlibabaProtocol): Promise<GatewayCredentialService> {
    // Preserve an old primary row and its revision, including an empty legacy installation.
    if (!protocol && !(await this.authorizations()).top && !(await this.authorizations()).iop)
      return this.primary.service;
    return (await this.profile(await this.managementProtocol(protocol))).service;
  }
  async summary(protocol?: AlibabaProtocol): Promise<GatewayCredentialSummary> {
    return (await this.profile(await this.managementProtocol(protocol))).summary();
  }
  async managementProvider(protocol?: AlibabaProtocol): Promise<AsyncAlibabaCredentialProvider> {
    return (await this.profile(await this.managementProtocol(protocol))).provider;
  }
  async defaultSummary(): Promise<GatewayCredentialSummary> {
    return (await this.profile((await this.authorizations()).defaultProtocol)).summary();
  }
  async status() {
    return (await this.profile((await this.authorizations()).defaultProtocol)).provider.status();
  }
  async requireCredentials(requestId?: string, forceRefresh = false): Promise<GatewayCredentials> {
    return (await this.profile((await this.authorizations()).defaultProtocol)).provider.requireCredentials(
      requestId,
      forceRefresh
    );
  }
  async selectProtocol(
    operation: OperationId,
    payload: unknown,
    context?: GalleryRequestOptions
  ): Promise<AlibabaProtocol> {
    const expected = context?.productContext?.gateway ?? context?.galleryContext?.gateway;
    if (expected) {
      for (const protocol of ['top', 'iop'] as const) {
        const profile = await this.profile(protocol);
        // This snapshot must not refresh or consume an unselected refresh token.
        const credentials = await profile.provider.credentialSnapshot?.();
        if (credentials && (await galleryGatewayId(credentials)) === expected) return protocol;
      }
      throw new GatewayConfigurationError(
        context?.productContext ? 'PRODUCT_CONTEXT_CHANGED' : 'GALLERY_CONTEXT_CHANGED',
        '授权配置已变化，请重新预览'
      );
    }
    const current = await this.authorizations();
    return selectAlibabaOperationProtocol(operation, payload, {
      top: current.top !== null,
      iop: current.iop !== null,
      defaultProtocol: current.defaultProtocol,
      bindingConfirmed: current.binding.confirmed
    });
  }
  async resolveForOperation(
    operation: OperationId,
    payload: unknown,
    context?: GalleryRequestOptions & { requestId?: string }
  ): Promise<GatewayCredentials> {
    const protocol = await this.selectProtocol(operation, payload, context);
    const credentials = await (await this.profile(protocol)).provider.requireCredentials(context?.requestId);
    const expected = context?.productContext?.gateway ?? context?.galleryContext?.gateway;
    if (expected && (await galleryGatewayId(credentials)) !== expected)
      throw new GatewayConfigurationError(
        context?.productContext ? 'PRODUCT_CONTEXT_CHANGED' : 'GALLERY_CONTEXT_CHANGED',
        '授权配置已变化，请重新预览'
      );
    if ((credentials.protocol ?? 'top') !== protocol)
      throw new GatewayConfigurationError('ALIBABA_PROTOCOL_ENDPOINT_MISMATCH', '授权协议与所选网关不一致');
    return credentials;
  }
}
