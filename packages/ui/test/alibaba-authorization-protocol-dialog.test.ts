// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AlibabaAuthorizationProtocolDialog from '../src/components/AlibabaAuthorizationProtocolDialog.vue';
import { uiI18n } from '../src/i18n';

const unmount: (() => void)[] = [];
afterEach(() => {
  unmount.splice(0).forEach((dispose) => {
    dispose();
  });
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  uiI18n.global.locale.value = 'zh-CN';
});

async function dialog(purpose: 'acquire' | 'renew' = 'acquire') {
  const select = vi.fn();
  const wrapper = mount(AlibabaAuthorizationProtocolDialog, {
    props: { open: true, purpose, onSelect: select },
    attachTo: document.body
  });
  unmount.push(() => {
    wrapper.unmount();
  });
  await flushPromises();
  return { wrapper, select, body: new DOMWrapper(document.body) };
}

describe('Alibaba authorization protocol selection', () => {
  it.each(['iop', 'top'] as const)('only starts %s on the direct choice click stack', async (protocol) => {
    const view = await dialog();
    expect(view.body.text()).toContain('连接新版应用（推荐）');
    expect(view.body.text()).toContain('连接已有旧版应用');
    expect(view.body.text()).toContain('不会互相覆盖');
    expect(view.select).not.toHaveBeenCalled();
    let clicking = false;
    view.select.mockImplementation(() => {
      expect(clicking).toBe(true);
    });
    clicking = true;
    (view.body.get(`[data-testid="choose-authorization-${protocol}"]`).element as HTMLButtonElement).click();
    clicking = false;
    expect(view.select.mock.calls).toEqual([[protocol]]);
    expect(view.wrapper.emitted('update:open')).toEqual([[false]]);
  });

  it.each(['cancel', 'close', 'overlay', 'escape'] as const)(
    'dismisses with %s without selecting a protocol',
    async (action) => {
      const view = await dialog();
      if (action === 'cancel')
        await view.body.get('[data-testid="cancel-authorization-protocol"]').trigger('click');
      if (action === 'close') await view.body.get('[aria-label="关闭连接 Alibaba 账号"]').trigger('click');
      if (action === 'overlay') await view.body.get('.ov-dialog-overlay').trigger('click');
      if (action === 'escape') await view.body.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(view.wrapper.emitted('update:open')).toContainEqual([false]);
      expect(view.select).not.toHaveBeenCalled();
    }
  );

  it('supports the renewal purpose, English, and dark mode without an automatic selection', async () => {
    uiI18n.global.locale.value = 'en-US';
    document.documentElement.classList.add('dark');
    const view = await dialog('renew');
    expect(view.body.get('[role="dialog"]').text()).toContain('Which authorization do you want to renew?');
    expect(view.body.text()).toContain('Connect a new app (recommended)');
    expect(view.body.text()).toContain('Connect an existing legacy app');
    expect(view.body.text()).toContain('never replace each other');
    expect(view.select).not.toHaveBeenCalled();
  });
});
