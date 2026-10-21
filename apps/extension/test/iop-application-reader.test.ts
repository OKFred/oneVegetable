import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/iop-app-reader.json';
import type { ExtensionAlibabaApplicationDetails } from '../lib/alibaba-credential-page-driver';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { IopApplicationReader } from '../lib/iop-application-reader';

const application = fixtures.application as ExtensionAlibabaApplicationDetails;
const prerequisite = {
  kind: 'prerequisite',
  reasonCode: 'developer-registration-under-review',
  registration: null
} as const;
const page = {
  open: vi.fn().mockResolvedValue(7),
  inspect: vi.fn(),
  state: vi.fn(),
  click: vi.fn(),
  secret: vi.fn(),
  wait: vi.fn().mockResolvedValue(undefined)
};
beforeEach(() => {
  vi.clearAllMocks();
  page.inspect.mockResolvedValue({ application });
  page.state.mockResolvedValue({ kind: 'ready' });
  page.click.mockResolvedValue(true);
  page.secret.mockResolvedValue({ status: 'available', appSecret: fixtures.appSecret });
  page.wait.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe('bounded IOP app discovery', () => {
  it('reads the currently displayed IOP app, preserving the registered Callback', async () => {
    expect(await new IopApplicationReader(page).read()).toEqual({
      appName: application.appName,
      appKey: application.appKey,
      callbackUrl: application.callbackUrl,
      appSecret: fixtures.appSecret
    });
    expect(page.click).not.toHaveBeenCalled();
  });
  it('animates Application center and View once, then reads without changing app configuration', async () => {
    page.state.mockResolvedValueOnce({ kind: 'navigation-ready' });
    page.inspect.mockResolvedValueOnce({ application: null });
    page.secret.mockResolvedValueOnce({ status: 'waiting', reason: 'layout' });
    await new IopApplicationReader(page).read();
    expect(page.click.mock.calls).toEqual([
      [7, 'application-center', undefined, undefined, expect.any(Number)],
      [7, 'reveal-secret', undefined, application.appKey, expect.any(Number)]
    ]);
  });
  it('mounts the guide before inspecting or clicking the application center', async () => {
    const guide = vi.fn().mockResolvedValue(undefined);
    const timeline: string[] = [];
    guide.mockImplementation((_id: number, phase: string) => {
      timeline.push(phase);
      return Promise.resolve();
    });
    page.state.mockImplementation(() => {
      timeline.push('inspect');
      return Promise.resolve({ kind: 'ready' });
    });
    await new IopApplicationReader({ ...page, guide }).read();
    expect(timeline[0]).toBe('opening');
    expect(timeline.indexOf('opening')).toBeLessThan(timeline.indexOf('inspect'));
    expect(guide).toHaveBeenCalledWith(7, 'ready');
  });
  it.each([
    [{ kind: 'challenge' }, 'IOP_APP_SECURITY_CHECK'],
    [{ kind: 'login-required' }, 'IOP_APP_LOGIN_REQUIRED'],
    [
      { kind: 'prerequisite', reasonCode: 'developer-registration-under-review' },
      'IOP_APP_PREREQUISITE_REQUIRED'
    ]
  ])('stops on a prerequisite without revealing any secret', async (state, code) => {
    page.state.mockResolvedValue(state);
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({ gatewayError: { code } });
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    if (state.kind !== 'prerequisite') {
      expect(page.state).toHaveBeenCalledOnce();
      expect(page.wait).not.toHaveBeenCalled();
    }
  });
  it('confirms a stable prerequisite briefly, without inspecting the app or reading its secret', async () => {
    vi.useFakeTimers();
    page.state.mockResolvedValue(prerequisite);
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const guide = vi.fn().mockResolvedValue(undefined);
    const reading = new IopApplicationReader({ ...page, guide }).read();
    const rejection = expect(reading).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PREREQUISITE_REQUIRED' }
    });
    await vi.advanceTimersByTimeAsync(1499);
    expect(page.state).toHaveBeenCalledTimes(3);
    expect(guide).not.toHaveBeenCalledWith(7, 'blocked', expect.anything());
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(page.state).toHaveBeenCalledTimes(4);
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(guide).toHaveBeenLastCalledWith(7, 'blocked', 'IOP_APP_PREREQUISITE_REQUIRED');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('continues with the existing app when a loading prerequisite becomes ready', async () => {
    vi.useFakeTimers();
    page.state.mockResolvedValueOnce(prerequisite).mockResolvedValueOnce({ kind: 'waiting' });
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const reading = new IopApplicationReader(page).read();
    await vi.advanceTimersByTimeAsync(500);
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(reading).resolves.toEqual({
      appName: application.appName,
      appKey: application.appKey,
      callbackUrl: application.callbackUrl,
      appSecret: fixtures.appSecret
    });
    expect(page.secret).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('requires a fresh stable interval when the prerequisite reason changes', async () => {
    vi.useFakeTimers();
    const rejected = { ...prerequisite, reasonCode: 'developer-registration-rejected' };
    page.state
      .mockResolvedValueOnce(prerequisite)
      .mockResolvedValueOnce(prerequisite)
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(rejected);
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const reading = new IopApplicationReader(page).read();
    await vi.advanceTimersByTimeAsync(1500);
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(reading).resolves.toHaveProperty('appKey', application.appKey);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    [{ kind: 'challenge' }, 'IOP_APP_SECURITY_CHECK'],
    [{ kind: 'login-required' }, 'IOP_APP_LOGIN_REQUIRED']
  ])('immediately stops if a security or login state appears while confirming: %s', async (state, code) => {
    vi.useFakeTimers();
    page.state.mockResolvedValueOnce(prerequisite).mockResolvedValue(state);
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const reading = new IopApplicationReader(page).read();
    const rejection = expect(reading).rejects.toMatchObject({ gatewayError: { code } });
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(page.state).toHaveBeenCalledTimes(2);
    expect(page.wait).toHaveBeenCalledOnce();
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds changing prerequisite reasons to three seconds rather than extending the deadline', async () => {
    vi.useFakeTimers();
    let count = 0;
    page.state.mockImplementation(() =>
      Promise.resolve({
        ...prerequisite,
        reasonCode: count++ % 2 ? 'application-required' : prerequisite.reasonCode
      })
    );
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const reading = new IopApplicationReader(page).read();
    const rejection = expect(reading).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PREREQUISITE_REQUIRED' }
    });
    await vi.advanceTimersByTimeAsync(2500);
    expect(page.state).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not infer approval when a prerequisite becomes an unresolved loading state', async () => {
    vi.useFakeTimers();
    page.state.mockResolvedValueOnce(prerequisite).mockResolvedValue({ kind: 'waiting' });
    page.wait.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const reading = new IopApplicationReader(page).read();
    const rejection = expect(reading).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PAGE_UNAVAILABLE' }
    });
    await vi.advanceTimersByTimeAsync(3000);
    await rejection;
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['wait', 'state'] as const)('also bounds a hung confirmation %s call', async (phase) => {
    vi.useFakeTimers();
    page.state.mockResolvedValueOnce(prerequisite);
    if (phase === 'state') page.state.mockReturnValueOnce(new Promise(() => undefined));
    else page.wait.mockReturnValueOnce(new Promise(() => undefined));
    const reading = new IopApplicationReader(page).read();
    const rejection = expect(reading).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PREREQUISITE_REQUIRED' }
    });
    await vi.advanceTimersByTimeAsync(3000);
    await rejection;
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds repeated states with a stalled clock and resets confirmation on a new explicit read', async () => {
    page.state.mockResolvedValue(prerequisite);
    const reader = new IopApplicationReader(page, () => 0);
    await expect(reader.read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PREREQUISITE_REQUIRED' }
    });
    expect(page.state).toHaveBeenCalledTimes(7);
    expect(page.wait).toHaveBeenCalledTimes(6);
    expect(page.inspect).not.toHaveBeenCalled();
    expect(page.secret).not.toHaveBeenCalled();
    page.state.mockResolvedValue({ kind: 'ready' });
    await expect(reader.read()).resolves.toHaveProperty('appKey', application.appKey);
  });
  it('hands security verification back instead of repeatedly clicking View', async () => {
    page.secret.mockResolvedValue({ status: 'waiting', reason: 'security-verification' });
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_SECURITY_CHECK' }
    });
    expect(page.click).not.toHaveBeenCalled();
  });
  it('does not substitute a TOP app or invent a missing Callback', async () => {
    page.inspect.mockResolvedValue({ application: { ...application, source: 'legacy-crosstrade' } });
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_READ_FAILED' }
    });
    expect(page.secret).not.toHaveBeenCalled();
    page.inspect.mockResolvedValue({ application: { ...application, callbackUrl: '' } });
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'CALLBACK_INVALID' }
    });
  });
  it('bounds waiting and does not echo arbitrary DOM/provider errors', async () => {
    page.state.mockRejectedValue(new Error(fixtures.appSecret));
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_PAGE_UNAVAILABLE', message: 'IOP_APP_PAGE_UNAVAILABLE' }
    });
    expect(page.wait).toHaveBeenCalledTimes(50);
    page.state.mockResolvedValue({ kind: 'ready' });
    page.inspect.mockRejectedValue(new Error(fixtures.appSecret));
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { message: 'IOP_APP_PAGE_UNAVAILABLE' }
    });
  });
  it('continues reading after an application iframe is replaced during navigation', async () => {
    page.inspect.mockRejectedValueOnce(new Error('Frame was removed'));
    await expect(new IopApplicationReader(page).read()).resolves.toHaveProperty('appKey', application.appKey);
    expect(page.wait).toHaveBeenCalledOnce();
    expect(page.secret).toHaveBeenCalledOnce();
  });
  it.each([
    ['center', 'IOP_APP_CENTER_UNAVAILABLE'],
    ['secret', 'IOP_APP_SECRET_CONTROL_UNAVAILABLE']
  ] as const)('explains an unclickable %s control directly in the Alibaba guide', async (target, code) => {
    const guide = vi.fn().mockResolvedValue(undefined);
    page.click.mockResolvedValue(false);
    if (target === 'center') {
      page.state.mockResolvedValue({ kind: 'navigation-ready' });
      page.inspect.mockResolvedValue({ application: null });
    } else page.secret.mockResolvedValue({ status: 'waiting', reason: 'layout' });
    await expect(new IopApplicationReader({ ...page, guide }).read()).rejects.toMatchObject({
      gatewayError: { code }
    });
    expect(guide).toHaveBeenLastCalledWith(7, 'blocked', code);
    if (target === 'secret') expect(page.click).toHaveBeenCalledOnce();
  });
  it('delivers a concrete guide error even after its discovery deadline expires', async () => {
    vi.useFakeTimers();
    const guide = vi.fn().mockResolvedValue(undefined);
    page.secret.mockReturnValueOnce(new Promise(() => undefined));
    const reading = new IopApplicationReader({ ...page, guide }).read();
    const rejection = expect(reading).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_SECRET_CONTROL_UNAVAILABLE' }
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(guide).toHaveBeenLastCalledWith(7, 'blocked', 'IOP_APP_SECRET_CONTROL_UNAVAILABLE');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not click View again if the revealed secret still cannot be read', async () => {
    page.secret.mockResolvedValue({ status: 'waiting', reason: 'layout' });
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_SECRET_UNAVAILABLE' }
    });
    expect(page.click).toHaveBeenCalledExactlyOnceWith(
      7,
      'reveal-secret',
      undefined,
      application.appKey,
      expect.any(Number)
    );
  });
  it('prevents simultaneous reads but allows a new explicit attempt after completion', async () => {
    const reader = new IopApplicationReader(page);
    const first = reader.read();
    await expect(reader.read()).rejects.toMatchObject({ gatewayError: { code: 'AUTH_TASK_ACTIVE' } });
    await first;
    await expect(reader.read()).resolves.toHaveProperty('appKey', application.appKey);
  });
  it('pins secret reads to the inspected frame and stops if the selected app changes', async () => {
    page.inspect
      .mockResolvedValueOnce({ application, frameId: 12 })
      .mockResolvedValueOnce({ application: { ...application, appKey: 'other-app' }, frameId: 12 });
    page.secret.mockResolvedValue({ status: 'waiting', reason: 'layout' });
    await expect(new IopApplicationReader(page).read()).rejects.toMatchObject({
      gatewayError: { code: 'IOP_APP_CHANGED' }
    });
    expect(page.secret).toHaveBeenCalledExactlyOnceWith(7, 12, application.appKey);
    expect(page.click).toHaveBeenCalledExactlyOnceWith(
      7,
      'reveal-secret',
      12,
      application.appKey,
      expect.any(Number)
    );
  });

  it.each(['open', 'state', 'inspect', 'secret', 'click'] as const)(
    'expires a hung %s call, releases the running lock and ignores late results',
    async (phase) => {
      vi.useFakeTimers();
      const reader = new IopApplicationReader(page);
      let release: (() => void) | undefined;
      const pending = new Promise<never>((_resolve, reject) => {
        release = () => {
          reject(new Error('late-browser-result'));
        };
      });
      if (phase === 'click') page.secret.mockResolvedValueOnce({ status: 'waiting', reason: 'layout' });
      if (phase === 'state' || phase === 'inspect') {
        // A real wait stays pending, so it cannot win against an expired deadline.
        page.wait.mockReturnValueOnce(new Promise(() => undefined));
      }
      page[phase].mockReturnValueOnce(pending);
      const first = reader.read();
      const rejected = expect(first).rejects.toMatchObject({
        gatewayError: {
          code:
            phase === 'secret' || phase === 'click'
              ? 'IOP_APP_SECRET_CONTROL_UNAVAILABLE'
              : phase === 'state' || phase === 'inspect'
                ? 'IOP_APP_PAGE_UNAVAILABLE'
                : 'IOP_APP_READ_FAILED'
        }
      });
      await vi.advanceTimersByTimeAsync(29_999);
      await expect(reader.read()).rejects.toMatchObject({ gatewayError: { code: 'AUTH_TASK_ACTIVE' } });
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
      await expect(reader.read()).resolves.toHaveProperty('appKey', application.appKey);
      release?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
