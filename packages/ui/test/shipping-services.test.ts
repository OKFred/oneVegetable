// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { defineComponent, h, ref } from 'vue';
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticOperationAvailabilityClient } from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import type {
  ShippingProviderConfigurationSummary,
  ShippingQuoteRequest,
  ShippingQuoteResult
} from '@one-vegetable/core/shipping-services';
import { parseFreightosQuote } from '../../core/src/shipping-quote-provider';
import requestFixture from '../../../mock/data/shipping-services/cn-export-request.json';
import providerFixture from '../../../mock/data/shipping-services/freightos-estimate.json';
import ShippingServicesWorkspace from '../src/components/ShippingServicesWorkspace.vue';
import LogisticsView from '../src/views/LogisticsView.vue';
import { provideServices } from '../src/lib/services';
import { provideUnsavedEditing, UnsavedEditingService } from '../src/lib/unsaved-editing';
import { uiI18n } from '../src/i18n';
import { formatDateTime } from '../src/lib/date-time';

const quotedAtUtc = Date.UTC(2026, 10, 9, 4, 5, 6);
const cleanups: (() => void)[] = [];
const configuration: ShippingProviderConfigurationSummary = {
  provider: 'freightos',
  configured: true,
  revision: 1,
  updatedAtUtc: 1
};
function fixtureResult(input: ShippingQuoteRequest): ShippingQuoteResult {
  return { ...parseFreightosQuote(providerFixture, input), quotedAtUtc };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function createWorkspace(parent = false) {
  const control = {
    configuration: vi.fn(() => Promise.resolve({ ...configuration })),
    saveConfiguration: vi.fn(() => Promise.resolve({ ...configuration, revision: 2 })),
    clearConfiguration: vi.fn(() => Promise.resolve()),
    quote: vi.fn((input: ShippingQuoteRequest) => Promise.resolve(fixtureResult(input)))
  };
  const gateway = new MockGatewayClient(0);
  const requests = vi.spyOn(gateway, 'request');
  const availability = new StaticOperationAvailabilityClient(new Set());
  const permissions = vi.spyOn(availability, 'get');
  const editing = new UnsavedEditingService();
  const active = ref(true);
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        shippingServices: control,
        operationAvailability: availability,
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
        mode: 'extension'
      });
      provideUnsavedEditing(editing);
      return () => (parent ? h(LogisticsView) : h(ShippingServicesWorkspace, { active: active.value }));
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
  cleanups.push(() => {
    wrapper.unmount();
    queryClient.clear();
    editing.dispose();
  });
  return { control, wrapper, active, queryClient, requests, permissions };
}
function element(selector: string) {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) throw new Error('Missing element ' + selector);
  return new DOMWrapper(target);
}
const field = (name: string) => element('[data-testid="shipping-' + name + '"]');
async function closeSheet() {
  await element('[role="dialog"] button[aria-label="Close details"]').trigger('click');
  await flushPromises();
}
async function configured() {
  await field('configure').trigger('click');
  await flushPromises();
  await closeSheet();
}
async function fillShipment() {
  const shipment = requestFixture.shipment;
  const values = {
    originProvince: shipment.origin.state,
    originCity: shipment.origin.city,
    originPostal: shipment.origin.postalCode,
    destinationCountry: shipment.destination.countryCode,
    destinationProvince: shipment.destination.state,
    destinationCity: shipment.destination.city,
    destinationPostal: shipment.destination.postalCode,
    quantity: String(shipment.quantity),
    weightKg: String(shipment.weightKg),
    lengthCm: String(shipment.lengthCm),
    widthCm: String(shipment.widthCm),
    heightCm: String(shipment.heightCm),
    declaredValue: String(shipment.declaredValue)
  };
  await field('mode').setValue('lcl');
  for (const [name, value] of Object.entries(values)) await field(name).setValue(value);
}
async function review() {
  await field('review').trigger('submit');
  await flushPromises();
  expect(document.querySelector('[data-testid="shipping-frozen-request"]')).not.toBeNull();
}
async function consentAndSend() {
  await field('quote-data').setValue(true);
  await field('quote-cost').setValue(true);
  await field('send').trigger('click');
  await flushPromises();
}
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => {
      cleanup();
    });
  document.body.innerHTML = '';
  uiI18n.global.locale.value = 'zh-CN';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('China-origin shipping services', () => {
  it('makes no configuration/provider calls on mount, typing, modes or locale changes; filters official CN links locally', async () => {
    const { control, wrapper } = createWorkspace();
    await flushPromises();
    const directory = wrapper.get('[data-testid="shipping-directory"]');
    expect(directory.find('[data-testid="shipping-originCity"]').exists()).toBe(false);
    expect(directory.find('[data-testid="shipping-destinationCountry"]').exists()).toBe(false);
    expect(directory.findAll('input')).toHaveLength(2);
    expect(directory.find('input[readonly]').element).toHaveProperty('value', 'Mainland China (CN)');
    expect(field('originCity').element.closest('form')?.getAttribute('data-testid')).toBe(
      'shipping-estimate-form'
    );
    expect(wrapper.get('[data-testid="shipping-estimate-details"]').attributes('open')).toBeUndefined();
    await field('originCity').setValue('Private city');
    await field('mode').setValue('express');
    expect(wrapper.find('[data-testid="shipping-directory-dhl"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="shipping-directory-maersk"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="shipping-review"]').exists()).toBe(false);
    await field('keyword').setValue('顺丰');
    expect(wrapper.findAll('[data-testid^="shipping-directory-"]')).toHaveLength(1);
    uiI18n.global.locale.value = 'zh-CN';
    await flushPromises();
    expect(wrapper.text()).toContain('顺丰国际');
    for (const link of wrapper.findAll('a[target="_blank"]')) {
      expect(link.attributes('rel')).toContain('noreferrer');
      expect(link.attributes('href')).not.toContain('Private');
    }
    expect(wrapper.findAll('iframe,img')).toHaveLength(0);
    expect(control.configuration).not.toHaveBeenCalled();
    expect(control.quote).not.toHaveBeenCalled();
    expect(field('acceptance-pending').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Easyship');
  });

  it('loads summaries only on open; saves one write-only key after two explicit acknowledgements and clears it on save/close', async () => {
    const { control } = createWorkspace();
    await field('configure').trigger('click');
    await flushPromises();
    expect(control.configuration).toHaveBeenCalledExactlyOnceWith('freightos');
    expect(document.body.textContent).toContain('marketplace login is not an API key');
    expect(field('api-key').attributes('type')).toBe('password');
    expect(field('api-key').attributes()).toHaveProperty('data-feedback-redact');
    await field('api-key').setValue('fixture-key-not-real');
    expect(field('save').attributes('disabled')).toBeDefined();
    await field('config-terms').setValue(true);
    expect(field('save').attributes('disabled')).toBeDefined();
    await field('config-cost').setValue(true);
    await field('save').trigger('submit');
    await flushPromises();
    expect(control.saveConfiguration).toHaveBeenCalledExactlyOnceWith({
      provider: 'freightos',
      apiKey: 'fixture-key-not-real',
      expectedRevision: 1,
      termsAccepted: true,
      costAcknowledged: true
    });
    expect(field('api-key').element).toHaveProperty('value', '');
    expect(field('config-terms').element).toHaveProperty('checked', false);
    expect(document.body.textContent).not.toContain('fixture-key-not-real');
    expect(control.quote).not.toHaveBeenCalled();
    expect(field('acceptance-pending').exists()).toBe(true);
    await field('api-key').setValue('another-fixture-key');
    await closeSheet();
    await field('configure').trigger('click');
    await flushPromises();
    expect(field('api-key').element).toHaveProperty('value', '');
    expect(field('config-cost').element).toHaveProperty('checked', false);
  });

  it('resolves local country names without calls and formats returned time with the project helper', async () => {
    const { control, wrapper } = createWorkspace();
    await configured();
    await fillShipment();
    expect(
      wrapper.findAll('datalist option').some((option) => option.attributes('value') === 'United States (US)')
    ).toBe(true);
    await field('destinationCountry').setValue('美国');
    uiI18n.global.locale.value = 'zh-CN';
    await flushPromises();
    expect(
      wrapper.findAll('datalist option').some((option) => option.attributes('value') === '美国 (US)')
    ).toBe(true);
    uiI18n.global.locale.value = 'en-US';
    await flushPromises();
    expect(control.quote).not.toHaveBeenCalled();
    await review();
    expect(JSON.parse(field('frozen-request').text())).toMatchObject({
      shipment: { destination: { countryCode: 'US' } }
    });
    await consentAndSend();
    expect(wrapper.get('[data-testid="shipping-quoted-at"]').text()).toBe(
      'Quoted at: ' + formatDateTime(quotedAtUtc)
    );
    expect(wrapper.find('[data-testid="shipping-acceptance-pending"]').exists()).toBe(false);
    await field('originProvince').setValue('Guangdong revised');
    expect(wrapper.find('[data-testid="shipping-acceptance-pending"]').exists()).toBe(false);
    expect(control.quote).toHaveBeenCalledOnce();
  });

  it('validates before consent, freezes all sent inputs and sends exactly once after per-request consent; keeps actual currency', async () => {
    const { control, wrapper } = createWorkspace();
    await configured();
    await field('review').trigger('submit');
    expect(control.quote).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await fillShipment();
    await review();
    expect(field('frozen-request').text()).toContain('"countryCode": "CN"');
    expect(field('frozen-request').text()).toContain('"currency": "CNY"');
    expect(field('frozen-request').text()).toContain('"dataSharing": false');
    expect(field('send').attributes('disabled')).toBeDefined();
    await field('quote-data').setValue(true);
    expect(field('send').attributes('disabled')).toBeDefined();
    expect(control.quote).not.toHaveBeenCalled();
    await field('quote-cost').setValue(true);
    await field('send').trigger('click');
    await flushPromises();
    expect(control.quote).toHaveBeenCalledOnce();
    const input = control.quote.mock.calls[0]?.[0];
    if (!input) throw new Error('Missing quote input');
    expect(input).toMatchObject({
      provider: 'freightos',
      expectedRevision: 1,
      shipment: { origin: { countryCode: 'CN', state: 'Guangdong' }, currency: 'CNY' },
      consent: { dataSharing: true, costAcknowledged: true }
    });
    expect(Object.isFrozen(input.shipment)).toBe(true);
    expect(wrapper.get('[data-testid="shipping-results"]').text()).toContain('USD 394.43');
    expect(wrapper.get('[data-testid="shipping-results"]').text()).not.toContain('CNY 394.43');
    expect(wrapper.text()).toContain('Market estimate');
    expect(wrapper.text()).toContain('10 requests/day');
    uiI18n.global.locale.value = 'zh-CN';
    await flushPromises();
    expect(control.quote).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('每日 10 次');
    uiI18n.global.locale.value = 'en-US';
    await review();
    expect(field('quote-data').element).toHaveProperty('checked', false);
    expect(field('quote-cost').element).toHaveProperty('checked', false);
  });

  it('uses container-only inputs for FCL and never dispatches an express/parcel API call', async () => {
    const { control } = createWorkspace();
    await configured();
    await fillShipment();
    await field('mode').setValue('fcl');
    expect(document.querySelector('[data-testid="shipping-lengthCm"]')).toBeNull();
    await review();
    const snapshot: unknown = JSON.parse(field('frozen-request').text());
    expect(snapshot).toMatchObject({ shipment: { mode: 'fcl', packaging: 'container20' } });
    expect(snapshot).not.toHaveProperty('shipment.lengthCm');
    expect(snapshot).not.toHaveProperty('shipment.weightKg');
    expect(snapshot).not.toHaveProperty('shipment.description');
    expect(snapshot).not.toHaveProperty('shipment.hsCode');
    expect(snapshot).not.toHaveProperty('shipment.pickupDate');
    await closeSheet();
    await field('mode').setValue('parcel');
    expect(document.querySelector('[data-testid="shipping-review"]')).toBeNull();
    expect(control.quote).not.toHaveBeenCalled();
  });

  it('renders empty/error without mock prices, masks unknown upstream messages and never retries', async () => {
    const { control, wrapper } = createWorkspace();
    await configured();
    await fillShipment();
    control.quote.mockImplementationOnce((input) =>
      Promise.resolve({ ...fixtureResult(input), options: [] })
    );
    await review();
    await consentAndSend();
    expect(wrapper.get('[data-testid="shipping-results"]').text()).toContain('No rates returned');
    expect(wrapper.text()).not.toContain('394.43');
    control.quote.mockRejectedValueOnce(new Error('raw-provider-key-and-address-must-not-display'));
    await review();
    await consentAndSend();
    expect(wrapper.find('[data-testid="shipping-results"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('SHIPPING_SERVICES_FAILED');
    expect(document.body.textContent).not.toContain('raw-provider');
    await flushPromises();
    expect(control.quote).toHaveBeenCalledTimes(2);
  });

  it('ignores late quotes after input changes, hiding or unmount; does not allow parallel dispatch', async () => {
    const { control, wrapper, active } = createWorkspace();
    await configured();
    await fillShipment();
    for (const reason of ['input', 'hide', 'unmount']) {
      const waiting = deferred<ShippingQuoteResult>();
      control.quote.mockImplementationOnce(() => waiting.promise);
      await review();
      await consentAndSend();
      const input = control.quote.mock.calls.at(-1)?.[0];
      if (!input) throw new Error('Missing quote input');
      expect(field('configure').attributes('disabled')).toBeDefined();
      if (reason === 'input') await field('originProvince').setValue('Guangdong revised');
      if (reason === 'hide') {
        active.value = false;
        await flushPromises();
      }
      if (reason === 'unmount') wrapper.unmount();
      waiting.resolve(fixtureResult(input));
      await flushPromises();
      expect(document.querySelector('[data-testid="shipping-results"]')).toBeNull();
      if (reason === 'hide') {
        active.value = true;
        await flushPromises();
      }
    }
    expect(control.quote).toHaveBeenCalledTimes(3);
  });

  it('opens clear confirmation as a sibling, preserves expectedRevision, and ignores late configuration on close', async () => {
    const { control } = createWorkspace();
    await field('configure').trigger('click');
    await flushPromises();
    await field('clear').trigger('click');
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="shipping-api-key"]')).toBeNull();
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent.trim() === 'Confirm'
    );
    expect(confirm).toBeDefined();
    if (!confirm) throw new Error('Missing confirmation button');
    confirm.click();
    await flushPromises();
    expect(control.clearConfiguration).toHaveBeenCalledExactlyOnceWith('freightos', 1);
    expect(control.quote).not.toHaveBeenCalled();
    const waiting = deferred<ShippingProviderConfigurationSummary>();
    control.configuration.mockReturnValueOnce(waiting.promise);
    await field('configure').trigger('click');
    await closeSheet();
    waiting.resolve(configuration);
    await flushPromises();
    expect(field('review').attributes('disabled')).toBeDefined();
  });

  it('adds the final lazy tab, suspends ALL Alibaba queries, preserves same-page form but not remount', async () => {
    const { wrapper, control, requests, permissions, queryClient } = createWorkspace(true);
    await flushPromises();
    const tab = (name: string) => {
      const button = wrapper.findAll('button[aria-pressed]').find((item) => item.text() === name);
      if (!button) throw new Error('Missing tab ' + name);
      return button;
    };
    expect(tab('Shipping quote').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[data-testid="shipping-services-workspace"]').exists()).toBe(false);
    expect(wrapper.findAll('button[aria-pressed]').at(-1)?.text()).toBe('Shipping services');
    await tab('Shipping services').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="shipping-services-workspace"]').exists()).toBe(true);
    });
    requests.mockClear();
    permissions.mockClear();
    await queryClient.invalidateQueries();
    await flushPromises();
    expect(requests).not.toHaveBeenCalled();
    expect(permissions).not.toHaveBeenCalled();
    expect(control.configuration).not.toHaveBeenCalled();
    await field('originCity').setValue('Page only city');
    await tab('Shipping quote').trigger('click');
    await tab('Shipping services').trigger('click');
    expect(field('originCity').element).toHaveProperty('value', 'Page only city');
    wrapper.unmount();
    const next = createWorkspace();
    expect(next.wrapper.get('[data-testid="shipping-originCity"]').element).toHaveProperty('value', '');
  });
});
