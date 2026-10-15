// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/iop-app-reader.json';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { clickAlibabaGuidedTargetInFrame } from '../lib/alibaba-guided-click';

function control(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error('Missing fixture control');
  return element;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = fixtures.centerHtml;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 10,
    width: 100,
    height: 30
  } as DOMRect);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((): Element | null => document.querySelector('#center, #view'))
  });
});
describe('visible read-only click guide', () => {
  it('shows a pointer/highlight during the actual click and removes it afterwards', async () => {
    const button = control('#center');
    let pointerPresent = false;
    button.onclick = () => {
      pointerPresent = !!document.querySelector('[data-one-vegetable-guided-pointer]');
    };
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(true);
    expect(pointerPresent).toBe(true);
    expect(document.querySelector('[data-one-vegetable-guided-pointer]')).toBeNull();
  });
  it('clicks View, never Reset', async () => {
    document.body.innerHTML = fixtures.secretHtml;
    const view = vi.fn();
    const reset = vi.fn();
    control('#view').onclick = view;
    control('#reset').onclick = reset;
    expect(await clickAlibabaGuidedTargetInFrame('reveal-secret')).toBe(true);
    expect(view).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });
  it.each(['Reset', 'Authorize'])(
    'does not click when View changes into %s while the pointer moves',
    async (label) => {
      document.body.innerHTML = fixtures.secretHtml;
      const view = control('#view');
      const click = vi.fn();
      view.onclick = click;
      const result = clickAlibabaGuidedTargetInFrame('reveal-secret');
      view.textContent = label;
      expect(await result).toBe(false);
      expect(click).not.toHaveBeenCalled();
      expect(document.querySelector('[data-one-vegetable-guided-pointer]')).toBeNull();
    }
  );

  it('does not click if the application-center href changes during pointer movement', async () => {
    document.body.innerHTML = '<a id="center" href="https://openapi.alibaba.com/app/">应用中心</a>';
    const target = control('#center');
    const click = vi.fn();
    target.onclick = click;
    const result = clickAlibabaGuidedTargetInFrame('application-center');
    target.setAttribute('href', 'https://crosstrade.alibaba.com/ecology/index.htm');
    expect(await result).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('does not click after the reader deadline has expired', async () => {
    document.body.innerHTML = fixtures.secretHtml;
    const click = vi.fn();
    control('#view').onclick = click;
    expect(await clickAlibabaGuidedTargetInFrame('reveal-secret', undefined, Date.now() - 1)).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('[data-one-vegetable-guided-pointer]')).toBeNull();
  });
  it('does not click a control hidden by a security dialog', async () => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body });
    const click = vi.fn();
    control('#center').onclick = click;
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('[data-one-vegetable-guided-pointer]')).toBeNull();
  });
  it('never clicks OAuth approval, disabled controls or external legacy links', async () => {
    const button = control('#center');
    button.setAttribute('disabled', '');
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
    document.body.innerHTML = '<button>Authorize</button>';
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
    document.body.innerHTML = '<a href="https://crosstrade.alibaba.com/ecology/index.htm">应用中心</a>';
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
  });
});
