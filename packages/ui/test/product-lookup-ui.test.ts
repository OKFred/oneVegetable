// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, ref } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { GatewayClient, RequestOf, SettingsRepository } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import fixture from '../../../mock/data/product-lookup.json';
import ProductLookupDialog from '../src/components/ProductLookupDialog.vue';
import QueryState from '../src/components/QueryState.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { uiI18n } from '../src/i18n';
import { productLookup as en } from '../src/i18n/messages/en-US/productLookup';
import { productLookup as zh } from '../src/i18n/messages/zh-CN/productLookup';

const wrappers: VueWrapper[] = [];
function envelope(data: unknown = fixture.response) {
  return { method: fixture.method, traceId: 'lookup-fixture', contractValid: true, contractIssues: [], data };
}
function setup(realDialog = false) {
  const open = ref(true);
  const boundary = ref('runtime-a');
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const request = vi.fn((_operation: unknown, payload: RequestOf<'callCapability'>) =>
    Promise.resolve(
      envelope(payload.parameters.page_index === 2 ? fixture.secondPageResponse : fixture.response)
    )
  );
  const contextRead = vi.fn((_operation?: unknown, _payload?: unknown) =>
    Promise.resolve({ identity: 'account-a', gateway: 'iop-a', storage: null })
  );
  const gateway = { request, galleryTransferContext: contextRead } as GatewayClient;
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({ gateway, settings: {} as SettingsRepository, mode: 'bff' });
        provideListIdentityScope(computed(() => boundary.value));
        return () => h(ProductLookupDialog, { open: open.value, onClose, onSelect });
      }
    }),
    {
      attachTo: document.body,
      global: {
        stubs: realDialog
          ? {}
          : {
              Dialog: {
                props: ['open', 'title'],
                template: '<section v-if="open" :aria-label="title"><slot /><slot name="footer" /></section>'
              }
            }
      }
    }
  );
  wrappers.push(wrapper);
  return { wrapper, request, contextRead, boundary, open, onClose, onSelect };
}
function button(wrapper: VueWrapper | DOMWrapper<Element>, text: string) {
  const found = wrapper.findAll('button').find((node) => node.text() === text);
  if (!found) throw new Error('Missing button: ' + text);
  return found;
}
async function search(wrapper: VueWrapper, value = fixture.queries.modelNumber) {
  await wrapper.get('input[aria-label="' + en.modelNumber + '"]').setValue(value);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('isolated product lookup dialog', () => {
  it('keeps Chinese and English catalogs aligned and distinguishes seller code from SKU ID', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const value of [...Object.values(en), ...Object.values(zh)]) expect(value.trim()).not.toBe('');
    expect(en.skuHint).toContain('not the numeric SKU ID');
    expect(zh.skuHint).toContain('不是数值 SKU ID');
  });
  it('does not read context or send business requests on open, typing or interface-language changes', async () => {
    const { wrapper, request, contextRead } = setup();
    await flushPromises();
    await wrapper.get('input[aria-label="' + en.modelNumber + '"]').setValue(fixture.queries.modelNumber);
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    await flushPromises();
    expect(wrapper.text()).toContain(zh.modelNumber);
    expect(wrapper.text()).toContain(zh.skuHint);
    expect(request).not.toHaveBeenCalled();
    expect(contextRead).not.toHaveBeenCalled();
  });
  it('blocks blank/both-field searches before context selection', async () => {
    const { wrapper, request, contextRead } = setup();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toBe(en.invalidQuery);
    await wrapper.get('input[aria-label="' + en.modelNumber + '"]').setValue(fixture.queries.modelNumber);
    await wrapper.get('input[aria-label="' + en.skuCode + '"]').setValue(fixture.queries.skuCode);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe(en.invalidQuery);
    expect(request).not.toHaveBeenCalled();
    expect(contextRead).not.toHaveBeenCalled();
  });
  it('searches by explicit submit and selects context with the exact actual native payload', async () => {
    const { wrapper, request, contextRead } = setup();
    await search(wrapper);
    const payload = {
      method: fixture.method,
      parameters: { model_number: fixture.queries.modelNumber, page_index: 1, page_size: 20 }
    };
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual(['callCapability', payload]);
    expect(contextRead).toHaveBeenCalledWith('callCapability', payload);
    expect(wrapper.text()).toContain(fixture.response.product_info[0]?.basic_info.title);
    expect(wrapper.text()).toContain('9007199254740993');
    expect(wrapper.text()).toContain(en.unknown);
    expect(wrapper.text()).not.toContain(fixture.privateMarker);
    expect(wrapper.text()).not.toContain('product_info');
  });
  it('uses Enter for SKU code without using sku_id or language parameters', async () => {
    const { wrapper, request } = setup();
    const input = wrapper.get('input[aria-label="' + en.skuCode + '"]');
    await input.setValue('  ' + fixture.queries.skuCode + '  ');
    expect(request).not.toHaveBeenCalled();
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(request.mock.calls[0]?.slice(0, 2)).toEqual([
      'callCapability',
      {
        method: fixture.method,
        parameters: { sku_code: fixture.queries.skuCode, page_index: 1, page_size: 20 }
      }
    ]);
  });
  it('emits a safe string product ID for viewing and performs no extra business read/write', async () => {
    const { wrapper, request, onSelect } = setup();
    await search(wrapper);
    const count = request.mock.calls.length;
    const view = wrapper.get('button[aria-label="' + en.view + ' 9007199254740993"]');
    await view.trigger('click');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('9007199254740993');
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('shows missing fields as unknown, without inventing an ID or a selectable action', async () => {
    const { wrapper, request, onSelect } = setup();
    request.mockResolvedValueOnce(envelope(fixture.minimalResponse));
    await search(wrapper);
    expect(wrapper.findAll('tbody td').filter((cell) => cell.text() === en.unknown).length).toBe(6);
    expect(wrapper.findAll('button').some((node) => node.text() === en.view)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(button(wrapper, en.next).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain(en.unknownTotal);
  });
  it('shows a genuine empty result without a scan or automatic next-page read', async () => {
    const { wrapper, request } = setup();
    request.mockResolvedValueOnce(envelope(fixture.emptyResponse));
    await search(wrapper);
    expect(wrapper.text()).toContain(en.empty);
    expect(button(wrapper, en.next).attributes('disabled')).toBeDefined();
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses explicit bounded pagination for the submitted criterion and disables the last next action', async () => {
    const { wrapper, request } = setup();
    await search(wrapper);
    expect(request).toHaveBeenCalledTimes(1);
    expect(button(wrapper, en.previous).attributes('disabled')).toBeDefined();
    await button(wrapper, en.next).trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]).toEqual({
      method: fixture.method,
      parameters: { model_number: fixture.queries.modelNumber, page_index: 2, page_size: 20 }
    });
    expect(wrapper.text()).toContain(fixture.secondPageResponse.product_info[0]?.basic_info.title);
    expect(button(wrapper, en.next).attributes('disabled')).toBeDefined();
  });
  it('updates result labels on locale change without new context/business reads', async () => {
    const { wrapper, request, contextRead } = setup();
    await search(wrapper);
    const calls = request.mock.calls.length;
    const contexts = contextRead.mock.calls.length;
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    await flushPromises();
    expect(wrapper.text()).toContain(zh.productTitle);
    expect(wrapper.text()).toContain(zh.view);
    expect(request).toHaveBeenCalledTimes(calls);
    expect(contextRead).toHaveBeenCalledTimes(contexts);
  });
  it('renders returned titles as text, not executable HTML', async () => {
    const { wrapper, request } = setup();
    const data = structuredClone(fixture.response);
    const first = data.product_info[0];
    if (!first) throw new Error('Missing fixture row');
    first.basic_info.title = fixture.unsafeTitle;
    request.mockResolvedValueOnce(envelope(data));
    await search(wrapper);
    expect(wrapper.text()).toContain(fixture.unsafeTitle);
    expect(wrapper.find('script').exists()).toBe(false);
  });
  it('does not retry business/transport errors and leaves an explicit search available', async () => {
    const { wrapper, request } = setup();
    request.mockResolvedValueOnce(envelope(fixture.businessRejectedResponse));
    await search(wrapper);
    expect(wrapper.findComponent(QueryState).props('error')).toBeInstanceOf(Error);
    expect(wrapper.find('tbody').exists()).toBe(false);
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(button(wrapper, en.search).attributes('disabled')).toBeUndefined();
    request.mockRejectedValueOnce(new Error('synthetic lookup failure'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(QueryState).props('error')).toBeInstanceOf(Error);
  });
  it('explains IOP-only authorization and does not dispatch a TOP request when context is denied', async () => {
    const { wrapper, request, contextRead } = setup();
    contextRead.mockRejectedValueOnce(
      new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        retryable: false
      })
    );
    await search(wrapper);
    expect(wrapper.text()).toContain(en.iopOnly);
    expect(wrapper.findComponent(QueryState).props('error')).toBeInstanceOf(Error);
    expect(request).not.toHaveBeenCalled();
  });
  it('drops late success after close and does not auto-search when reopened', async () => {
    const { wrapper, request, onClose, open } = setup();
    let finish: ((value: ReturnType<typeof envelope>) => void) | undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await search(wrapper);
    await button(wrapper, en.close).trigger('click');
    expect(onClose).toHaveBeenCalledTimes(1);
    finish?.(envelope());
    await flushPromises();
    expect(wrapper.find('tbody').exists()).toBe(false);
    open.value = false;
    await nextTick();
    open.value = true;
    await nextTick();
    expect(wrapper.find('tbody').exists()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['identity', 'configuration'] as const)(
    'closes and drops late results after %s changes',
    async (kind) => {
      const { wrapper, request, onClose, boundary } = setup();
      let finish: ((value: ReturnType<typeof envelope>) => void) | undefined;
      request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      await search(wrapper);
      if (kind === 'identity') boundary.value = 'runtime-b';
      else globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
      await nextTick();
      expect(onClose).toHaveBeenCalledTimes(1);
      finish?.(envelope());
      await flushPromises();
      expect(wrapper.find('tbody').exists()).toBe(false);
      expect(request).toHaveBeenCalledTimes(1);
    }
  );
  it('drops an older search when a new explicit query finishes first', async () => {
    const { wrapper, request } = setup();
    let finish: ((value: ReturnType<typeof envelope>) => void) | undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await search(wrapper);
    const newer = structuredClone(fixture.response);
    const first = newer.product_info[0];
    if (!first) throw new Error('Missing fixture row');
    first.basic_info.title = fixture.secondPageResponse.product_info[0]?.basic_info.title ?? '';
    request.mockResolvedValueOnce(envelope(newer));
    await search(wrapper, fixture.queries.skuCode);
    expect(wrapper.text()).toContain(first.basic_info.title);
    finish?.(envelope());
    await flushPromises();
    expect(wrapper.text()).toContain(first.basic_info.title);
    expect(wrapper.text()).not.toContain(fixture.response.product_info[0]?.basic_info.title);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('drops late rejection after a controlled close and disposal', async () => {
    const { wrapper, request, open, onSelect } = setup();
    let reject: ((cause: Error) => void) | undefined;
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    await search(wrapper);
    open.value = false;
    await nextTick();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    reject?.(new Error('synthetic late failure'));
    await flushPromises();
    expect(onSelect).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses the real accessible modal with named inputs and a close action', async () => {
    const { request, onClose } = setup(true);
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error('Missing real modal');
    const dom = new DOMWrapper(dialog);
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dom.get('input[aria-label="' + en.modelNumber + '"]').attributes('id')).toBeTruthy();
    expect(dom.get('input[aria-label="' + en.skuCode + '"]').attributes('id')).toBeTruthy();
    await button(dom, en.close).trigger('click');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
});
