import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseEnv } from 'node:util';
import type { AsyncAlibabaCredentialProvider } from '../../apps/api/src/gateway/credentials';
import type { SqlExecutor } from '../../apps/api/src/db/sql-executor';

/** Same priority as run-real-api/NodeManagedCredentialProvider, but physically read-only.
 * Never initializes a DB, migrates, generates a key, writes refresh leases or sends OAuth traffic.
 * A managed/cleared vault must not fall back to an obsolete legacy authorization bundle.
 */
export async function inspectRealCredentials(
  root: string,
  explicitFile?: string
): Promise<{
  provider: AsyncAlibabaCredentialProvider;
  close: () => void;
}> {
  const envPath = resolve(root, '.env');
  const env = { ...(existsSync(envPath) ? parseEnv(await readFile(envPath, 'utf8')) : {}), ...process.env };
  const credentialFile = resolve(
    root,
    explicitFile ??
      env.ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE ??
      env.OPEN_API_OUTPUT ??
      'artifacts/openapi-auth/credentials.json'
  );
  const environment = { ...env, ONE_VEGETABLE_ALIBABA_CREDENTIAL_FILE: credentialFile };
  const { createNodeAlibabaCredentialProvider } =
    await import('../../apps/api/src/gateway/node-credential-bundle');
  const dbPath = resolve(root, 'apps/api', env.ONE_VEGETABLE_SQLITE_PATH ?? '.data/one-vegetable.sqlite');
  if (existsSync(dbPath)) {
    const connection = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const hasControl = connection
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='alibaba_gateway_credential_control'"
        )
        .get();
      if (hasControl) {
        const executor: SqlExecutor = {
          query: (sql, parameters = []) => Promise.resolve(connection.prepare(sql).all(...parameters)),
          execute: () => Promise.reject(new Error('READ_ONLY_CREDENTIAL_PREFLIGHT_NO_REFRESH_LEASE'))
        };
        const {
          SqlGatewayCredentialRepository,
          GatewayCredentialCipher,
          GatewayCredentialService,
          StoredAlibabaCredentialProvider
        } = await import('../../apps/api/src/gateway/credential-vault');
        const repository = new SqlGatewayCredentialRepository(executor);
        if (await repository.managed()) {
          const key =
            env.ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY ??
            (await readFile(resolve(root, '.data/local-credential-encryption-key'), 'utf8')).trim();
          const cipher = await GatewayCredentialCipher.create(key);
          const stored = new StoredAlibabaCredentialProvider(repository, cipher, {
            source: 'sqlite-vault',
            transport: {
              send: () => Promise.reject(new Error('CREDENTIAL_REFRESH_NETWORK_DISABLED'))
            },
            ...(env.ONE_VEGETABLE_ALIBABA_SIGN_METHOD
              ? { signMethod: env.ONE_VEGETABLE_ALIBABA_SIGN_METHOD }
              : {}),
            ...(env.ONE_VEGETABLE_ALIBABA_ENDPOINT ? { endpoint: env.ONE_VEGETABLE_ALIBABA_ENDPOINT } : {})
          });
          const { NodeManagedCredentialProvider } =
            await import('../../apps/api/src/gateway/node-managed-credentials');
          const managed = new NodeManagedCredentialProvider(
            repository,
            stored,
            new GatewayCredentialService(repository, cipher, Date.now, 'sqlite-vault'),
            environment
          );
          return {
            provider: {
              status: () => managed.status(),
              requireCredentials: async () => {
                const status = await managed.status();
                if (
                  status.accessTokenExpiresTimeUtc !== null &&
                  status.accessTokenExpiresTimeUtc !== undefined &&
                  status.accessTokenExpiresTimeUtc <= Date.now() + 300_000
                )
                  throw new Error('CURRENT_NODE_ACCESS_TOKEN_EXPIRED_OR_REFRESH_DUE_NO_AUTOMATIC_REFRESH');
                return managed.requireCredentials();
              }
            },
            close: () => {
              connection.close();
            }
          };
        }
      }
      connection.close();
    } catch (error) {
      connection.close();
      throw error;
    }
  }
  const legacy = createNodeAlibabaCredentialProvider(environment, { workingDirectory: root });
  return {
    provider: {
      status: () => Promise.resolve(legacy.status()),
      requireCredentials: () => Promise.resolve(legacy.requireCredentials())
    },
    close: () => {
      /* Legacy file provider holds no open connection. */
    }
  };
}
