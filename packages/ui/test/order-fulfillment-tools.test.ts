// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { GatewayClient, SettingsRepository } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { FULFILLMENT_READ_METHODS as methods } from '../../core/src/order-fulfillment-methods';
import OrderFulfillmentToolsDialog from '../src/components/OrderFulfillmentToolsDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { uiI18n } from '../src/i18n';
import { orderFulfillmentMessages as messages } from '../src/i18n/order-fulfillment';

interface ReadResult {
  method: string;
  traceId: string;
  data: Record<string, unknown>;
}
const client = vi.hoisted(() => ({
  query: vi.fn<(method: string, parameters: Record<string, unknown>) => Promise<ReadResult>>(),
  invalidate: vi.fn(),
  dispose: vi.fn(),
  failureToast: vi.fn()
}));
vi.mock('../../core/src/order-fulfillment-read', () => ({
  OrderFulfillmentReadClient: class {
    query = client.query;
    invalidate = client.invalidate;
    dispose = client.dispose;
  }
}));
vi.mock('vue-sonner', () => ({ toast: { error: client.failureToast } }));
const wrappers: VueWrapper[] = [];
const hosts: HTMLElement[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  uiI18n.global.locale.value = 'en-US';
  client.query.mockResolvedValue({
    method: methods.warehouses,
    traceId: 'fixture-trace',
    data: {
      response: {
        records: [{ name: 'Fixture warehouse', address: '<img src=x onerror=alert(1)>', warehouse_id: '123' }]
      }
    }
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
});
function setup(initial: { open?: boolean; productId?: string; orderId?: string } = {}, realDialog = false) {
  const identity = ref('fixture-identity');
  const props = reactive({ productId: '12345', orderId: 'encrypted-order-id', ...initial });
  const onClose = vi.fn();
  const request = vi.fn();
  const context = vi.fn();
  const host = document.createElement('div');
  hosts.push(host);
  document.body.append(host);
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway: { request: request as GatewayClient['request'], galleryTransferContext: context },
          settings: {} as SettingsRepository,
          mode: 'bff'
        });
        provideListIdentityScope(computed(() => identity.value));
        return () => h(OrderFulfillmentToolsDialog, { ...props, onClose });
      }
    }),
    {
      attachTo: host,
      global: {
        stubs: realDialog
          ? {}
          : {
              ModalDialog: {
                props: ['open', 'title'],
                emits: ['update:open'],
                template:
                  '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot/><slot name="footer"/></section>'
              }
            }
      }
    }
  );
  wrappers.push(wrapper);
  return { wrapper, identity, props, onClose, request, context };
}
function value(wrapper: VueWrapper, field: string): string {
  return (wrapper.get('[data-field="' + field + '"]').element as HTMLInputElement).value;
}
async function selectTab(wrapper: VueWrapper, tab: string) {
  await wrapper.get('[data-tab="' + tab + '"]').trigger('click');
}
async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
}
describe('order fulfillment read-only tools', () => {
  it('keeps independent English and Chinese messages complete', () => {
    expect(Object.keys(messages['en-US']).sort()).toEqual(Object.keys(messages['zh-CN']).sort());
    for (const catalog of Object.values(messages))
      for (const message of Object.values(catalog)) expect(message.trim()).not.toBe('');
  });
  it('opens by default with three tabs and makes no reads on opening or switching', async () => {
    const { wrapper, request, context } = setup();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-tab]')).toHaveLength(3);
    for (const tab of ['freight', 'tracking', 'warehouses']) await selectTab(wrapper, tab);
    await wrapper.get('[data-field="warehouseKind"]').setValue('ggs');
    await flushPromises();
    expect(client.query).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('TOP-only configurations need IOP');
    expect(wrapper.text()).toContain('No automatic protocol fallback');
  });
  it('does not read while initially closed', async () => {
    const { wrapper } = setup({ open: false });
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(client.query).not.toHaveBeenCalled();
  });
  it('queries standard warehouses only on submit and renders fields as literal text', async () => {
    const { wrapper } = setup();
    await wrapper.get('[data-field="countryCode"]').setValue('de');
    await submit(wrapper);
    expect(client.query).toHaveBeenCalledExactlyOnceWith(methods.warehouses, {
      product_id: '12345',
      country_code: 'DE',
      current_page: 1
    });
    const result = wrapper.get('[data-result="fulfillment"]');
    expect(result.findAll('dl dd').map((field) => field.text())).toContain('Fixture warehouse');
    expect(result.text()).toContain('<img src=x onerror=alert(1)>');
    expect(result.findAll('img,script,iframe,a')).toHaveLength(0);
    expect(result.text()).toContain('fixture-trace');
    expect(result.attributes('data-feedback-redact')).toBeDefined();
    expect(result.get('[data-result="raw"]').element.tagName).toBe('DETAILS');
    expect((result.get('[data-result="raw"]').element as HTMLDetailsElement).open).toBe(false);
  });
  it('keeps normal and GGS pages independent without querying on pagination', async () => {
    const { wrapper } = setup();
    await wrapper.get('[data-field="currentPage"]').setValue('3');
    await wrapper.get('[data-field="warehouseKind"]').setValue('ggs');
    expect(value(wrapper, 'currentPage')).toBe('1');
    await wrapper.get('[data-action="next"]').trigger('click');
    expect(value(wrapper, 'currentPage')).toBe('2');
    expect(client.query).not.toHaveBeenCalled();
    await submit(wrapper);
    expect(client.query).toHaveBeenLastCalledWith(methods.ggsWarehouses, {
      product_id: '12345',
      page_size: 10,
      current_page: 2
    });
    await wrapper.get('[data-field="warehouseKind"]').setValue('normal');
    expect(value(wrapper, 'currentPage')).toBe('3');
    await wrapper.get('[data-action="previous"]').trigger('click');
    expect(value(wrapper, 'currentPage')).toBe('2');
    expect(wrapper.find('[data-result="fulfillment"]').exists()).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it.each(['encrypted-id', '1e3', '1.5', '-1', '0', '001', '9007199254740992'])(
    'rejects unsafe product ID %s before querying',
    async (id) => {
      const { wrapper } = setup({ productId: id });
      expect(wrapper.get('[data-action="query"]').attributes('disabled')).toBeDefined();
      await submit(wrapper);
      expect(client.query).not.toHaveBeenCalled();
    }
  );
  it('sends basic freight parameters and displays only returned amount and currency', async () => {
    const { wrapper } = setup();
    await selectTab(wrapper, 'freight');
    await wrapper.get('[data-field="destinationCountry"]').setValue('jp');
    await wrapper.get('[data-field="quantity"]').setValue('4');
    await wrapper.get('[data-field="zipCode"]').setValue('100-0001');
    await wrapper.get('[data-field="dispatchLocation"]').setValue('CN');
    client.query.mockResolvedValueOnce({
      method: methods.basicFreight,
      traceId: 'freight-trace',
      data: {
        value: [
          {
            vendor_name: 'Fixture carrier',
            fee: { amount: '12.34', currency: 'JPY' },
            freight_determinate: false
          }
        ]
      }
    });
    await submit(wrapper);
    expect(client.query).toHaveBeenCalledExactlyOnceWith(methods.basicFreight, {
      product_id: '12345',
      quantity: 4,
      destination_country: 'JP',
      zip_code: '100-0001',
      dispatch_location: 'CN'
    });
    const fields = wrapper
      .get('[data-result="fulfillment"]')
      .findAll('dl dd')
      .map((field) => field.text());
    expect(fields).toEqual(expect.arrayContaining(['Fixture carrier', '12.34', 'JPY', 'No']));
    expect(wrapper.text()).not.toContain('USD');
    expect(wrapper.text()).toContain('Logistics determinacy is not a freight quote');
    expect(wrapper.get('[data-field="zipCode"]').attributes('data-feedback-redact')).toBeDefined();
    expect(wrapper.get('[data-field="destinationCountry"]').attributes('data-feedback-redact')).toBeDefined();
  });
  it.each(['0', '-2', '1.5', '1e3', '9007199254740992'])(
    'requires an integer quantity: %s',
    async (quantity) => {
      const { wrapper } = setup();
      await selectTab(wrapper, 'freight');
      await wrapper.get('[data-field="destinationCountry"]').setValue('DE');
      await wrapper.get('[data-field="quantity"]').setValue(quantity);
      await submit(wrapper);
      expect(client.query).not.toHaveBeenCalled();
    }
  );
  it('fills only the current product in advanced parameters and never fabricates enterprise IDs', async () => {
    const { wrapper } = setup();
    await selectTab(wrapper, 'freight');
    await wrapper.get('[data-field="freightKind"]').setValue('advanced');
    await wrapper.get('[data-action="fillProduct"]').trigger('click');
    expect(JSON.parse(value(wrapper, 'parameters'))).toEqual({
      logistics_product_list: [{ product_id: '12345', quantity: 1 }]
    });
    await submit(wrapper);
    expect(client.query).not.toHaveBeenCalled();
    const parameters = {
      e_company_id: 'fixture-real-company',
      destination_country: 'DE',
      address: { city: { name: 'Fixture city' }, zip: '10000' },
      logistics_product_list: [{ product_id: '555', quantity: 3, sku_id: '777' }]
    };
    await wrapper.get('[data-field="parameters"]').setValue(JSON.stringify(parameters));
    await wrapper.get('[data-action="fillProduct"]').trigger('click');
    await submit(wrapper);
    expect(client.query).toHaveBeenCalledExactlyOnceWith(methods.advancedFreight, {
      ...parameters,
      logistics_product_list: [{ product_id: '12345', quantity: 3, sku_id: '777' }]
    });
    expect(wrapper.get('[data-field="parameters"]').attributes('data-feedback-redact')).toBeDefined();
    expect(wrapper.text()).toContain('actual destination');
  });
  it.each(['{broken', '[]', 'null', '{}', '{"e_company_id":"real","logistics_product_list":[]}'])(
    'blocks incomplete advanced parameters: %s',
    async (parameters) => {
      const { wrapper } = setup();
      await selectTab(wrapper, 'freight');
      await wrapper.get('[data-field="freightKind"]').setValue('advanced');
      await wrapper.get('[data-field="parameters"]').setValue(parameters);
      await submit(wrapper);
      expect(client.query).not.toHaveBeenCalled();
    }
  );
  it.each(['encrypted-order-id', '1e5', '1.2', '9007199254740992', '0', '001'])(
    'never coerces an unsafe order ID %s',
    async (orderId) => {
      const { wrapper } = setup({ orderId });
      await selectTab(wrapper, 'tracking');
      expect(value(wrapper, 'tradeId')).toBe('');
      await wrapper.get('[data-field="tradeId"]').setValue(orderId);
      await submit(wrapper);
      expect(client.query).not.toHaveBeenCalled();
    }
  );
  it('prefills real numeric trade IDs and renders tracking events without creating links', async () => {
    const { wrapper } = setup({ orderId: '987654' });
    await selectTab(wrapper, 'tracking');
    expect(value(wrapper, 'tradeId')).toBe('987654');
    client.query.mockResolvedValueOnce({
      method: methods.tracking,
      traceId: 'tracking-trace',
      data: {
        tracking_list: [
          {
            carrier: 'Fixture carrier',
            tracking_number: 'TRACK-1',
            tracking_url: 'javascript:alert(1)',
            event_list: [
              { event_name: 'Collected', event_location: 'Fixture city', event_time: '2026-01-01' }
            ]
          }
        ]
      }
    });
    await submit(wrapper);
    expect(client.query).toHaveBeenCalledExactlyOnceWith(methods.tracking, { trade_id: '987654' });
    const result = wrapper.get('[data-result="fulfillment"]');
    const fields = result.findAll('dl dd').map((field) => field.text());
    expect(fields).toEqual(expect.arrayContaining(['TRACK-1', 'Collected', 'Fixture city', '2026-01-01']));
    expect(result.findAll('a,img,iframe,script')).toHaveLength(0);
    expect(result.text()).toContain('tracking-trace');
  });
  it('clears an existing result on edits without a replacement query', async () => {
    const { wrapper } = setup();
    await submit(wrapper);
    await wrapper.get('[data-field="warehouseProductId"]').setValue('54321');
    expect(wrapper.find('[data-result="fulfillment"]').exists()).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  for (const change of [
    'close',
    'open',
    'identity',
    'configuration',
    'tab',
    'parameter',
    'unmount'
  ] as const) {
    it.each(['success', 'failure'] as const)('drops late %s after ' + change, async (outcome) => {
      const { wrapper, props, identity, onClose } = setup();
      let resolve!: (result: ReadResult) => void;
      let reject!: (error: unknown) => void;
      client.query.mockReturnValueOnce(
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        })
      );
      await wrapper.get('form').trigger('submit');
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(wrapper.get('[role="status"]').text()).toContain('Reading');
      const before = client.invalidate.mock.calls.length;
      if (change === 'close') await wrapper.get('[data-action="close"]').trigger('click');
      else if (change === 'open') props.open = false;
      else if (change === 'identity') identity.value = 'next-identity';
      else if (change === 'configuration') globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
      else if (change === 'tab') await selectTab(wrapper, 'tracking');
      else if (change === 'parameter') await wrapper.get('[data-field="countryCode"]').setValue('DE');
      else {
        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
      }
      await nextTick();
      expect(client.invalidate.mock.calls.length).toBeGreaterThan(before);
      if (outcome === 'success')
        resolve({ method: methods.warehouses, traceId: 'late-trace', data: { name: 'Late result' } });
      else reject(new Error('Late failure'));
      await flushPromises();
      if (change !== 'unmount') {
        expect(wrapper.find('[data-result="fulfillment"]').exists()).toBe(false);
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
      } else expect(client.dispose).toHaveBeenCalledTimes(1);
      if (change === 'identity' || change === 'configuration')
        expect(value(wrapper, 'warehouseProductId')).toBe('');
      if (change === 'close') expect(onClose).toHaveBeenCalledTimes(1);
      expect(client.failureToast).not.toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledTimes(1);
    });
  }
  it('shows shared ErrorNotice with trace and a localized toast, without retry', async () => {
    const { wrapper } = setup();
    client.query.mockRejectedValueOnce(
      new GatewayException({
        code: 'ALIBABA_IOP_AUTHORIZATION_REQUIRED',
        message: 'IOP authorization required',
        retryable: false,
        traceId: 'failure-trace'
      })
    );
    await submit(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('failure-trace');
    expect(client.failureToast).toHaveBeenCalledExactlyOnceWith(messages['en-US'].failed);
    expect(wrapper.find('[data-result="fulfillment"]').exists()).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it('switches both languages reactively and closes without a query', async () => {
    const { wrapper, onClose } = setup();
    expect(wrapper.text()).toContain(messages['en-US'].title);
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    expect(wrapper.text()).toContain(messages['zh-CN'].title);
    for (const tab of ['freight', 'tracking', 'warehouses']) {
      await selectTab(wrapper, tab);
      expect(wrapper.text()).toContain(messages['zh-CN'].query);
    }
    uiI18n.global.locale.value = 'en-US';
    await nextTick();
    expect(wrapper.text()).toContain(messages['en-US'].title);
    await wrapper.get('[data-action="close"]').trigger('click');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
  });
  it('reopens with current props but no old result', async () => {
    const { wrapper, props } = setup();
    await submit(wrapper);
    await wrapper.get('[data-action="close"]').trigger('click');
    props.open = false;
    await nextTick();
    props.open = true;
    await nextTick();
    expect(value(wrapper, 'warehouseProductId')).toBe('12345');
    expect(wrapper.find('[data-result="fulfillment"]').exists()).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it('uses the shared Escape-dismissable modal', async () => {
    const { onClose } = setup({}, true);
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
  });
});
