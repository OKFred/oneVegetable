// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALIBABA_GATEWAY, GatewayException, type OperationId } from '@one-vegetable/core';
import { getIopOperationSupport } from '@one-vegetable/core/alibaba-iop-registry';
import { selectAlibabaOperationProtocol } from '@one-vegetable/core/alibaba-protocol-routing';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import scopeMismatch from '../../../mock/data/ui-iop-photo-degradation/scope-mismatch.json';
import PhotoBankPicker from '../src/components/PhotoBankPicker.vue';
import TablePagination from '../src/components/TablePagination.vue';
import PhotosView from '../src/views/PhotosView.vue';
import { uiI18n } from '../src/i18n';
import { provideServices } from '../src/lib/services';

type Surface = 'view' | 'picker';
const mounted: VueWrapper[] = [];
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  uiI18n.global.locale.value = 'zh-CN';
  network.mockClear();
  vi.stubGlobal('fetch', network);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => {
    wrapper.unmount();
  });
  document.body.innerHTML = '';
  uiI18n.global.locale.value = 'zh-CN';
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountSurface(surface: Surface, iopOnly = true) {
  const gateway = new MockGatewayClient(0);
  const original = gateway.request.bind(gateway);
  const protocols: string[] = [];
  const available = { top: !iopOnly, iop: true, defaultProtocol: 'iop' as const, bindingConfirmed: false };
  const request = vi.spyOn(gateway, 'request').mockImplementation((operation, payload) => {
    if (operation === 'listPhotos') {
      // Exercise shared pre-dispatch routing at the gateway boundary, not a UI fallback.
      const protocol = selectAlibabaOperationProtocol(operation, payload, available);
      protocols.push(protocol);
      if (protocol === 'iop') return Promise.reject(new GatewayException(scopeMismatch));
    }
    return original(operation, payload);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: {
          load: () =>
            Promise.resolve({
              appKey: '',
              appSecret: '',
              accessToken: '',
              endpoint: ALIBABA_GATEWAY,
              signMethod: 'hmac'
            }),
          save: () => Promise.resolve()
        },
        operationAvailability: {
          get: (operations) =>
            Promise.resolve({
              items: operations.map((operation) => ({
                operation,
                allowed: true,
                reasonCode: null,
                ...(iopOnly
                  ? { protocolSupport: { protocol: 'iop' as const, ...getIopOperationSupport(operation) } }
                  : {})
              }))
            })
        },
        mode: 'extension'
      });
      return () => (surface === 'view' ? h(PhotosView) : h(PhotoBankPicker, { modelValue: [] }));
    }
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
  mounted.push(wrapper);
  if (surface === 'picker') await wrapper.get('button').trigger('click');
  return { wrapper, request, queryClient, protocols };
}

function bodyButton(label: string) {
  const result = new DOMWrapper(document.body)
    .findAll('button')
    .find((candidate) => candidate.text() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

describe.each(['view', 'picker'] as const)('IOP photo degradation in the %s', (surface) => {
  it.each(['zh-CN', 'en-US'] as const)('shows a real error, not empty data, in %s', async (locale) => {
    const { wrapper, request, queryClient, protocols } = await mountSurface(surface);
    uiI18n.global.locale.value = locale;
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(scopeMismatch.code);
    });
    await flushPromises();

    const body = new DOMWrapper(document.body);
    const alert = body.get('[role="alert"]');
    expect(alert.text()).toContain(uiI18n.global.t(`errors.codes.${scopeMismatch.code}`));
    const message = uiI18n.global.t('errors.codes.ALIBABA_IOP_PHOTO_SCOPE_MISMATCH');
    expect(message).toBe(
      locale === 'zh-CN'
        ? '阿里平台 IOP 图片分组查询暂有异常。'
        : 'Alibaba IOP image-group queries are currently unreliable.'
    );
    expect(message.length).toBeLessThanOrEqual(70);
    expect(alert.text()).toContain(uiI18n.global.t('common.error.mediaGuidance.photoScope'));
    expect(alert.text()).toContain('TOP');
    expect(body.text()).not.toContain(uiI18n.global.t('photos.emptyFilter'));
    expect(body.find('[data-testid="photo-card-grid"]').exists()).toBe(false);
    expect(body.find('[data-testid="photo-list-table"]').exists()).toBe(false);
    expect(body.find('[data-testid="alibaba-reconnect"]').exists()).toBe(false);
    expect(body.find('img').exists()).toBe(false);
    expect(queryClient.getQueriesData({ queryKey: ['photos'] }).every(([, data]) => data === undefined)).toBe(
      true
    );
    expect(wrapper.findComponent(TablePagination).props('total')).toBeNull();
    const photoCalls = request.mock.calls.filter(([operation]) => operation === 'listPhotos');
    expect(photoCalls).toHaveLength(1);
    expect(photoCalls[0]?.[1]).not.toHaveProperty('groupId', '-1');
    expect(protocols).toEqual(['iop']);
    expect(
      request.mock.calls.every(([operation]) => ['listPhotos', 'listPhotoGroups'].includes(operation))
    ).toBe(true);
  });

  it('uses TOP once through shared routing for dual authorization, even with IOP as default', async () => {
    const { request, protocols } = await mountSurface(surface, false);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('solar-station-front.jpg');
    });
    await flushPromises();
    expect(protocols).toEqual(['top']);
    expect(request.mock.calls.filter(([operation]) => operation === 'listPhotos')).toHaveLength(1);
    expect(document.body.textContent).not.toContain(scopeMismatch.code);
  });
});

it('keeps group creation, renaming and upload reachable after an IOP list error', async () => {
  const { request } = await mountSurface('view');
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(scopeMismatch.code);
  });
  expect(bodyButton('上传').attributes('disabled')).toBeUndefined();
  expect(bodyButton('分组管理').attributes('disabled')).toBeUndefined();
  await bodyButton('分组管理').trigger('click');
  const body = new DOMWrapper(document.body);
  await vi.waitFor(() => {
    expect(body.get('button[aria-label="在全部图片下新增分组"]').attributes('disabled')).toBeUndefined();
    expect(body.get('button[aria-label="修改分组 商品主图"]').attributes('disabled')).toBeUndefined();
  });
  await body.get('button[aria-label="在全部图片下新增分组"]').trigger('click');
  expect(body.find('input[aria-label="在全部图片下的新分组名称"]').exists()).toBe(true);
  await bodyButton('取消').trigger('click');
  await body.get('button[aria-label="修改分组 商品主图"]').trigger('click');
  expect(body.find('input[aria-label="商品主图 的新名称"]').exists()).toBe(true);
  expect(request.mock.calls.some(([operation]) => operation === 'operatePhotoGroup')).toBe(false);
  expect(request.mock.calls.filter(([operation]) => operation === 'listPhotos')).toHaveLength(1);
});

it('keeps picker uploads reachable without selecting or silently retrying failed photo data', async () => {
  const { wrapper, request } = await mountSurface('picker');
  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(scopeMismatch.code);
  });
  expect(bodyButton('上传').attributes('disabled')).toBeUndefined();
  await bodyButton('上传').trigger('click');
  await vi.waitFor(() => {
    expect(document.querySelector('input[aria-label="外部图片 URL"]')).not.toBeNull();
  });
  expect(wrapper.findComponent(PhotoBankPicker).emitted('update:modelValue')).toBeUndefined();
  const mutations: OperationId[] = ['uploadPhoto', 'transferPhotoFromUrl', 'operatePhotoGroup'];
  expect(request.mock.calls.some(([operation]) => mutations.includes(operation))).toBe(false);
  expect(request.mock.calls.filter(([operation]) => operation === 'listPhotos')).toHaveLength(1);
});
