import type { GatewayError } from './types';

export const BFF_AUTHENTICATION_REQUIRED_CODES = [
  'SESSION_REQUIRED',
  'SESSION_INVALID',
  'SESSION_EXPIRED'
] as const;

export type BffAuthenticationRequiredCode = (typeof BFF_AUTHENTICATION_REQUIRED_CODES)[number];

export interface BffAuthenticationRequiredEvent {
  code: BffAuthenticationRequiredCode;
  requestId: string;
}

export type BffAuthenticationRequiredHandler = (event: BffAuthenticationRequiredEvent) => void;

export interface BffAuthenticationRequiredSource {
  subscribe(handler: BffAuthenticationRequiredHandler): () => void;
}

export interface BffAuthenticationEvents extends BffAuthenticationRequiredSource {
  notify: BffAuthenticationRequiredHandler;
}

export function createBffAuthenticationEvents(): BffAuthenticationEvents {
  const listeners = new Set<BffAuthenticationRequiredHandler>();
  return {
    notify(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Authentication notification must never replace the original request error.
        }
      }
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    }
  };
}

export function notifyBffAuthenticationRequired(
  handler: BffAuthenticationRequiredHandler | undefined,
  error: GatewayError,
  requestId: string
): void {
  if (!handler || !isBffAuthenticationRequiredCode(error.code)) return;
  try {
    handler({ code: error.code, requestId });
  } catch {
    // Authentication notification must never replace the original request error.
  }
}

export function isBffAuthenticationRequiredCode(value: string): value is BffAuthenticationRequiredCode {
  return BFF_AUTHENTICATION_REQUIRED_CODES.some((code) => code === value);
}
