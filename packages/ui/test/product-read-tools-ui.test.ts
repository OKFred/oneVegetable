// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import fixtures from '../../../mock/data/product-read-tools.json';
import type { GatewayClient, SettingsRepository } from '@one-vegetable/core';
import { GatewayException } from '@one-vegetable/core/errors';
import { PRODUCT_READ_METHODS } from '../../core/src/product-read-tools';
import ProductReadToolsDialog from '../src/components/ProductReadToolsDialog.vue';
import { provideServices } from '../src/lib/services';
import { provideListIdentityScope } from '../src/lib/list-identity-scope';
import { GATEWAY_CONFIGURATION_EVENT } from '../src/lib/gateway-configuration-events';
import { uiI18n } from '../src/i18n';
import { productReadTools as zh } from '../src/i18n/messages/zh-CN/productReadTools';
import { productReadTools as en } from '../src/i18n/messages/en-US/productReadTools';

const wrappers: VueWrapper[] = [];
const hosts: HTMLElement[] = [];
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
beforeEach(() => {
  uiI18n.global.locale.value = 'en-US';
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  hosts.splice(0).forEach((host) => {
    host.remove();
  });
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
function setup(kind: 'translation' | 'shipping' = 'translation', realDialog = false) {
  const identity = ref('fixture-boundary');
  const props = reactive({ kind, productTitle: fixtures.translationInput.text, productId: '', open: true });
  const data: Record<string, unknown> = {
    [PRODUCT_READ_METHODS.translation]: fixtures.translation,
    [PRODUCT_READ_METHODS.countries]: fixtures.countries,
    [PRODUCT_READ_METHODS.coverage]: fixtures.coverage
  };
  const request = vi.fn((operation: string, payload: Record<string, unknown>) =>
    Promise.resolve(
      operation === 'listShippingTemplates'
        ? structuredClone(fixtures.templates)
        : {
            method: payload.method,
            traceId: 'envelope-trace',
            contractValid: true,
            contractIssues: [],
            data: structuredClone(data[String(payload.method)])
          }
    )
  );
  const context = vi.fn(() => Promise.resolve(structuredClone(fixtures.context)));
  const onClose = vi.fn();
  const host = document.createElement('div');
  hosts.push(host);
  document.body.append(host);
  const wrapper = mount(
    defineComponent({
      setup() {
        provideServices({
          gateway: {
            request: request as unknown as GatewayClient['request'],
            galleryTransferContext: context
          },
          settings: {} as SettingsRepository,
          mode: 'bff'
        });
        provideListIdentityScope(computed(() => identity.value));
        return () => h(ProductReadToolsDialog, { ...props, onClose });
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
  return { wrapper, request, context, identity, props, onClose, data };
}
async function fillTranslation(wrapper: VueWrapper) {
  await wrapper.get('[data-field="appName"]').setValue(fixtures.translationInput.appName);
  await wrapper.get('[data-field="sourceLanguage"]').setValue(fixtures.translationInput.sourceLanguage);
  await wrapper.get('[data-field="targetLanguage"]').setValue(fixtures.translationInput.targetLanguage);
}
async function fillShipping(wrapper: VueWrapper) {
  for (const [field, value] of Object.entries({
    templateId: fixtures.shippingInput.shippingTemplateId,
    weight: fixtures.shippingInput.weightKg,
    length: fixtures.shippingInput.lengthCm,
    width: fixtures.shippingInput.widthCm,
    height: fixtures.shippingInput.heightCm,
    moq: fixtures.shippingInput.moq,
    productType: fixtures.shippingInput.productType
  }))
    await wrapper.get('[data-field="' + field + '"]').setValue(String(value));
}
describe('product read tools UI', () => {
  it('keeps the bilingual label catalogs aligned and nonempty', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for (const value of [...Object.values(zh), ...Object.values(en)]) expect(value.trim()).not.toBe('');
  });
  it.each(['translation', 'shipping'] as const)('does not read on opening the %s tool', async (kind) => {
    const { wrapper, request, context } = setup(kind);
    await flushPromises();
    expect(request).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('TOP');
  });
  it('requires the actual appName and both languages before translating', async () => {
    const { wrapper, request } = setup();
    expect(wrapper.get('[data-action="translate"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(request).not.toHaveBeenCalled();
    expect((wrapper.get('[data-field="appName"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).toContain('Language recognition is not enabled');
  });
  it('renders a literal result and only copies after the explicit copy action', async () => {
    const { wrapper, request, data } = setup();
    data[PRODUCT_READ_METHODS.translation] = fixtures.unsafeTranslation;
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-result="translation"]').text()).toContain(
      fixtures.unsafeTranslation.result[0]?.translate_result_text
    );
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('escaped-trace');
    expect(writeText).not.toHaveBeenCalled();
    await wrapper.get('[data-action="copy"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      fixtures.unsafeTranslation.result[0]?.translate_result_text
    );
    expect(wrapper.text()).toContain('Copied');
  });
  it('keeps the selectable result when clipboard access fails', async () => {
    const { wrapper } = setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-action="copy"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(en.copyFailed);
    expect(wrapper.find('[data-result="translation"] pre[tabindex="0"]').exists()).toBe(true);
  });
  it('clears the prior result on editing and never auto-translates it', async () => {
    const { wrapper, request } = setup();
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('[data-field="targetLanguage"]').setValue('fr');
    expect(wrapper.find('[data-result="translation"]').exists()).toBe(false);
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('shows permission and trace hints without mock fallback or stale success', async () => {
    const { wrapper, request } = setup();
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    request.mockRejectedValueOnce(new GatewayException(fixtures.gatewayDenial));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-result="translation"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain(en.permissionHint);
    expect(wrapper.text()).toContain(fixtures.gatewayDenial.traceId);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('identifies TOP code 11 API-package denial explicitly and retains its safe subCode', async () => {
    const { wrapper, request } = setup();
    request.mockRejectedValueOnce(new GatewayException(fixtures.applicationPermissionDenial));
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(en.permissionDenied);
    expect(wrapper.get('[role="alert"]').text()).toContain(fixtures.applicationPermissionDenial.subCode);
    expect(wrapper.find('[data-result="translation"]').exists()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('invalidates displayed data and appName on identity changes without rereading', async () => {
    const { wrapper, identity, request } = setup();
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    identity.value = 'next-identity';
    await nextTick();
    expect(wrapper.find('[data-result="translation"]').exists()).toBe(false);
    expect((wrapper.get('[data-field="appName"]').element as HTMLInputElement).value).toBe('');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('drops a pending translation after configuration changes', async () => {
    const { wrapper, request } = setup();
    let resolve!: (value: Awaited<ReturnType<typeof request>>) => void;
    request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    await fillTranslation(wrapper);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    resolve({
      method: PRODUCT_READ_METHODS.translation,
      data: fixtures.translation,
      traceId: 'late',
      contractValid: true,
      contractIssues: []
    });
    await flushPromises();
    expect(wrapper.find('[data-result="translation"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('loads template IDs/names only from the template action', async () => {
    const { wrapper, request } = setup('shipping');
    await wrapper.get('[data-action="templates"]').trigger('click');
    await flushPromises();
    expect(request).toHaveBeenCalledExactlyOnceWith('listShippingTemplates', undefined, {
      galleryContext: fixtures.context
    });
    expect(wrapper.text()).toContain(fixtures.templates[0]?.name);
    expect(wrapper.find('[data-result="coverage"]').exists()).toBe(false);
  });
  it('keeps country listing separate from coverage and clears it on configuration change', async () => {
    const { wrapper, request } = setup('shipping');
    await wrapper.get('[data-action="countries"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-result="countries"]').text()).toContain('United States');
    expect(wrapper.find('[data-result="coverage"]').exists()).toBe(false);
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: PRODUCT_READ_METHODS.countries,
      parameters: { country_request: {} }
    });
    globalThis.dispatchEvent(new Event(GATEWAY_CONFIGURATION_EVENT));
    await nextTick();
    expect(wrapper.find('[data-result="countries"]').exists()).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('uses documented shipping fields and distinguishes false from unknown determinacy', async () => {
    const { wrapper, request } = setup('shipping');
    await fillShipping(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(request.mock.calls[0]?.[1]).toEqual({
      method: PRODUCT_READ_METHODS.coverage,
      parameters: fixtures.shippingRequest
    });
    expect(wrapper.get('[data-result="coverage"]').text()).toContain('Determinate');
    expect(wrapper.get('[data-result="coverage"]').text()).toContain('Not determinate');
    expect(wrapper.get('[data-result="coverage"]').text()).toContain('Unknown');
    expect(wrapper.text()).toContain(en.shippingHint);
    expect(wrapper.text()).toContain(fixtures.coverage.trace_id);
    expect(wrapper.text()).not.toContain('USD');
  });
  it('does not display a business-failed coverage result', async () => {
    const { wrapper, data } = setup('shipping');
    data[PRODUCT_READ_METHODS.coverage] = fixtures.coverageFailure;
    await fillShipping(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[data-result="coverage"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain(fixtures.coverageFailure.trace_id);
  });
  it('requires a batch size when selling per batch', async () => {
    const { wrapper, request } = setup('shipping');
    await fillShipping(wrapper);
    await wrapper.get('[data-field="saleType"]').setValue('batch');
    expect(wrapper.get('[data-action="coverage"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(request).not.toHaveBeenCalled();
    await wrapper.get('[data-field="batchNum"]').setValue('10');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      parameters: {
        country_logistics_cost_status_request: { sale_type: 'batch', batch_num: 10 }
      }
    });
  });
  it('changes language and closes without provider calls', async () => {
    const { wrapper, request, onClose } = setup();
    uiI18n.global.locale.value = 'zh-CN';
    await nextTick();
    expect(wrapper.text()).toContain(zh.translationTitle);
    await wrapper.get('[data-action="close"]').trigger('click');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
  it('uses the shared keyboard-dismissable dialog', async () => {
    const { onClose, request } = setup('translation', true);
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
});
