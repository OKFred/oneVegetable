import { GatewayConfigurationError } from '../gateway/credentials';

const ALGORITHM = 'AES-GCM';
const KEY_BYTES = 32;
const KEY_VERSION = 1;

export type MetaSecretKind = 'app-secret' | 'user-token' | 'destination-token' | 'publish-caption';

export interface EncryptedMetaSecret {
  ciphertext: string;
  initializationVector: string;
  keyVersion: number;
}

export class MetaSecretCipher {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  static async create(encodedKey: string | undefined): Promise<MetaSecretCipher> {
    const bytes = decodeBase64Url(encodedKey?.trim() ?? '');
    if (bytes.byteLength !== KEY_BYTES) {
      throw new GatewayConfigurationError(
        'META_CREDENTIAL_ENCRYPTION_KEY_INVALID',
        'Meta 凭据加密密钥必须是 32 字节 Base64URL'
      );
    }
    return new MetaSecretCipher(
      await crypto.subtle.importKey('raw', toArrayBuffer(bytes), { name: ALGORITHM }, false, [
        'encrypt',
        'decrypt'
      ])
    );
  }

  async encrypt(kind: MetaSecretKind, recordId: string, plaintext: string): Promise<EncryptedMetaSecret> {
    const initializationVector = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv: toArrayBuffer(initializationVector),
        additionalData: toArrayBuffer(additionalData(kind, recordId, KEY_VERSION))
      },
      this.#key,
      new TextEncoder().encode(plaintext)
    );
    return {
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
      initializationVector: encodeBase64Url(initializationVector),
      keyVersion: KEY_VERSION
    };
  }

  async decrypt(
    kind: MetaSecretKind,
    recordId: string,
    encrypted: Pick<EncryptedMetaSecret, 'ciphertext' | 'initializationVector' | 'keyVersion'>
  ): Promise<string> {
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: ALGORITHM,
          iv: toArrayBuffer(decodeBase64Url(encrypted.initializationVector)),
          additionalData: toArrayBuffer(additionalData(kind, recordId, encrypted.keyVersion))
        },
        this.#key,
        toArrayBuffer(decodeBase64Url(encrypted.ciphertext))
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new GatewayConfigurationError(
        'META_CREDENTIAL_VAULT_UNREADABLE',
        'Meta 凭据无法解密，请检查加密密钥或重新连接'
      );
    }
  }
}

function additionalData(kind: MetaSecretKind, recordId: string, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(`one-vegetable:meta-social:1:${kind}:${recordId}:${keyVersion}`);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return new Uint8Array();
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
