// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../../mock/data/alibaba-auth/iop-app-reader.json';
import domFixtures from '../../../mock/data/alibaba-auth/iop-application-dom.json';
const mocks = vi.hoisted(() => ({ executeScript: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { scripting: { executeScript: mocks.executeScript } } }));
import { clickAlibabaGuidedTarget, clickAlibabaGuidedTargetInFrame } from '../lib/alibaba-guided-click';

function control(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error('Missing fixture control');
  return element;
}

function unsafeHref(index: number): string {
  const href = domFixtures.unsafeHrefs[index];
  if (!href) throw new Error('Missing unsafe-link fixture');
  return href;
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
  it('clicks the confirmed API configuration UL/LI application tab, not developer information', async () => {
    document.body.innerHTML = domFixtures.navigationHtml;
    const application = vi.fn();
    const developer = vi.fn();
    control('#center').onclick = application;
    control('#developer').onclick = developer;
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(true);
    expect(application).toHaveBeenCalledOnce();
    expect(developer).not.toHaveBeenCalled();
    expect(document.querySelector('[data-one-vegetable-guided-pointer]')).toBeNull();
  });

  it.each(['申请应用中心授权', '应用中心 Reset', 'Authorize', 'Reset'])(
    'requires an exact application navigation label, rejecting %s',
    async (label) => {
      document.body.innerHTML = domFixtures.navigationHtml;
      control('#center').textContent = label;
      const click = vi.fn();
      control('#center').onclick = click;
      expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
      expect(click).not.toHaveBeenCalled();
    }
  );

  it('does not click the LI if its label changes while the pointer moves', async () => {
    document.body.innerHTML = domFixtures.navigationHtml;
    const click = vi.fn();
    control('#center').onclick = click;
    const result = clickAlibabaGuidedTargetInFrame('application-center');
    control('#center').textContent = '开发人员信息';
    expect(await result).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('ignores hidden navigation lists and honors disabled list items', async () => {
    document.body.innerHTML = domFixtures.navigationHtml;
    control('ul').hidden = true;
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
    control('ul').hidden = false;
    control('#center').setAttribute('aria-disabled', 'true');
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
  });

  it('does not let a LI wrapper bypass an unsafe nested link', async () => {
    document.body.innerHTML = domFixtures.navigationHtml;
    const center = control('#center');
    const anchor = document.createElement('a');
    anchor.href = unsafeHref(5);
    anchor.textContent = center.textContent;
    center.replaceChildren(anchor);
    const click = vi.fn();
    center.onclick = click;
    expect(await clickAlibabaGuidedTargetInFrame('application-center')).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it.each(domFixtures.inertHrefs)(
    'permits only the AppKey-bound View no-op href %s, never Reset',
    async (href) => {
      document.body.innerHTML = domFixtures.secretHtml;
      const view = vi.fn((event: MouseEvent) => {
        event.preventDefault();
      });
      const reset = vi.fn();
      control('#view').setAttribute('href', href);
      control('#view').onclick = view;
      control('#reset').onclick = reset;
      expect(await clickAlibabaGuidedTargetInFrame('reveal-secret', domFixtures.appKey)).toBe(true);
      expect(view).toHaveBeenCalledOnce();
      expect(reset).not.toHaveBeenCalled();
    }
  );

  it.each(domFixtures.unsafeHrefs)('rejects View href %s without evaluating or clicking it', async (href) => {
    document.body.innerHTML = domFixtures.secretHtml;
    control('#view').setAttribute('href', href);
    const click = vi.fn();
    control('#view').onclick = click;
    expect(await clickAlibabaGuidedTargetInFrame('reveal-secret', domFixtures.appKey)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it.each([undefined, domFixtures.otherAppKey])(
    'requires the inspected AppKey for inert View (received %s)',
    async (appKey) => {
      document.body.innerHTML = domFixtures.secretHtml;
      const click = vi.fn();
      control('#view').onclick = click;
      expect(await clickAlibabaGuidedTargetInFrame('reveal-secret', appKey)).toBe(false);
      expect(click).not.toHaveBeenCalled();
    }
  );

  it('does not extend the inert href exception to application navigation', async () => {
    document.body.innerHTML = domFixtures.secretHtml;
    control('#view').textContent = '应用中心';
    const click = vi.fn();
    control('#view').onclick = click;
    expect(await clickAlibabaGuidedTargetInFrame('application-center', domFixtures.appKey)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['key', 'href', 'scope', 'label'] as const)(
    'rechecks %s before clicking inert View',
    async (changed) => {
      document.body.innerHTML = domFixtures.secretHtml;
      const click = vi.fn();
      control('#view').onclick = click;
      const result = clickAlibabaGuidedTargetInFrame('reveal-secret', domFixtures.appKey);
      if (changed === 'key') control('#key-value').textContent = domFixtures.otherAppKey;
      if (changed === 'href') control('#view').setAttribute('href', unsafeHref(0));
      if (changed === 'scope') control('[data-field="secret"] .form-label').textContent = 'Other settings';
      if (changed === 'label') control('#view').textContent = 'Reset';
      expect(await result).toBe(false);
      expect(click).not.toHaveBeenCalled();
    }
  );

  it('targets only the inspected frame and forwards its AppKey and deadline', async () => {
    mocks.executeScript.mockResolvedValueOnce([{ result: true }]);
    const deadline = Date.now() + 10_000;
    expect(await clickAlibabaGuidedTarget(7, 'reveal-secret', 12, domFixtures.appKey, deadline)).toBe(true);
    expect(mocks.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [12] },
      world: 'ISOLATED',
      func: clickAlibabaGuidedTargetInFrame,
      args: ['reveal-secret', domFixtures.appKey, deadline]
    });
  });

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
