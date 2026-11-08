import { decodeBase64, encodeBase64 } from '@one-vegetable/core/encoded-file';
import { isRequestId, NativeFetchTransport, type NetworkTransport } from '@one-vegetable/core/network';
import {
  parseShippingServicesRequest,
  requestShippingQuote,
  ShippingServicesError,
  shippingServicesFail as fail,
  type ShippingProviderConfigurationSummary,
  type ShippingServicesRequest
} from '@one-vegetable/core/shipping-services';
import {
  EXTENSION_SHIPPING_SERVICES_STORAGE_KEY,
  SHIPPING_PERMISSION_ORIGINS,
  shippingRecord as record,
  type ShippingServicesResponse
} from './shipping-services-protocol';

interface EncryptedConfiguration {
  iv: string;
  ciphertext: string;
  updatedAtUtc: number;
}
interface QuoteClaim {
  requestId: string;
  attemptedAtUtc: number;
  revision: number;
  completedAtUtc: number | null;
}
export interface ShippingServicesStoredState {
  schemaVersion: 1;
  revision: number;
  configuration: EncryptedConfiguration | null;
  claims: QuoteClaim[];
}
export interface ShippingServicesLocalStore {
  read(): Promise<unknown>;
  write(value: ShippingServicesStoredState): Promise<void>;
  remove(): Promise<void>;
  key(create: boolean): Promise<CryptoKey | null>;
  removeKey(): Promise<void>;
}

/** Only the trusted options page may enter this queue; never accepts provider URLs or Alibaba state. */
export class ExtensionShippingServicesService {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: ShippingServicesLocalStore,
    private readonly contains: (origins: string[]) => Promise<boolean>,
    private readonly transport?: NetworkTransport,
    private readonly clock: () => number = Date.now
  ) {}

  handle(value: unknown, trusted: boolean): Promise<ShippingServicesResponse> {
    return this.#serial(async () => {
      const requestId = record(value) && isRequestId(value.requestId) ? value.requestId : crypto.randomUUID();
      try {
        if (!trusted) fail('SHIPPING_UNTRUSTED_SENDER');
        if (!record(value) || value.kind !== 'shipping-services-request') fail('SHIPPING_REQUEST_INVALID');
        const { kind: _kind, ...input } = value;
        const request = parseShippingServicesRequest(input);
        const data = await this.#execute(request);
        return { requestId: request.requestId, ok: true, data };
      } catch (cause: unknown) {
        // Never serialize storage/crypto/provider errors, request bodies, keys or raw responses.
        const code =
          cause instanceof ShippingServicesError &&
          /^(?:SHIPPING_[A-Z_]+|INVALID_REQUEST_ID)$/u.test(cause.code)
            ? cause.code
            : 'SHIPPING_SERVICES_FAILED';
        return { requestId, ok: false, error: { code, message: code, retryable: false } };
      }
    });
  }

  /** Called inside the background's global reset queue, never from a runtime message. */
  reset(): Promise<void> {
    return this.#serial(async () => {
      await this.store.remove();
      await this.store.removeKey();
    });
  }

  #serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(action);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<ShippingServicesStoredState> {
    const value = await this.store.read();
    if (value === undefined) return { schemaVersion: 1, revision: 0, configuration: null, claims: [] };
    const revision = record(value) ? value.revision : null;
    const configuration = record(value) ? value.configuration : null;
    if (
      !record(value) ||
      value.schemaVersion !== 1 ||
      !nonnegativeInteger(revision) ||
      !Array.isArray(value.claims) ||
      !value.claims.every(
        (claim: unknown): claim is QuoteClaim =>
          record(claim) &&
          isRequestId(claim.requestId) &&
          nonnegativeInteger(claim.attemptedAtUtc) &&
          (claim.completedAtUtc === null || nonnegativeInteger(claim.completedAtUtc)) &&
          nonnegativeInteger(claim.revision) &&
          claim.revision > 0 &&
          claim.revision <= revision
      ) ||
      (configuration !== null &&
        (!record(configuration) ||
          revision < 1 ||
          !nonnegativeInteger(configuration.updatedAtUtc) ||
          typeof configuration.iv !== 'string' ||
          typeof configuration.ciphertext !== 'string' ||
          configuration.ciphertext.length > 32_768))
    )
      fail('SHIPPING_CONFIGURATION_UNREADABLE');
    const cutoff = this.clock() - 30 * 86_400_000;
    return {
      schemaVersion: 1,
      revision,
      configuration: configuration as EncryptedConfiguration | null,
      // Keep the full 30-day deduplication window, including pending/unknown attempts.
      claims: value.claims.filter((claim) => claim.attemptedAtUtc >= cutoff)
    };
  }

  #aad(revision: number, updatedAtUtc: number): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(
      `${EXTENSION_SHIPPING_SERVICES_STORAGE_KEY}:freightos:${revision}:${updatedAtUtc}`
    );
  }

  async #apiKey(state: ShippingServicesStoredState): Promise<string> {
    const saved = state.configuration;
    if (!saved) return fail('SHIPPING_CREDENTIAL_REQUIRED');
    try {
      const key = await this.store.key(false);
      if (!key) return fail('SHIPPING_CONFIGURATION_UNREADABLE');
      const bytes = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: Uint8Array.from(decodeBase64(saved.iv)),
          additionalData: this.#aad(state.revision, saved.updatedAtUtc)
        },
        key,
        Uint8Array.from(decodeBase64(saved.ciphertext))
      );
      const apiKey = new TextDecoder().decode(bytes);
      const checked = parseShippingServicesRequest({
        action: 'save',
        requestId: crypto.randomUUID(),
        provider: 'freightos',
        apiKey,
        expectedRevision: state.revision,
        termsAccepted: true,
        costAcknowledged: true
      });
      if (checked.action !== 'save') return fail('SHIPPING_CONFIGURATION_UNREADABLE');
      return checked.apiKey;
    } catch {
      return fail('SHIPPING_CONFIGURATION_UNREADABLE');
    }
  }

  #summary(state: ShippingServicesStoredState): ShippingProviderConfigurationSummary {
    return {
      provider: 'freightos',
      configured: state.configuration !== null,
      revision: state.configuration ? state.revision : null,
      updatedAtUtc: state.configuration?.updatedAtUtc ?? null
    };
  }

  async #permission(): Promise<void> {
    if (!(await this.contains([...SHIPPING_PERMISSION_ORIGINS]))) fail('SHIPPING_PERMISSION_REQUIRED');
  }

  async #execute(request: ShippingServicesRequest): Promise<unknown> {
    const state = await this.#read();
    if (request.action === 'configuration') {
      if (state.configuration) await this.#apiKey(state);
      return this.#summary(state);
    }
    if (request.expectedRevision !== (state.configuration ? state.revision : null))
      fail('SHIPPING_CONFIGURATION_CHANGED');
    if (request.action === 'clear') {
      // Preserve claim IDs and daily counts across key deletion/replacement.
      await this.store.write({ ...state, configuration: null });
      await this.store.removeKey();
      return null;
    }
    if (request.action === 'save') {
      await this.#permission();
      const revision = state.revision + 1;
      if (!Number.isSafeInteger(revision)) fail('SHIPPING_CONFIGURATION_UNREADABLE');
      const key = await this.store.key(true);
      if (!key) return fail('SHIPPING_CONFIGURATION_UNREADABLE');
      const updatedAtUtc = this.clock();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: this.#aad(revision, updatedAtUtc) },
        key,
        new TextEncoder().encode(request.apiKey)
      );
      const next: ShippingServicesStoredState = {
        ...state,
        revision,
        configuration: {
          iv: encodeBase64(iv),
          ciphertext: encodeBase64(new Uint8Array(ciphertext)),
          updatedAtUtc
        }
      };
      await this.store.write(next);
      return this.#summary(next);
    }
    const apiKey = await this.#apiKey(state);
    await this.#permission();
    const requestId = request.requestId.toLowerCase();
    if (state.claims.some((claim) => claim.requestId.toLowerCase() === requestId))
      fail('SHIPPING_QUOTE_ALREADY_SENT');
    const attemptedAtUtc = this.clock();
    // The provider deadline is 20s; a crashed worker holds other manual IDs for at most 60s.
    if (
      state.claims.some(
        (claim) => claim.completedAtUtc === null && attemptedAtUtc - claim.attemptedAtUtc < 60_000
      )
    )
      fail('SHIPPING_QUOTE_IN_PROGRESS');
    // UTC calendar day, local-device ceiling only; not a provider billing guarantee.
    const day = Math.floor(attemptedAtUtc / 86_400_000);
    if (state.claims.filter((claim) => Math.floor(claim.attemptedAtUtc / 86_400_000) === day).length >= 10)
      fail('SHIPPING_LOCAL_DAILY_LIMIT');
    // Commit before dispatch. Unknown outcomes stay claimed, including after worker restart.
    const claimed: ShippingServicesStoredState = {
      ...state,
      claims: [...state.claims, { requestId, attemptedAtUtc, revision: state.revision, completedAtUtc: null }]
    };
    await this.store.write(claimed);
    const transport = this.transport ?? new NativeFetchTransport();
    try {
      return await requestShippingQuote(request, apiKey, {
        send: async (url, init) => {
          await this.#permission();
          return transport.send(url, init);
        }
      });
    } finally {
      // A killed worker leaves its ID claimed; only its global serial lease expires.
      await this.store.write({
        ...claimed,
        claims: claimed.claims.map((claim) =>
          claim.requestId === requestId ? { ...claim, completedAtUtc: this.clock() } : claim
        )
      });
    }
  }
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
