import {
  parseAlibabaOpenApiCredentialBundle,
  type AlibabaOpenApiCredentialBundle
} from './alibaba-credential-bundle';
import { CREDENTIAL_VAULT_ITERATIONS, validateVaultPassphrase } from './credential-vault';
import { isRecord } from './alibaba-iop';

type AuthorizationProtocol = 'top' | 'iop';
function additionalData(protocol: AuthorizationProtocol): Uint8Array<ArrayBuffer> {
  // Keep the original IOP AAD for existing encrypted records. TOP is isolated.
  return new TextEncoder().encode(
    protocol === 'iop'
      ? 'one-vegetable:alibaba-authorization:v1'
      : 'one-vegetable:alibaba-authorization:top:v1'
  );
}
export interface AlibabaAuthorizationVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}
export interface OpenAlibabaAuthorizationVault {
  record: AlibabaAuthorizationVault;
  key: CryptoKey;
  bundle: AlibabaOpenApiCredentialBundle;
}

export async function sealAlibabaAuthorization(
  bundle: AlibabaOpenApiCredentialBundle,
  passphrase: string,
  protocol: AuthorizationProtocol = 'iop'
): Promise<OpenAlibabaAuthorizationVault> {
  validateVaultPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(passphrase, salt);
  const record = await resealAlibabaAuthorization(bundle, key, encode(salt), protocol);
  return { record, key, bundle };
}

export async function openAlibabaAuthorization(
  value: unknown,
  passphrase: string,
  protocol: AuthorizationProtocol = 'iop'
): Promise<OpenAlibabaAuthorizationVault> {
  validateVaultPassphrase(passphrase);
  const record = parseAlibabaAuthorizationVault(value);
  const key = await derive(passphrase, decode(record.salt));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(record.iv), additionalData: additionalData(protocol) },
      key,
      decode(record.ciphertext)
    );
    const bundle = parseAlibabaOpenApiCredentialBundle(
      JSON.parse(new TextDecoder().decode(plaintext)) as unknown
    );
    if ((bundle.protocol ?? 'top') !== protocol) throw new Error('AUTH_PROTOCOL_MISMATCH');
    return { record, key, bundle };
  } catch {
    throw new Error('AUTH_UNLOCK_FAILED');
  }
}

export async function resealAlibabaAuthorization(
  bundle: AlibabaOpenApiCredentialBundle,
  key: CryptoKey,
  salt: string,
  protocol: AuthorizationProtocol = 'iop'
): Promise<AlibabaAuthorizationVault> {
  const checked = parseAlibabaOpenApiCredentialBundle(bundle);
  if ((checked.protocol ?? 'top') !== protocol)
    throw new Error(protocol === 'iop' ? 'IOP_REQUIRED' : 'TOP_REQUIRED');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(protocol) },
    key,
    new TextEncoder().encode(JSON.stringify(checked))
  );
  return { version: 1, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) };
}

export function parseAlibabaAuthorizationVault(value: unknown): AlibabaAuthorizationVault {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.salt !== 'string' ||
    typeof value.iv !== 'string' ||
    typeof value.ciphertext !== 'string' ||
    value.ciphertext.length > 262_144
  )
    throw new Error('AUTH_VAULT_INVALID');
  try {
    if (
      decode(value.salt).length !== 16 ||
      decode(value.iv).length !== 12 ||
      decode(value.ciphertext).length < 17
    )
      throw new Error('AUTH_VAULT_INVALID');
  } catch {
    throw new Error('AUTH_VAULT_INVALID');
  }
  return { version: 1, salt: value.salt, iv: value.iv, ciphertext: value.ciphertext };
}

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: CREDENTIAL_VAULT_ITERATIONS, salt },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
