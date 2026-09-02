// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FeedbackLauncher from '../src/components/FeedbackLauncher.vue';

const captureMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/feedback-screenshot', () => ({
  captureFeedbackScreenshot: captureMock
}));

describe('FeedbackLauncher', () => {
  const clipboardWrite = vi.fn();
  const replace = vi.fn();
  const openWindow = vi.fn(() => ({ location: { replace }, opener: {} }));
  const createObjectUrl = vi.fn(() => 'blob:feedback-preview');
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    captureMock.mockReset();
    captureMock.mockResolvedValue({
      blob: new Blob(['png'], { type: 'image/png' }),
      fileName: 'one-vegetable-feedback.png',
      height: 720,
      width: 1280
    });
    clipboardWrite.mockReset();
    clipboardWrite.mockResolvedValue(undefined);
    replace.mockReset();
    openWindow.mockClear();
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    vi.stubGlobal('open', openWindow);
    vi.stubGlobal(
      'ClipboardItem',
      class ClipboardItemStub {
        constructor(readonly items: Record<string, Blob>) {}
      }
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { write: clipboardWrite }
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectUrl);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectUrl);
    globalThis.history.replaceState(null, '', '#/products/private-product-id');
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('captures only after the explicit action and opens a redacted prefilled issue', async () => {
    const host = document.createElement('div');
    host.dataset.feedbackCaptureRoot = '';
    document.body.append(host);
    const wrapper = mount(FeedbackLauncher, { attachTo: host, props: { mode: 'extension' } });

    await wrapper.get('[data-testid="feedback-launcher"]').trigger('click');
    expect(captureMock).not.toHaveBeenCalled();
    expect(findButton('复制截图并前往 GitHub粘贴').disabled).toBe(false);
    findButton('复制截图并前往 GitHub粘贴').click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('至少 3 个字的标题');
    expect(document.activeElement).toBe(document.body.querySelector('input[required]'));

    const inputs = document.body.querySelectorAll<HTMLInputElement>('input');
    const textareas = document.body.querySelectorAll<HTMLTextAreaElement>('textarea');
    await setNativeValue(inputs[0], '保存设置没有提示');
    await setNativeValue(textareas[0], '保存完成以后，页面没有提供任何反馈信息。');
    findButton('截取当前页面').click();
    await flushPromises();

    expect(captureMock).toHaveBeenCalledWith(host);
    expect(document.body.querySelector('img[alt="待提交的页面截图"]')).not.toBeNull();
    const acknowledgement = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!acknowledgement) throw new Error('Missing public feedback acknowledgement');
    findButton('复制截图并前往 GitHub粘贴').click();
    await flushPromises();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('可以公开提交');
    expect(document.activeElement).toBe(acknowledgement);
    acknowledgement.click();
    await flushPromises();
    expect(document.body.textContent).toContain('已准备好，可以复制截图并前往 GitHub粘贴');

    findButton('复制截图并前往 GitHub粘贴').click();
    await flushPromises();

    expect(clipboardWrite).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith('about:blank', '_blank');
    const issueUrl = new URL(String(replace.mock.calls[0]?.[0]));
    expect(issueUrl.origin + issueUrl.pathname).toBe('https://github.com/OKFred/oneVegetable/issues/new');
    expect(issueUrl.searchParams.get('environment')).toContain('Route: #/products');
    expect(issueUrl.href).not.toContain('private-product-id');
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:feedback-preview');
    wrapper.unmount();
  });

  it('downloads the screenshot when image clipboard access is rejected', async () => {
    clipboardWrite.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = document.createElement('div');
    host.dataset.feedbackCaptureRoot = '';
    document.body.append(host);
    const wrapper = mount(FeedbackLauncher, { attachTo: host, props: { mode: 'bff' } });

    await wrapper.get('[data-testid="feedback-launcher"]').trigger('click');
    const inputs = document.body.querySelectorAll<HTMLInputElement>('input');
    const textareas = document.body.querySelectorAll<HTMLTextAreaElement>('textarea');
    await setNativeValue(inputs[0], '截图复制失败');
    await setNativeValue(textareas[0], '模拟浏览器拒绝图片剪贴板权限后的下载回退。');
    findButton('截取当前页面').click();
    await flushPromises();
    document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    await flushPromises();
    findButton('复制截图并前往 GitHub粘贴').click();
    await flushPromises();

    expect(click).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});

function findButton(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent.includes(text)
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

async function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | undefined,
  value: string
): Promise<void> {
  if (!element) throw new Error('Missing feedback form field');
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}
