import { createNodeAlibabaCredentialProvider } from './node-credential-bundle';
import { GatewayConfigurationError } from './credentials';
import type { AlibabaCredentialProvider, AlibabaCredentialStatus } from './credentials';
import type { NodeAlibabaCredentialEnvironment } from './node-credential-bundle';
import type {
  GatewayCredentialService,
  GatewayCredentialRepository,
  StoredAlibabaCredentialProvider,
  GatewayCredentialSummary
} from './credential-vault';
import type { GatewayCredentials } from '@one-vegetable/core';

/** Resolve on each request, never cache an account across configuration changes. */
export class NodeManagedCredentialProvider {
  constructor(
    private readonly repository: GatewayCredentialRepository,
    private readonly stored: StoredAlibabaCredentialProvider,
    private readonly service: GatewayCredentialService,
    private readonly environment: NodeAlibabaCredentialEnvironment
  ) {}

  private legacy(): AlibabaCredentialProvider {
    return createNodeAlibabaCredentialProvider(this.environment);
  }

  async status(): Promise<AlibabaCredentialStatus> {
    if (await this.repository.managed()) return this.stored.status();
    try {
      return this.legacy().status();
    } catch {
      return {
        source: 'credential-bundle',
        configured: false,
        hasAppKey: false,
        hasAppSecret: false,
        hasAccessToken: false,
        endpointOrigin: 'https://eco.taobao.com',
        signMethod: 'hmac-sha256'
      };
    }
  }

  async summary(): Promise<GatewayCredentialSummary> {
    const summary = await this.service.status();
    if (await this.repository.managed()) return summary;
    try {
      const legacy = this.legacy().status();
      return { ...summary, source: legacy.source, configured: legacy.configured, canRefresh: false };
    } catch (error: unknown) {
      return {
        ...summary,
        source: 'credential-bundle',
        configured: false,
        errorCode: error instanceof GatewayConfigurationError ? error.code : 'ALIBABA_CREDENTIAL_FILE_INVALID'
      };
    }
  }

  async requireCredentials(requestId?: string, forceRefresh = false): Promise<GatewayCredentials> {
    if (await this.repository.managed()) return this.stored.requireCredentials(requestId, forceRefresh);
    if (forceRefresh)
      throw new GatewayConfigurationError(
        'ALIBABA_REFRESH_TOKEN_MISSING',
        '请先导入授权包，再在页面刷新 Token'
      );
    return this.legacy().requireCredentials();
  }
}
