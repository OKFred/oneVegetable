import type { OperationAvailabilityClient } from './product-description-template-client-types';
import type { OperationAvailability, OperationAvailabilityResult } from './product-description-template';
import type { OperationId } from './types';

export type OperationAvailabilityDecision = Pick<OperationAvailability, 'allowed' | 'reasonCode'>;
export type OperationAvailabilityResolver = (operation: OperationId) => OperationAvailabilityDecision;

export interface StaticOperationAvailabilityOptions {
  allowedReasonCode?: string;
  deniedReasonCode?: string;
}

export class StaticOperationAvailabilityClient implements OperationAvailabilityClient {
  readonly #resolve: OperationAvailabilityResolver;

  constructor(allowed: ReadonlySet<OperationId>, options?: StaticOperationAvailabilityOptions);
  constructor(resolve: OperationAvailabilityResolver);
  constructor(
    source: ReadonlySet<OperationId> | OperationAvailabilityResolver,
    options: StaticOperationAvailabilityOptions = {}
  ) {
    if (typeof source === 'function') {
      this.#resolve = source;
      return;
    }
    const allowedReasonCode = options.allowedReasonCode ?? 'STATIC_ALLOWED';
    const deniedReasonCode = options.deniedReasonCode ?? 'STATIC_DISABLED';
    this.#resolve = (operation) => ({
      allowed: source.has(operation),
      reasonCode: source.has(operation) ? allowedReasonCode : deniedReasonCode
    });
  }

  get(operations: readonly OperationId[]): Promise<OperationAvailabilityResult> {
    return Promise.resolve({
      items: operations.map((operation) => ({ operation, ...this.#resolve(operation) }))
    });
  }
}
