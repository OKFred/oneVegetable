// @vitest-environment jsdom
import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDescriptionTemplate, ProductDescriptionTemplateClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import ProductDescriptionTemplatePanel from '../src/components/ProductDescriptionTemplatePanel.vue';
import { provideServices } from '../src/lib/services';
import {
  installEditingNavigationGuard,
  provideUnsavedEditing,
  UnsavedEditingService
} from '../src/lib/unsaved-editing';
import { uiI18n } from '../src/i18n';

const template: ProductDescriptionTemplate = {
  id: 'template-1',
  name: 'Company',
  category: 'company',
  language: 'en_US',
  html: '<p>Saved description</p>',
  status: 'active',
  remark: 'Saved remark',
  revision: 1,
  creatorId: 'test-user',
  updaterId: 'test-user',
  createTimeUtc: 1,
  updateTimeUtc: 1
};
const cleanups: (() => void)[] = [];
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
  history.replaceState(null, '', '#/products');
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
  history.replaceState(null, '', '#/dashboard');
  uiI18n.global.locale.value = 'zh-CN';
});

async function mountPanel() {
  const repository = {
    list: vi
      .fn<ProductDescriptionTemplateClient['list']>()
      .mockResolvedValue({ items: [template], page: 1, pageSize: 100, total: 1 }),
    create: vi.fn<ProductDescriptionTemplateClient['create']>().mockResolvedValue(template),
    update: vi.fn<ProductDescriptionTemplateClient['update']>().mockResolvedValue(template),
    archive: vi.fn<ProductDescriptionTemplateClient['archive']>().mockResolvedValue(template),
    restore: vi.fn<ProductDescriptionTemplateClient['restore']>().mockResolvedValue(template)
  };
  const editing = new UnsavedEditingService();
  const host = mount(
    defineComponent({
      setup() {
        provideUnsavedEditing(editing);
        provideServices({
          gateway: new MockGatewayClient(0),
          mode: 'bff',
          productDescriptionTemplates: repository,
          settings: {
            load: () =>
              Promise.resolve({
                appKey: '',
                appSecret: '',
                accessToken: '',
                endpoint: '',
                signMethod: 'hmac'
              }),
            save: () => Promise.resolve()
          }
        });
        return () =>
          h(ProductDescriptionTemplatePanel, {
            language: 'en_US',
            currentHtml: '<p>Current description</p>'
          });
      }
    }),
    { attachTo: document.body }
  );
  const wrapper = new DOMWrapper(document.body);
  cleanups.push(() => {
    host.unmount();
    editing.dispose();
  });
  function button(label: string) {
    const found = wrapper.findAll('button').find((item) => item.text() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  await button('Product description templates').trigger('click');
  await flushPromises();
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain('Create shared template');
  });
  return { wrapper, button, repository, editing };
}

describe('description template unsaved editing', () => {
  it.each(['Create shared template', 'Edit'])(
    'sets a clean %s baseline and tracks only business fields',
    async (action) => {
      const { wrapper, button, editing } = await mountPanel();
      await button(action).trigger('click');
      expect(editing.dirty.value).toBe(false);
      for (const [selector, value] of [
        ['input', 'Changed name'],
        ['select', 'logistics'],
        ['textarea', '<p>Changed HTML</p>'],
        ['input:last-of-type', 'Changed remark']
      ]) {
        if (!selector || !value) throw new Error('Missing field fixture');
        const field = selector === 'input:last-of-type' ? wrapper.findAll('input')[1] : wrapper.get(selector);
        if (!field) throw new Error('Missing field');
        const original = (field.element as HTMLInputElement).value;
        await field.setValue(value);
        expect(editing.dirty.value).toBe(true);
        await field.setValue(original);
        expect(editing.dirty.value).toBe(false);
      }
      uiI18n.global.locale.value = 'zh-CN';
      expect(editing.dirty.value).toBe(false);
    }
  );

  it.each(['close', 'overlay', 'escape', 'cancel'])(
    'guards %s and preserves edits when discard is declined',
    async (dismissal) => {
      const { wrapper, button, editing, repository } = await mountPanel();
      await button('Edit').trigger('click');
      await wrapper.get('textarea').setValue('<p>Unsaved HTML</p>');
      async function dismiss() {
        if (dismissal === 'cancel') await button('Cancel').trigger('click');
        else if (dismissal === 'overlay') await wrapper.get('.ov-dialog-overlay').trigger('click');
        else if (dismissal === 'escape')
          await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
        else
          await wrapper.get('button[aria-label="Close Edit shared description template"]').trigger('click');
        await flushPromises();
      }
      await dismiss();
      expect(editing.confirmationOpen.value).toBe(true);
      editing.answer(false);
      await flushPromises();
      expect(wrapper.get('textarea').element.value).toBe('<p>Unsaved HTML</p>');
      expect(editing.dirty.value).toBe(true);
      await dismiss();
      editing.answer(true);
      await flushPromises();
      expect(wrapper.find('textarea').exists()).toBe(false);
      expect(editing.dirty.value).toBe(false);
      if (dismissal !== 'cancel') await button('Product description templates').trigger('click');
      await button('Edit').trigger('click');
      expect(wrapper.get('textarea').element.value).toBe(template.html);
      expect(editing.dirty.value).toBe(false);
      expect(repository.update).not.toHaveBeenCalled();
    }
  );

  it.each(['Create shared template', 'Edit'])(
    'cleans %s only after a successful save, retaining failed edits',
    async (action) => {
      const { wrapper, button, editing, repository } = await mountPanel();
      const save = action === 'Edit' ? repository.update : repository.create;
      save.mockRejectedValueOnce(new Error('Template save failed'));
      await button(action).trigger('click');
      await wrapper.get('input').setValue('Changed name');
      await wrapper.get('textarea').setValue('<p>Changed HTML</p>');
      await button('Save shared template').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Template save failed');
      expect(wrapper.get('textarea').element.value).toBe('<p>Changed HTML</p>');
      expect(editing.dirty.value).toBe(true);
      await button('Cancel').trigger('click');
      expect(editing.confirmationOpen.value).toBe(true);
      editing.answer(false);
      await flushPromises();
      await button('Save shared template').trigger('click');
      await flushPromises();
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'Changed name', html: '<p>Changed HTML</p>' })
      );
      expect(editing.dirty.value).toBe(false);
      expect(wrapper.find('textarea').exists()).toBe(false);
    }
  );

  it('registers template edits with the existing global navigation guard', async () => {
    const { wrapper, button, editing } = await mountPanel();
    cleanups.push(installEditingNavigationGuard(editing));
    await button('Edit').trigger('click');
    await wrapper.get('textarea').setValue('<p>Unsaved HTML</p>');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    window.location.hash = '#/inventory';
    await vi.waitFor(() => {
      expect(editing.confirmationOpen.value).toBe(true);
    });
    editing.answer(false);
    await flushPromises();
    expect(window.location.hash).toBe('#/products');
    expect(wrapper.get('textarea').element.value).toBe('<p>Unsaved HTML</p>');
    window.location.hash = '#/inventory';
    await vi.waitFor(() => {
      expect(editing.confirmationOpen.value).toBe(true);
    });
    editing.answer(true);
    await flushPromises();
    expect(window.location.hash).toBe('#/inventory');
    expect(editing.dirty.value).toBe(false);
  });
});
