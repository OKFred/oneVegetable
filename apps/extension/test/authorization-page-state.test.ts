// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { IopAuthorizationSummary } from '../lib/iop-authorization';

const mocks = vi.hoisted(() => ({
  send: vi.fn<(message: { action: string }) => Promise<unknown>>(),
  onStorageChanged: vi.fn()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (path: string) => `chrome-extension://test${path}`, sendMessage: mocks.send },
    storage: { onChanged: { addListener: mocks.onStorageChanged } }
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
    if (message.action === 'protection-status')
      return Promise.resolve({ ok: true, data: { state: 'unlocked', deviceProtected: false } });
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
  const otherMethods = document.querySelector<HTMLDetailsElement>('#authorization-other-methods');
  expect(otherMethods?.open).toBe(false);
  expect(otherMethods?.hidden).toBe(true);
  expect(document.querySelector('#authorization-header-back')?.parentElement?.className).toBe(
    'authorization-header-actions'
  );
  const form = document.querySelector<HTMLFormElement>('#unlockForm');
  const input = document.querySelector<HTMLInputElement>('#unlockPassphrase');
  const summary = document.querySelector<HTMLElement>('.authorization-summary');
  const summaryPanel = document.querySelector<HTMLElement>('#authorization-summary-panel');
  const otherProtocol = document.querySelector<HTMLButtonElement>('#authorizeOtherProtocol');
  if (!form || !input || !summary || !summaryPanel || !otherProtocol)
    throw new Error('Missing authorization controls');
  expect(form.hidden).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#restartConnection')?.hidden).toBe(false);
  expect(summary.hidden).toBe(false);
  expect(summaryPanel.querySelector('button, details')).toBeNull();
  expect(otherProtocol.hidden).toBe(false);
  expect(otherProtocol.disabled).toBe(false);
  expect(otherProtocol.textContent).toContain('IOP');
  expect(document.querySelector('#applyWorkbench')?.nextElementSibling).toBe(otherProtocol);
  for (const id of [
    'connectionDetails',
    'protocolSettings',
    'protocolTop',
    'protocolIop',
    'topUseIop',
    'export',
    'refresh',
    'lock',
    'clear',
    'reauthorize',
    'changeAuthorization'
  ])
    expect(document.getElementById(id), `Removed standalone control: ${id}`).toBeNull();
  state = 'locked';
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(form.hidden).toBe(false);
  expect(input.disabled).toBe(false);
  expect(summary.hidden).toBe(true);
  expect(otherProtocol.hidden).toBe(true);
  expect(otherProtocol.disabled).toBe(true);
  input.focus();
  input.value = 'test-only-passphrase';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(30_001);
  expect(input.disabled).toBe(false);
  expect(input.value).toBe('test-only-passphrase');
  expect(document.activeElement).toBe(input);
  expect(
    mocks.send.mock.calls.every(([message]) => ['status', 'protection-status'].includes(message.action))
  ).toBe(true);
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
  expect(summary.hidden).toBe(false);
  expect(otherProtocol.hidden).toBe(false);
  expect(otherProtocol.disabled).toBe(false);
  state = 'empty';
  const onChange = mocks.onStorageChanged.mock.calls[0]?.[0] as (
    changes: Record<string, unknown>,
    area: string
  ) => void;
  onChange({ 'one-vegetable-top-authorization-v1': {} }, 'local');
  await vi.advanceTimersByTimeAsync(0);
  expect(summary.hidden).toBe(true);
  expect(otherProtocol.hidden).toBe(true);
  expect(otherProtocol.disabled).toBe(true);
  expect(otherMethods?.hidden).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('#restartConnection')?.hidden).toBe(true);
  expect(document.querySelector('#name')?.textContent).toBe('—');
  for (const unreadyState of ['waiting', 'busy', 'unknown'] as const) {
    state = unreadyState;
    onChange({ 'one-vegetable-top-authorization-v1': {} }, 'local');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.dataset.authorizationReady).toBe('false');
    expect(summary.hidden).toBe(true);
    expect(otherProtocol.hidden).toBe(true);
    expect(otherProtocol.disabled).toBe(true);
    const requests = mocks.send.mock.calls.length;
    otherProtocol.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).toHaveBeenCalledTimes(requests);
    expect(new URL(location.href).searchParams.get('protocol')).toBe('top');
  }
  expect(
    mocks.send.mock.calls.every(([message]) =>
      ['status', 'protection-status', 'unlock'].includes(message.action)
    )
  ).toBe(true);
  window.dispatchEvent(new Event('pagehide'));
  const count = mocks.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.send).toHaveBeenCalledTimes(count);
});
