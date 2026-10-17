// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { IopAuthorizationSummary } from '../lib/iop-authorization';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(message: { action: string }) => Promise<unknown>>()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, sendMessage: mocks.send }
  }
}));

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('resynchronizes a stale ready page and keeps the old vault input editable across status checks', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  history.replaceState(null, '', '/authorization.html?protocol=top');
  document.body.innerHTML = '<main id="app"></main>';
  let state: IopAuthorizationSummary['state'] = 'ready';
  mocks.send.mockImplementation((message: { action: string }) => {
    if (message.action === 'unlock') state = 'ready';
    return Promise.resolve({
      ok: true,
      data: {
        state,
        appName: null,
        appKeySuffix: null,
        expiresAtUtc: null,
        refreshExpiresAtUtc: null,
        canRefresh: false,
        canReauthorize: state === 'ready',
        canSave: false,
        errorCode: null,
        callbackUrl: null
      } satisfies IopAuthorizationSummary
    });
  });
  await import('../entrypoints/authorization/main');
  await vi.advanceTimersByTimeAsync(0);
  const form = document.querySelector<HTMLFormElement>('#unlockForm');
  const input = document.querySelector<HTMLInputElement>('#unlockPassphrase');
  if (!form || !input) throw new Error('Missing authorization controls');
  expect(form.hidden).toBe(true);
  state = 'locked';
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(form.hidden).toBe(false);
  expect(input.disabled).toBe(false);
  input.focus();
  input.value = 'test-only-passphrase';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(30_001);
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('test-only-passphrase');
  expect(document.activeElement).toBe(input);
  expect(mocks.send.mock.calls.every(([message]) => message.action === 'status')).toBe(true);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      protocol: 'top',
      action: 'unlock',
      payload: { passphrase: 'test-only-passphrase' }
    })
  );
  expect(input.value).toBe('');
  expect(form.hidden).toBe(true);
  window.dispatchEvent(new Event('pagehide'));
  const count = mocks.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.send).toHaveBeenCalledTimes(count);
});
