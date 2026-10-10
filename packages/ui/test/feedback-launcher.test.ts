// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackLauncher from '../src/components/FeedbackLauncher.vue';
import { uiI18n } from '../src/i18n';

const mocks = vi.hoisted(() => ({ capture: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../src/lib/feedback-screenshot', () => ({ captureFeedbackScreenshot: mocks.capture }));
vi.mock('vue-sonner', () => ({ toast: { success: mocks.success, warning: mocks.warning } }));

describe('FeedbackLauncher', () => {
  const clipboardWrite = vi.fn();
  const openWindow = vi.fn();
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    uiI18n.global.locale.value = 'zh-CN';
    mocks.capture.mockReset();
    mocks.capture.mockResolvedValue({
      blob: new Blob(['png'], { type: 'image/png' }),
      fileName: 'one-vegetable-feedback.png',
      height: 720,
      width: 1280
    });
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue(undefined);
    vi.stubGlobal('open', openWindow);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Blob>) {}
      }
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: clipboardWrite }
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:feedback-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectUrl);
    history.replaceState(null, '', '#/products/private-product-id');
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    uiI18n.global.locale.value = 'zh-CN';
  });

  async function harness(mode: 'extension' | 'bff' = 'extension') {
    const host = document.createElement('div');
    host.dataset.feedbackCaptureRoot = '';
    document.body.append(host);
    const wrapper = mount(FeedbackLauncher, { attachTo: host, props: { mode } });
    await wrapper.get('[data-testid="feedback-launcher"]').trigger('click');
    return { wrapper, host };
  }

  it('captures and copies only on explicit actions, without form fields or navigation', async () => {
    const { wrapper, host } = await harness();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(document.body.querySelector('input,textarea,select')).toBeNull();
    expect(findButton('复制截图').disabled).toBe(true);
    findButton('截取当前页面').click();
    await flushPromises();
    expect(mocks.capture).toHaveBeenCalledWith(host);
    expect(document.body.querySelector('img[alt="待提交的页面截图"]')).not.toBeNull();
    expect(clipboardWrite).not.toHaveBeenCalled();
    findButton('复制截图').click();
    await flushPromises();
    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('截图已复制'));
    expect(openWindow).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    findButton('关闭').click();
    await flushPromises();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:feedback-preview');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });

  it.each(['extension', 'bff'] as const)('offers a safe independent GitHub link in %s', async (mode) => {
    const { wrapper } = await harness(mode);
    const link = githubLink();
    const url = new URL(link.href);
    expect(url.origin + url.pathname).toBe('https://github.com/OKFred/oneVegetable/issues/new');
    expect([...url.searchParams.keys()]).toEqual(['template', 'environment']);
    expect(url.searchParams.get('environment')).toContain('Route: #/products');
    expect(url.href).not.toContain('private-product-id');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(githubLink().textContent).toContain('Leave feedback on GitHub');
    expect(new URL(githubLink().href).searchParams.get('environment')).toContain('UI locale: en-US');
    wrapper.unmount();
  });

  it('keeps GitHub available when capture fails', async () => {
    mocks.capture.mockRejectedValueOnce(new Error('capture failed'));
    const { wrapper } = await harness();
    findButton('截取当前页面').click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('直接前往 GitHub');
    expect(githubLink().href).toContain('github.com/OKFred/oneVegetable/issues/new');
    expect(findButton('复制截图').disabled).toBe(true);
    wrapper.unmount();
  });

  it('downloads on clipboard denial without navigating or discarding the preview', async () => {
    clipboardWrite.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { wrapper } = await harness('bff');
    findButton('截取当前页面').click();
    await flushPromises();
    findButton('复制截图').click();
    await flushPromises();
    expect(click).toHaveBeenCalledOnce();
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('截图已下载'));
    expect(openWindow).not.toHaveBeenCalled();
    expect(document.body.querySelector('img')).not.toBeNull();
    wrapper.unmount();
  });

  it('releases replaced and removed screenshots and never copies them automatically', async () => {
    const { wrapper } = await harness();
    findButton('截取当前页面').click();
    await flushPromises();
    findButton('重新截取').click();
    await flushPromises();
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    findButton('移除截图').click();
    await flushPromises();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(findButton('复制截图').disabled).toBe(true);
    expect(clipboardWrite).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

function findButton(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.trim() === text
  );
  if (!button) throw new Error('Missing button: ' + text);
  return button;
}

function githubLink(): HTMLAnchorElement {
  const link = document.body.querySelector<HTMLAnchorElement>('a[href^="https://github.com/"]');
  if (!link) throw new Error('Missing GitHub link');
  return link;
}
