import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contexts: vi.fn(),
  update: vi.fn(),
  focus: vi.fn(),
  create: vi.fn(),
  options: vi.fn()
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'local-test-extension',
      getURL: (path: string) => `chrome-extension://local-test-extension${path}`,
      getContexts: mocks.contexts,
      openOptionsPage: mocks.options
    },
    tabs: { update: mocks.update, create: mocks.create },
    windows: { update: mocks.focus }
  }
}));
import {
  registerAuthorizationGuide,
  forgetAuthorizationGuide,
  returnFromAuthorizationGuide
} from '../lib/authorization-guide-navigation';

const sender = {
  id: 'local-test-extension',
  url: 'https://i.alibaba.com/explore/open-api',
  frameId: 0,
  tab: { id: 7 }
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.contexts.mockResolvedValue([]);
  mocks.update.mockResolvedValue({});
  mocks.focus.mockResolvedValue({});
  mocks.create.mockResolvedValue({});
  mocks.options.mockResolvedValue(undefined);
});
afterEach(() => {
  forgetAuthorizationGuide(7);
  vi.useRealTimers();
});

describe('worker-bound Alibaba guide return', () => {
  it.each(['top', 'iop'] as const)(
    'focuses the existing %s tool, without starting OAuth',
    async (protocol) => {
      registerAuthorizationGuide(7, protocol);
      mocks.contexts.mockResolvedValue([
        {
          tabId: 12,
          windowId: 3,
          documentUrl: `https://example.com/authorization.html?protocol=${protocol}`
        },
        {
          tabId: 13,
          windowId: 3,
          documentUrl: `chrome-extension://other/authorization.html?protocol=${protocol}`
        },
        {
          tabId: 14,
          windowId: 3,
          documentUrl: `chrome-extension://local-test-extension/authorization.html?protocol=${protocol === 'iop' ? 'top' : 'iop'}`
        },
        {
          tabId: 15,
          windowId: 4,
          documentUrl: `chrome-extension://local-test-extension/authorization.html?protocol=${protocol}`
        }
      ]);
      expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: true });
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith(15, { active: true });
      expect(mocks.focus).toHaveBeenCalledExactlyOnceWith(4, { focused: true });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.options).not.toHaveBeenCalled();
    }
  );
  it('opens a clean same-protocol result tool if the initiating tool was closed', async () => {
    registerAuthorizationGuide(7, 'top');
    expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: true });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      url: 'chrome-extension://local-test-extension/authorization.html?protocol=top',
      active: true
    });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toMatch(/discover=|code=|state=|token/);
  });
  it('returns a registration guide to options through the worker, not the content script', async () => {
    registerAuthorizationGuide(7, null);
    expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: true });
    expect(mocks.options).toHaveBeenCalledOnce();
    expect(mocks.contexts).not.toHaveBeenCalled();
  });
  it.each([
    { ...sender, id: 'other-extension' },
    { ...sender, url: 'https://example.com/explore/open-api' },
    { ...sender, url: 'https://i.alibaba.com/other' },
    { ...sender, tab: { id: 8 } },
    { ...sender, frameId: 1 },
    { ...sender, frameId: undefined }
  ])('rejects an unbound or untrusted source without navigation', async (source) => {
    registerAuthorizationGuide(7, 'iop');
    expect(await returnFromAuthorizationGuide(source)).toEqual({ ok: false });
    expect(mocks.contexts).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('expires bindings, clears removed guides, and contains worker/navigation failures', async () => {
    vi.useFakeTimers();
    registerAuthorizationGuide(7, 'iop');
    vi.advanceTimersByTime(600_000);
    expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: false });
    registerAuthorizationGuide(7, 'iop');
    mocks.contexts.mockRejectedValueOnce(new Error('disconnected'));
    expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: false });
    forgetAuthorizationGuide(7);
    expect(await returnFromAuthorizationGuide(sender)).toEqual({ ok: false });
  });
});
