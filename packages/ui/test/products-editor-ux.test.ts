// @vitest-environment jsdom
import { defineComponent, h, type PropType } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  withProductSchemaFieldText,
  type OperationId,
  type RequestOf,
  type ResponseOf,
  type ProductSchemaModel
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import ProductsView from '../src/views/ProductsView.vue';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';
import { uiI18n } from '../src/i18n';

class SubmissionGateway extends MockGatewayClient {
  rejectUpdate: ((error: Error) => void) | undefined;
  override request<K extends OperationId>(operation: K, request: RequestOf<K>): Promise<ResponseOf<K>> {
    if (operation === 'updateProduct')
      return new Promise((_resolve, reject) => {
        this.rejectUpdate = reject;
      });
    return super.request(operation, request);
  }
}
const Wizard = defineComponent({
  props: { model: { type: Object as PropType<ProductSchemaModel>, required: true } },
  emits: ['update-field', 'submit'],
  setup(props, { emit }) {
    return () =>
      h('div', { 'data-testid': 'editor-stub' }, [
        h(
          'button',
          {
            'data-testid': 'edit-title',
            onClick: () => {
              const field = props.model.fields[0];
              if (field)
                emit('update-field', 0, withProductSchemaFieldText(field, 'Updated portable solar station'));
            }
          },
          'Edit title'
        ),
        h(
          'button',
          {
            'data-testid': 'submit-product',
            onClick: () => {
              emit('submit', false);
            }
          },
          'Submit'
        )
      ]);
  }
});
function mountEditor(gateway = new SubmissionGateway(0)) {
  const editing = new UnsavedEditingService();
  const Host = defineComponent({
    setup() {
      provideUnsavedEditing(editing);
      provideServices({
        gateway,
        mode: 'mock',
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: 'https://eco.taobao.com/router/rest',
              signMethod: 'hmac'
            }),
          save: () => Promise.resolve()
        },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({ operation, allowed: true, reasonCode: 'TEST_ALLOWED' }))
            })
        }
      });
      return () => h(ProductsView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [[VueQueryPlugin, { queryClient }]],
      stubs: {
        ProductEditorWizard: Wizard,
        ProductVideoAssociation: true,
        RowActionsMenu: { template: '<div><slot /></div>' }
      }
    }
  });
  return { wrapper, gateway, editing };
}
beforeEach(() => {
  localStorage.clear();
  uiI18n.global.locale.value = 'zh-CN';
  history.replaceState(null, '', '#/products/publisher/guided/basics/10000001/100003109');
});
afterEach(() => {
  document.body.innerHTML = '';
});
describe('product editor discard and submission diagnostics', () => {
  it('never restores or autosaves legacy drafts, does not fetch scores on open, and confirms leaving only after editing', async () => {
    localStorage.setItem('one-vegetable-product-schema-draft', 'preserved old draft');
    const gateway = new SubmissionGateway(0);
    const request = vi.spyOn(gateway, 'request');
    const { wrapper, editing } = mountEditor(gateway);
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(true);
    });
    expect(editing.dirty.value).toBe(false);
    expect(request.mock.calls.some(([operation]) => operation === 'getProductScore')).toBe(false);
    expect(wrapper.text()).not.toContain('继续本地草稿');
    const before = Object.fromEntries(
      Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])
    );
    await wrapper.get('[data-testid="edit-title"]').trigger('click');
    expect(editing.dirty.value).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(
      Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]))
    ).toEqual(before);
    const list = wrapper.findAll('button').find((button) => button.text() === '商品列表');
    await list?.trigger('click');
    expect(editing.confirmationOpen.value).toBe(true);
    editing.answer(false);
    await flushPromises();
    expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(true);
    await list?.trigger('click');
    editing.answer(true);
    await flushPromises();
    expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(false);
    expect(localStorage.getItem('one-vegetable-product-schema-draft')).toBe('preserved old draft');
    wrapper.unmount();
  });

  it('shows platform smart-description failure in a dialog, keeps diagnostics accessible and clears it for another editor', async () => {
    const { wrapper, gateway, editing } = mountEditor();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(true);
    });
    await wrapper.get('[data-testid="edit-title"]').trigger('click');
    await wrapper.get('[data-testid="submit-product"]').trigger('click');
    await vi.waitFor(() => {
      expect(gateway.rejectUpdate).toBeDefined();
    });
    gateway.rejectUpdate?.(new Error('PUB_BIZCHECK_MAGIC_EDIT_PAGE_RELATION_ERROR'));
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('平台拒绝：智能详情装修关联异常');
    });
    expect(document.body.textContent).toContain('不会自动删改详情或重新提交');
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="关闭商品提交失败"]');
    close?.click();
    await flushPromises();
    expect(wrapper.text()).toContain('查看提交错误');
    const restart = wrapper.findAll('button').find((button) => button.text().includes('重新新建'));
    await restart?.trigger('click');
    editing.answer(true);
    await flushPromises();
    expect(wrapper.text()).not.toContain('查看提交错误');
    wrapper.unmount();
  });

  it('discards a late submission failure after leaving the edited object', async () => {
    const { wrapper, gateway, editing } = mountEditor();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(true);
    });
    await wrapper.get('[data-testid="edit-title"]').trigger('click');
    await wrapper.get('[data-testid="submit-product"]').trigger('click');
    await vi.waitFor(() => {
      expect(gateway.rejectUpdate).toBeDefined();
    });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '商品列表')
      ?.trigger('click');
    editing.answer(true);
    await flushPromises();
    gateway.rejectUpdate?.(new Error('PUB_BIZCHECK_MAGIC_EDIT_PAGE_RELATION_ERROR'));
    await flushPromises();
    expect(document.body.textContent).not.toContain('平台拒绝：智能详情装修关联异常');
    wrapper.unmount();
  });
});
