// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref, type Component } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { GatewayClient, RequestOf, SettingsRepository } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { IOP_REFERENCE_METHODS } from '@one-vegetable/core/product-reference';
import examples from '../../../mock/data/product-reference/examples.json';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { uiI18n } from '../src/i18n';
import ProductReferenceTools from '../src/components/ProductReferenceTools.vue';
import ProductReferenceDrawer from '../src/components/ProductReferenceDrawer.vue';
import ProductCategoryReference from '../src/components/ProductCategoryReference.vue';
import ProductShippingReference from '../src/components/ProductShippingReference.vue';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { productReference as zh } from '../src/i18n/messages/zh-CN/productReference';
import { productReference as en } from '../src/i18n/messages/en-US/productReference';
import {
  productReferenceAuditStateLabel,
  productReferenceOnlineStateLabel,
  productStatusLabel
} from '../src/lib/product-status';

const fixtures: Record<string, { response: unknown }> = examples;
const wrappers: VueWrapper[] = [];
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  vi.restoreAllMocks();
});
function setup(component: unknown, props: Record<string, unknown> = {}, denied = false) {
  const boundary = ref('runtime-a');
  const request = vi.fn((_operation: unknown, payload: RequestOf<'callCapability'>) =>
    Promise.resolve({
      method: payload.method,
      traceId: 'fixture',
      contractValid: true,
      contractIssues: [],
      data: structuredClone(fixtures[payload.method]?.response)
    })
  );
  const contextRead = vi.fn(() =>
    Promise.resolve({ identity: 'account-a', gateway: 'iop-a', storage: null })
  );
  if (denied)
    contextRead.mockRejectedValue(
      new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'IOP required',
        retryable: false
      })
    );
  const gateway: GatewayClient = { request, galleryTransferContext: contextRead };
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({ gateway, settings: {} as SettingsRepository, mode: 'bff' });
        provideListIdentityScope(computed(() => boundary.value));
        return () => h(component as Component, props);
      }
    }),
    {
      global: {
        stubs: {
          Sheet: { template: '<section><slot /></section>' },
          Tooltip: { template: '<span><slot /></span>' },
          ActionTooltip: { template: '<span><slot /></span>' }
        }
      }
    }
  );
  wrappers.push(wrapper);
  return { wrapper, request, contextRead, boundary };
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text);
  if (!found) throw new Error('Missing button: ' + text);
  return found;
}
const categoryProps = { title: '', description: '', imageUrl: '', categoryId: '', disabled: false };
describe('product reference UI', () => {
  it('keeps the reference label catalogs aligned and nonempty', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(zh), ...Object.values(en)]) expect(value.trim()).not.toBe('');
  });
  it('keeps the shipping launcher lazy until clicked', async () => {
    const { wrapper, request } = setup(ProductReferenceTools, { kind: 'shipping' });
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
    await button(wrapper, 'Shipping template reference').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.listShippingTemplates,
      parameters: {}
    });
  });
  it('shows allowlisted product fields, sanitizes HTML and changes labels without reads', async () => {
    const { wrapper, request } = setup(ProductReferenceDrawer, { productId: '880001' });
    const raw = structuredClone(examples['/alibaba/icbu/product/get/v2'].response);
    raw.product_info.basic_info.description =
      '<p>Safe description</p><script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">unsafe</a>';
    Object.assign(raw.product_info, { owner_account: 'PRIVATE_OWNER_ACCOUNT' });
    request.mockResolvedValueOnce({
      method: IOP_REFERENCE_METHODS.getProduct,
      traceId: 'safe',
      contractValid: true,
      contractIssues: [],
      data: raw
    });
    await flushPromises();
    expect(wrapper.text()).toContain('Unbranded glass cup');
    expect(wrapper.text()).toContain('Online state');
    expect(wrapper.text()).toContain('Audit state');
    expect(wrapper.text()).toContain('1767225600000');
    expect(wrapper.text()).toContain('Creation timestamp (raw)');
    expect(wrapper.text()).toContain('Modification timestamp (raw)');
    expect(wrapper.text()).toContain('no date conversion has been applied');
    const online = wrapper.findAll('dt').find((item) => item.text() === 'Online state');
    expect(online?.element.nextElementSibling?.textContent).toBe(productStatusLabel('online'));
    const audit = wrapper.findAll('dt').find((item) => item.text() === 'Audit state');
    expect(audit?.element.nextElementSibling?.textContent).toBe('Approved');
    expect(wrapper.text()).toContain('CUP-CLEAR');
    expect(wrapper.text()).toContain('General attributes');
    expect(wrapper.text()).toContain('Sale attributes');
    expect(wrapper.text()).not.toContain('product_info');
    expect(wrapper.text()).not.toContain('PRIVATE_OWNER_ACCOUNT');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Safe description');
    expect(wrapper.text()).toContain('—');
    const count = request.mock.calls.length;
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    expect(wrapper.text()).toContain('一般属性');
    expect(wrapper.text()).toContain('创建时间戳（原始值）');
    expect(wrapper.text()).toContain('单位与时区尚未核实');
    expect(wrapper.text()).toContain('审核通过');
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('predicts from entered data but applies only after explicit confirmation', async () => {
    const applyCategory = vi.fn(() => Promise.resolve(false));
    const { wrapper, request } = setup(ProductCategoryReference, { ...categoryProps, applyCategory });
    expect(request).not.toHaveBeenCalled();
    await wrapper.get('input[aria-label="Product title (required)"]').setValue('Glass cup');
    await wrapper.get('textarea').setValue('Reusable cup');
    await wrapper
      .get('input[aria-label="Existing HTTPS image URL (optional)"]')
      .setValue('https://images.example.com/cup.png');
    await button(wrapper, 'Recommend category').trigger('click');
    await flushPromises();
    // Core rejects non-gallery URLs without a provider request.
    expect(request).not.toHaveBeenCalled();
    await wrapper.get('input[aria-label="Existing HTTPS image URL (optional)"]').setValue('');
    await button(wrapper, 'Recommend category').trigger('click');
    await flushPromises();
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.predictCategory,
      parameters: { title: 'Glass cup', description: 'Reusable cup' }
    });
    expect(wrapper.text()).toContain('Home / Drinkware / Drinking Glasses');
    expect(applyCategory).not.toHaveBeenCalled();
    await button(wrapper, 'Confirm category and load form').trigger('click');
    await flushPromises();
    expect(applyCategory).toHaveBeenCalledWith({
      categoryId: '220001',
      categoryName: 'Drinking Glasses',
      categoryPath: 'Home / Drinkware / Drinking Glasses'
    });
    await wrapper.get('input[aria-label="Product title (required)"]').setValue('Different product');
    expect(wrapper.text()).not.toContain('Confirm category and load form');
  });
  it('browses one parent at a time and reads general/sale attributes only on demand', async () => {
    const { wrapper, request } = setup(ProductCategoryReference, categoryProps);
    expect(request).not.toHaveBeenCalled();
    await button(wrapper, 'Browse v2 categories').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    await button(wrapper, 'View children').trigger('click');
    await flushPromises();
    expect(request.mock.calls[1]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.listCategories,
      parameters: { parent_category_id: '220000' }
    });
    const inspect = wrapper
      .findAll('button')
      .filter((item) => item.text() === 'Attribute reference')
      .at(-1);
    await inspect?.trigger('click');
    await flushPromises();
    expect(request.mock.calls[2]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.getAttributes,
      parameters: { category_id: '220001' }
    });
    expect(wrapper.text()).toContain('General attributes');
    expect(wrapper.text()).toContain('Sale attributes');
    expect(wrapper.text()).toContain('Custom values');
    expect(wrapper.text()).toContain('Multiple values');
    expect(wrapper.text()).toContain('Reference only');
  });
  it('offers attribute reads only for categories whose leaf metadata is known', async () => {
    const { wrapper, request } = setup(ProductCategoryReference, categoryProps);
    request.mockResolvedValueOnce({
      method: IOP_REFERENCE_METHODS.listCategories,
      traceId: 'leaf-flags',
      contractValid: true,
      contractIssues: [],
      data: {
        success: true,
        data: [
          { category_id: 220000, category_name: 'Non-leaf', leaf_category: false },
          { category_id: 220001, category_name: 'Known leaf', leaf_category: true },
          { category_id: 220002, category_name: 'Unknown leaf status' }
        ]
      }
    });
    await button(wrapper, 'Browse v2 categories').trigger('click');
    await flushPromises();
    const rows = wrapper.findAll('li');
    expect(rows).toHaveLength(3);
    for (const index of [0, 2]) {
      expect(rows[index]?.findAll('button').some((item) => item.text() === 'Attribute reference')).toBe(
        false
      );
    }
    const attributes = rows[1]?.findAll('button').find((item) => item.text() === 'Attribute reference');
    expect(attributes).toBeTruthy();
    await attributes?.trigger('click');
    await flushPromises();
    expect(request.mock.calls[1]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.getAttributes,
      parameters: { category_id: '220001' }
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not infer leaf status from a category prediction', async () => {
    const { wrapper, request } = setup(ProductCategoryReference, categoryProps);
    await wrapper.get('input[aria-label="Product title (required)"]').setValue('Glass cup');
    await button(wrapper, 'Recommend category').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Home / Drinkware / Drinking Glasses');
    expect(wrapper.findAll('button').some((item) => item.text() === 'Attribute reference')).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('localizes only exact documented online states and preserves other native enums', () => {
    for (const status of ['online', 'offline'] as const) {
      expect(productReferenceOnlineStateLabel(status)).toBe(productStatusLabel(status));
      expect(productReferenceOnlineStateLabel(status.toUpperCase())).toBe(status.toUpperCase());
    }
    expect(productReferenceOnlineStateLabel('deleted')).toBe('Deleted');
    for (const status of [
      'draft',
      'auditing',
      'rejected',
      'unknown',
      'DELETED',
      ' online ',
      'FUTURE_NATIVE_STATE'
    ]) {
      expect(productReferenceOnlineStateLabel(status)).toBe(status);
    }
    uiI18n.global.locale.value = 'zh-CN';
    expect(productReferenceOnlineStateLabel('online')).toBe(productStatusLabel('online'));
    expect(productReferenceOnlineStateLabel('deleted')).toBe('已删除');
    expect(productReferenceOnlineStateLabel('rejected')).toBe('rejected');
    expect(productReferenceOnlineStateLabel(null)).toBe('—');
  });
  it('localizes exact audit enums independently and keeps unknown/case-drifted values verbatim', () => {
    for (const [value, label] of [
      ['approved', 'Approved'],
      ['pending', 'Pending review'],
      ['rejected', 'Rejected']
    ]) {
      expect(productReferenceAuditStateLabel(value ?? null)).toBe(label);
    }
    for (const value of [
      'APPROVED',
      'PENDING',
      'REJECTED',
      'review',
      'online',
      ' approved ',
      'FUTURE_AUDIT_STATE'
    ]) {
      expect(productReferenceAuditStateLabel(value)).toBe(value);
    }
    uiI18n.global.locale.value = 'zh-CN';
    expect(productReferenceAuditStateLabel('approved')).toBe('审核通过');
    expect(productReferenceAuditStateLabel('pending')).toBe('待审核');
    expect(productReferenceAuditStateLabel('rejected')).toBe('审核拒绝');
    expect(productReferenceAuditStateLabel('online')).toBe('online');
    expect(productReferenceAuditStateLabel(null)).toBe('—');
  });
  it('retains editable user title markers and displays provider timeout without automatic retry', async () => {
    const { wrapper, request } = setup(ProductCategoryReference, categoryProps);
    const entered = '[REFERENCE-TEST] Stemmed Drinking Glass #keep-marker';
    const input = wrapper.get('input[aria-label="Product title (required)"]');
    await input.setValue(entered);
    request.mockRejectedValueOnce(
      new GatewayException({
        code: 'ALIBABA_IOP_API_REJECTED',
        message: 'ServiceTimeout',
        retryable: false
      })
    );
    await button(wrapper, 'Recommend category').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.predictCategory,
      parameters: { title: entered }
    });
    expect((input.element as HTMLInputElement).value).toBe(entered);
    expect(input.attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('ServiceTimeout');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    await input.setValue('Stemmed Drinking Glass');
    await button(wrapper, 'Recommend category').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toEqual({
      method: IOP_REFERENCE_METHODS.predictCategory,
      parameters: { title: 'Stemmed Drinking Glass' }
    });
  });
  it('searches shipping names/IDs and copies without changing Schema or using TOP templates', async () => {
    const copy = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    const { wrapper, request } = setup(ProductShippingReference);
    await flushPromises();
    await wrapper.get('input').setValue('550002');
    expect(wrapper.text()).toContain('Express shipping');
    expect(wrapper.text()).not.toContain('Standard shipping');
    await button(wrapper, 'Copy ID').trigger('click');
    expect(copy).toHaveBeenCalledWith('550002');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe('callCapability');
  });
  it('clears reference state on runtime/configuration changes and drops late results', async () => {
    const { wrapper, request, boundary } = setup(ProductReferenceDrawer, { productId: '880001' });
    let finish: (() => void) | undefined;
    const pause = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const response = request.getMockImplementation();
    if (!response) throw new Error('Missing fixture response');
    request.mockImplementationOnce(async (...args) => {
      await pause;
      return response(...args);
    });
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    boundary.value = 'runtime-b';
    await nextTick();
    finish?.();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Unbranded glass cup');
    expect(wrapper.findComponent(ProductReferenceDrawer).emitted('close')).toBeTruthy();
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await nextTick();
    expect(wrapper.text()).not.toContain('Unbranded glass cup');
  });
  it('explains IOP-only availability without sending a TOP business request', async () => {
    const { wrapper, request } = setup(ProductShippingReference, {}, true);
    await flushPromises();
    expect(wrapper.text()).toContain('This reference requires IOP authorization');
    expect(wrapper.text()).not.toContain('Standard shipping');
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['product', 'category', 'shipping'] as const)(
    'does not issue %s business or context calls on uiLocale changes',
    async (kind) => {
      const component: unknown =
        kind === 'product'
          ? ProductReferenceDrawer
          : kind === 'category'
            ? ProductCategoryReference
            : ProductShippingReference;
      const props = kind === 'product' ? { productId: '880001' } : kind === 'category' ? categoryProps : {};
      const { wrapper, request, contextRead } = setup(component, props);
      await flushPromises();
      const calls = request.mock.calls.length;
      const contexts = contextRead.mock.calls.length;
      uiI18n.global.locale.value = 'zh-CN';
      await nextTick();
      await flushPromises();
      expect(request).toHaveBeenCalledTimes(calls);
      expect(contextRead).toHaveBeenCalledTimes(contexts);
      if (kind === 'shipping') expect(wrapper.text()).toContain('搜索');
    }
  );
});
