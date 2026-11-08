import { decodeBase64, encodeBase64 } from '@one-vegetable/core/encoded-file';
import {
  parseShippingServicesRequest,
  requestShippingQuote,
  ShippingServicesError,
  shippingServicesFail,
  type ShippingProviderConfigurationSummary,
  type ShippingProviderId,
  type ShippingQuoteResult
} from '@one-vegetable/core/shipping-services';

import type { NetworkTransport } from '@one-vegetable/core/network';
import type { SqlShippingServicesRepository, ShippingConfigurationRecord } from './repository';

export class ShippingServicesCipher {
  private constructor(private readonly key: CryptoKey) {}

  static async create(encodedKey: string | undefined): Promise<ShippingServicesCipher> {
    let bytes: Uint8Array;
    try {
      const value = encodedKey?.trim() ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new Error();
      bytes = decodeBase64(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
      if (bytes.byteLength !== 32) throw new Error();
    } catch {
      shippingServicesFail('SHIPPING_CREDENTIAL_ENCRYPTION_KEY_INVALID');
    }
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(bytes).buffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return new ShippingServicesCipher(key);
  }

  async encrypt(ownerId: string, provider: ShippingProviderId, apiKey: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(ownerId, provider) },
      this.key,
      new TextEncoder().encode(apiKey)
    );
    return {
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      initializationVector: encodeBase64(iv)
    };
  }

  async decrypt(record: ShippingConfigurationRecord): Promise<string> {
    try {
      if (record.ciphertext === null || record.initializationVector === null) throw new Error();
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: Uint8Array.from(decodeBase64(record.initializationVector)).buffer,
          additionalData: aad(record.ownerId, record.provider)
        },
        this.key,
        Uint8Array.from(decodeBase64(record.ciphertext)).buffer
      );
      const key = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      if (!key.trim()) throw new Error();
      return key;
    } catch {
      shippingServicesFail('SHIPPING_CONFIGURATION_UNREADABLE');
    }
  }
}

function aad(ownerId: string, provider: ShippingProviderId): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify(['one-vegetable', 'shipping-services', 1, ownerId, provider])
  );
}

export class ShippingServicesService {
  constructor(
    private readonly repository: SqlShippingServicesRepository,
    private readonly cipher: ShippingServicesCipher,
    private readonly clock: () => number = Date.now,
    private readonly transport?: NetworkTransport
  ) {}

  async execute(
    ownerId: string,
    value: unknown
  ): Promise<ShippingProviderConfigurationSummary | ShippingQuoteResult | null> {
    if (!ownerId.trim()) shippingServicesFail('SHIPPING_OWNER_REQUIRED');
    const request = parseShippingServicesRequest(value);
    if (
      'expectedRevision' in request &&
      request.expectedRevision !== null &&
      (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision >= Number.MAX_SAFE_INTEGER)
    )
      shippingServicesFail('SHIPPING_REQUEST_INVALID');
    await this.repository.prune(ownerId, this.clock());
    const { provider } = request;
    if (request.action === 'configuration')
      return summary(provider, await this.repository.find(ownerId, provider));
    if (request.action === 'save' || request.action === 'clear') {
      const encrypted =
        request.action === 'save'
          ? await this.cipher.encrypt(ownerId, provider, request.apiKey)
          : { ciphertext: null, initializationVector: null };
      const record: ShippingConfigurationRecord = {
        ...encrypted,
        ownerId,
        provider,
        revision: (request.expectedRevision ?? 0) + 1,
        updatedAtUtc: this.clock()
      };
      // Keep a tombstone on clear: an old revision must never match a recreated credential.
      await this.repository.save(record, request.expectedRevision);
      return request.action === 'clear' ? null : summary(provider, record);
    }
    if (await this.repository.hasAttempt(ownerId, request.requestId))
      shippingServicesFail('SHIPPING_QUOTE_ALREADY_SENT');
    const record = await this.repository.find(ownerId, provider);
    if (record?.ciphertext == null) shippingServicesFail('SHIPPING_CREDENTIAL_REQUIRED');
    if (record.revision !== request.expectedRevision) shippingServicesFail('SHIPPING_CONFIGURATION_CHANGED');
    const apiKey = await this.cipher.decrypt(record);
    await this.repository.claim(record, request.requestId, this.clock());
    let outcomeUnknown = true;
    try {
      const result = await requestShippingQuote(request, apiKey, this.transport);
      outcomeUnknown = false;
      return result;
    } catch (error) {
      if (error instanceof ShippingServicesError) {
        outcomeUnknown = ![
          'SHIPPING_PROVIDER_AUTH_REQUIRED',
          'SHIPPING_PROVIDER_RATE_LIMIT',
          'SHIPPING_QUOTE_REJECTED',
          'SHIPPING_QUOTE_PROVIDER_UNAVAILABLE'
        ].includes(error.code);
        throw error;
      }
      shippingServicesFail('SHIPPING_SERVICES_FAILED');
    } finally {
      // Attempt receipts deliberately store neither addresses, request bodies, results nor errors.
      // A crash keeps this request unknown; only its 60-second serial lease can expire.
      await this.repository.complete(ownerId, request.requestId, this.clock(), outcomeUnknown);
    }
  }
}

function summary(
  provider: ShippingProviderId,
  record: ShippingConfigurationRecord | null
): ShippingProviderConfigurationSummary {
  return {
    provider,
    configured: record?.ciphertext != null,
    revision: record?.revision ?? null,
    updatedAtUtc: record?.updatedAtUtc ?? null
  };
}
