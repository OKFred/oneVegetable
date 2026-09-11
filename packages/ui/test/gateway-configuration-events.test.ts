// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  GATEWAY_CONFIGURATION_EVENT,
  isExternalGatewayConfigurationChange,
  notifyGatewayConfigurationChanged
} from '../src/lib/gateway-configuration-events';

afterEach(() => {
  vi.unstubAllGlobals();
});
it('notifies this window once and ignores its own cross-window broadcast', () => {
  const messages: unknown[] = [];
  const closed = vi.fn();
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      postMessage(value: unknown) {
        messages.push(value);
      }
      close() {
        closed();
      }
    }
  );
  const listener = vi.fn();
  window.addEventListener(GATEWAY_CONFIGURATION_EVENT, listener);
  try {
    notifyGatewayConfigurationChanged();
    expect(listener).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
    expect(closed).toHaveBeenCalledOnce();
    expect(isExternalGatewayConfigurationChange(messages[0])).toBe(false);
    expect(isExternalGatewayConfigurationChange({ kind: 'changed', senderId: crypto.randomUUID() })).toBe(
      true
    );
    expect(isExternalGatewayConfigurationChange(null)).toBe(false);
    expect(Object.keys(messages[0] as object).sort()).toEqual(['kind', 'senderId']);
  } finally {
    window.removeEventListener(GATEWAY_CONFIGURATION_EVENT, listener);
  }
});
