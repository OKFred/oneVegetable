import { describe, expect, it, vi } from 'vitest';

import {
  createBffAuthenticationEvents,
  isBffAuthenticationRequiredCode,
  notifyBffAuthenticationRequired
} from '../src/bff-authentication';

describe('BFF authentication events', () => {
  it('notifies subscribers and supports unsubscription without exposing listener failures', () => {
    const events = createBffAuthenticationEvents();
    const listener = vi.fn();
    const unsubscribe = events.subscribe(listener);
    events.subscribe(() => {
      throw new Error('listener failed');
    });

    const event = {
      code: 'SESSION_EXPIRED' as const,
      requestId: '86f96b63-2f45-4ae5-9362-9e74ab35d5a2'
    };
    expect(() => {
      events.notify(event);
    }).not.toThrow();
    expect(listener).toHaveBeenCalledWith(event);

    unsubscribe();
    events.notify(event);
    expect(listener).toHaveBeenCalledOnce();
  });

  it('only promotes workspace session errors to authentication-required events', () => {
    const handler = vi.fn();
    const requestId = '86f96b63-2f45-4ae5-9362-9e74ab35d5a2';

    notifyBffAuthenticationRequired(
      handler,
      { code: 'FORBIDDEN', message: 'denied', retryable: false },
      requestId
    );
    notifyBffAuthenticationRequired(
      handler,
      { code: 'SESSION_INVALID', message: 'invalid', retryable: false },
      requestId
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ code: 'SESSION_INVALID', requestId });
    expect(isBffAuthenticationRequiredCode('SESSION_REQUIRED')).toBe(true);
    expect(isBffAuthenticationRequiredCode('AUTHENTICATION_FAILED')).toBe(false);
  });
});
