// @vitest-environment jsdom

import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_PREFERENCES_STORAGE_KEY,
  OPERATION_IDS,
  StaticOperationAvailabilityClient,
  type OperationId,
  type RequestOf,
  type ResponseOf
} from '@one-vegetable/core';
import { MockGatewayClient } from '@one-vegetable/core/mock';

import { provideServices } from '../src/lib/services';
import { formatDateTime } from '../src/lib/date-time';
import { uiI18n } from '../src/i18n';
import OrdersView from '../src/views/OrdersView.vue';
import { useAppPreferences } from '../src/lib/preferences';
import iopDetailFixture from '../../../mock/data/iop-order-public-detail.json';

function mountView(mode: 'mock' | 'extension' = 'mock', gateway = new MockGatewayClient(0)) {
  const Host = defineComponent({
    setup() {
      provideServices({
        gateway,
        settings: { load: () => Promise.resolve(settings()), save: () => Promise.resolve() },
        operationAvailability: new StaticOperationAvailabilityClient(
          new Set(mode === 'mock' ? OPERATION_IDS : [])
        ),
        mode
      });
      return () => h(OrdersView);
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient }]] }
  });
}

function button(wrapper: ReturnType<typeof mountView>, text: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

function bodyButton(text: string): HTMLButtonElement {
  const result = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent.includes(text) || candidate.getAttribute('aria-label') === text
  );
  if (!result) throw new Error(`Missing body button: ${text}`);
  return result;
}

describe('OrdersView', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/orders');
  });

  it('searches again with unchanged conditions without a duplicate list refresh button', async () => {
    const request = vi.spyOn(MockGatewayClient.prototype, 'request');
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.find('tbody tr').exists()).toBe(true);
    });
    const before = request.mock.calls.filter(([operation]) => operation === 'listTradeOrders').length;
    const search = wrapper.get('[data-testid="order-toolbar"] button[type="submit"]');
    expect(search.attributes('data-list-action')).toBeDefined();
    expect(search.classes()).toEqual(expect.arrayContaining(['h-9', 'border-input']));
    expect(search.find('svg[aria-hidden="true"]').exists()).toBe(true);
    expect(wrapper.findAll('button').some((item) => item.text() === '刷新')).toBe(false);
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => {
      expect(request.mock.calls.filter(([operation]) => operation === 'listTradeOrders')).toHaveLength(
        before + 1
      );
    });
    wrapper.unmount();
    request.mockRestore();
  });

  it('uses neutral pressed workspace toggles', async () => {
    const wrapper = mountView();
    await flushPromises();
    const workspaces = wrapper.get('[data-testid="order-workspaces"]');
    const selected = workspaces.get('button[aria-pressed="true"]');
    expect(selected.classes()).toContain('bg-secondary');
    expect(workspaces.findAll('button[aria-pressed="false"]')).toHaveLength(3);
    await button(wrapper, '地址 Schema').trigger('click');
    expect(selected.attributes('aria-pressed')).toBe('false');
    expect(selected.classes()).not.toContain('bg-secondary');
    expect(button(wrapper, '地址 Schema').attributes('aria-pressed')).toBe('true');
    expect(button(wrapper, '地址 Schema').classes()).toContain('bg-secondary');
    expect(
      wrapper.findAll('button[aria-pressed]').every((item) => !item.classes().includes('bg-primary'))
    ).toBe(true);
    wrapper.unmount();
  });

  it('uses the preferred language for fulfillment and address Schema requests', async () => {
    localStorage.setItem(
      APP_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ uiLocale: 'zh-CN', alibabaLanguage: 'en_US', theme: 'system' })
    );
    const request = vi.spyOn(MockGatewayClient.prototype, 'request');
    const wrapper = mountView();
    await flushPromises();

    await button(wrapper, '资金与履约').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listTradeFulfillmentChannels', { language: 'en_US' });
    });

    await button(wrapper, '地址 Schema').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('getTradeAddressSchema', {
        countryCode: 'US',
        language: 'en_US'
      });
    });
    wrapper.unmount();
  });

  it('opens the non-Jushita aggregate and shows independent fund and logistics results', async () => {
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('24668306501026709');
    });

    const firstRow = wrapper.find('tbody tr');
    expect(firstRow.attributes('tabindex')).toBe('0');
    await firstRow.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026709');
      expect(document.body.textContent).toContain('2450.50');
      expect(document.body.textContent).toContain('fullDetail: jushita-only');
    });
    expect(wrapper.get('tbody [data-feedback-redact]').text()).toContain('northwind-buyer');

    bodyButton('TT 汇款').click();
    await flushPromises();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')?.textContent).not.toContain(
        '1029200038060'
      );
    });
    expect(
      document.body.querySelector('[data-testid="tt-account-number"]')?.closest('[data-feedback-redact]')
    ).not.toBeNull();
    bodyButton('显示完整汇款账号').click();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')?.textContent).toContain(
        '1029200038060'
      );
    });
    bodyButton('查看下一条订单').click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026710');
      expect(document.body.querySelector('[data-testid="tt-account-number"]')).toBeNull();
    });
    bodyButton('关闭详情').click();

    await button(wrapper, '资金与履约').trigger('click');
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('一达通');
      expect(wrapper.text()).not.toContain('1029200038060');
    });
    wrapper.unmount();
  });

  it('restores the selected order and drawer section from a deep hash route', async () => {
    globalThis.history.replaceState(null, '', '#/orders/orders/24668306501026709/payment');
    const wrapper = mountView();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('订单 24668306501026709');
      expect(document.body.querySelector('[aria-label="TT 汇款信息"]')).not.toBeNull();
    });
    expect(globalThis.location.hash).toBe('#/orders/orders/24668306501026709/payment');

    bodyButton('关闭详情').click();
    await flushPromises();
    expect(globalThis.location.hash).toBe('#/orders/orders');
    wrapper.unmount();
  });

  it('renders address Schema without persisting PII and completes a Web Mock order draft', async () => {
    const wrapper = mountView();
    await flushPromises();
    await button(wrapper, '地址 Schema').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('contact.fullName');
      expect(wrapper.text()).toContain('不会持久化');
    });

    const email = wrapper.find('input[type="email"]');
    expect(email.attributes('data-feedback-redact')).toBe('');
    await email.setValue('buyer@example.com');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('Northwind warehouse');
    });
    expect(
      wrapper
        .findAll('[data-feedback-redact]')
        .some((element) => element.text().includes('Northwind warehouse'))
    ).toBe(true);

    await button(wrapper, '信保订单草稿').trigger('click');
    const values: Record<string, string> = {
      买家登录名: 'northwind-buyer',
      '商品 ID': '10000001',
      商品名称: 'Portable solar power station',
      数量: '10',
      单价: '599'
    };
    for (const [placeholder, value] of Object.entries(values)) {
      await wrapper.get(`input[placeholder="${placeholder}"]`).setValue(value);
    }
    const create = button(wrapper, '创建演示信保订单');
    expect(create.attributes('disabled')).toBeUndefined();
    await create.trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('演示订单创建成功');
    });
    wrapper.unmount();
  });

  it('keeps trade mutations disabled in extension mode', async () => {
    const wrapper = mountView('extension');
    await flushPromises();
    await button(wrapper, '信保订单草稿').trigger('click');

    expect(wrapper.text()).toContain('当前环境未开放信保订单创建（STATIC_DISABLED）');
    expect(button(wrapper, '创建信保订单（未开放）').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});

function iopDetailGateway(waitForFailedOrder?: Promise<void>) {
  const gateway = new MockGatewayClient(0);
  const original = gateway.request.bind(gateway);
  const aggregates = Object.values(iopDetailFixture);
  vi.spyOn(gateway, 'request').mockImplementation(
    <K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> => {
      if (operation === 'listTradeOrders') {
        return Promise.resolve({
          items: aggregates.map((aggregate) => structuredClone(aggregate.order)),
          page: 1,
          pageSize: 20,
          total: aggregates.length,
          documentTimeZoneUnverified: true
        } as unknown as ResponseOf<K>);
      }
      if (operation === 'getTradeOrderAggregate') {
        const order = (payload as RequestOf<'getTradeOrderAggregate'>).order;
        const aggregate = aggregates.find((candidate) => candidate.order.id === order.id);
        if (!aggregate) return Promise.reject(new Error('Missing fictional aggregate'));
        const pending = order.id === iopDetailFixture.failed.order.id ? waitForFailedOrder : undefined;
        return Promise.resolve(pending).then(() => structuredClone(aggregate) as unknown as ResponseOf<K>);
      }
      return original(operation, payload);
    }
  );
  return gateway;
}

async function openFixtureOrder(wrapper: ReturnType<typeof mountView>, id: string) {
  await vi.waitFor(() => {
    expect(wrapper.text()).toContain(id);
  });
  const row = wrapper.findAll('tbody tr').find((candidate) => candidate.text().includes(id));
  if (!row) throw new Error(`Missing fictional order: ${id}`);
  await row.trigger('keydown', { key: 'Enter' });
  await flushPromises();
}

function detailElement(testId: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing drawer element: ${testId}`);
  return element;
}

describe('OrdersView native IOP public detail', () => {
  const wrappers: ReturnType<typeof mountView>[] = [];
  function mountIop(gateway = iopDetailGateway()) {
    const wrapper = mountView('mock', gateway);
    wrappers.push(wrapper);
    return wrapper;
  }
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/orders');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected live call')));
  });
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    uiI18n.global.locale.value = 'zh-CN';
    document.documentElement.classList.remove('dark');
    Reflect.deleteProperty(document.documentElement.dataset, 'theme');
  });

  it.each([
    ['zh-CN', '买家', '订单金额', '商品名称'],
    ['en-US', 'Buyer', 'Order amount', 'Product name']
  ] as const)(
    'renders source-labelled readonly detail in %s dark mode without inventing funds',
    async (locale, buyerLabel, amountLabel, productLabel) => {
      localStorage.setItem(
        APP_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ uiLocale: locale, alibabaLanguage: 'en_US', theme: 'dark' })
      );
      const wrapper = mountIop();
      await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
      await vi.waitFor(() => {
        expect(document.body.querySelector('[data-testid="iop-order-public-detail"]')).not.toBeNull();
      });
      const card = detailElement('iop-order-public-detail');
      expect(card.textContent).toContain('IOP · /alibaba/order/get');
      expect(card.textContent).toContain(buyerLabel);
      expect(card.textContent).toContain(amountLabel);
      expect(card.textContent).toContain(productLabel);
      expect(card.textContent).toContain('Fictional Buyer Alpha');
      expect(card.textContent).toContain('DELIVERING');
      expect(card.textContent).toContain('CAD 124.500');
      expect(card.textContent).toContain('920000000000000001');
      expect(card.textContent).toContain('Fictional reusable sample box');
      expect(card.textContent).toContain('2.50');
      expect(card.textContent).toContain('cartons');
      expect(card.textContent).toContain('CAD 49.800');
      expect(card.textContent).not.toContain('fictional-login-alpha');
      expect(card.textContent).not.toContain('EUR 80.00');
      expect(card.querySelector('button, a, input')).toBeNull();
      expect(card.hasAttribute('data-feedback-redact')).toBe(true);
      const rows = card.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(3);
      expect(rows[1]?.textContent).toContain(uiI18n.global.t('orders.notReturned'));
      expect(rows[2]?.textContent).toContain('JPY 0');
      const zeroQuantity = rows[2]?.children[2];
      if (!zeroQuantity) throw new Error('Missing fictional zero quantity');
      expect(zeroQuantity.textContent.trim()).toBe('0');
      const summary = detailElement('order-summary');
      expect(summary.textContent).toContain('fictional-login-alpha');
      expect(summary.textContent).toContain('EUR 80.00');
      expect(summary.textContent).toContain(formatDateTime(iopDetailFixture.ready.order.createdAt));
      const funds = detailElement('order-funds');
      expect(funds.textContent).toContain(uiI18n.global.t('orders.drawer.apiUnavailable'));
      expect(funds.textContent).not.toContain('124.500');
      expect(funds.textContent).not.toMatch(/USD|0\.00/);
      expect(detailElement('order-logistics').textContent).toContain('FICTIONAL-TRACK-ALPHA');
      expect(detailElement('order-full-detail-restriction').textContent).toContain('TOP ·');
      expect(document.body.textContent).not.toContain('fullDetail: jushita-only');
      expect(card.classList.contains('bg-card')).toBe(true);
      expect(card.classList.contains('text-card-foreground')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(detailElement('order-full-detail-restriction').classList.contains('dark:bg-amber-950/30')).toBe(
        true
      );
    }
  );

  it.each(['zh-CN', 'en-US'] as const)(
    'keeps a native detail error visible beside available logistics in %s',
    async (locale) => {
      localStorage.setItem(
        APP_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ uiLocale: locale, alibabaLanguage: 'en_US', theme: 'light' })
      );
      const wrapper = mountIop();
      await openFixtureOrder(wrapper, iopDetailFixture.failed.order.id);
      await vi.waitFor(() => {
        expect(document.body.querySelector('[data-testid="iop-order-public-detail-error"]')).not.toBeNull();
      });
      const error = detailElement('iop-order-public-detail-error');
      expect(error.textContent).toContain(uiI18n.global.t('errors.codes.ALIBABA_IOP_API_REJECTED'));
      expect(error.textContent).not.toContain('errors.codes.');
      expect(document.body.querySelector('[data-testid="iop-order-public-detail"]')).toBeNull();
      expect(detailElement('order-logistics').textContent).toContain('Fictional Carrier Beta');
      expect(detailElement('order-logistics').textContent).toContain('FICTIONAL-TRACK-BETA');
      expect(detailElement('order-funds').textContent).toContain(
        uiI18n.global.t('orders.drawer.apiUnavailable')
      );
      expect(detailElement('iop-order-public-source').textContent).toContain('IOP');
    }
  );

  it('keeps absent native fields unknown instead of borrowing list amounts, names or dates', async () => {
    const wrapper = mountIop();
    await openFixtureOrder(wrapper, iopDetailFixture.sparse.order.id);
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="iop-order-public-detail"]')).not.toBeNull();
    });
    const card = detailElement('iop-order-public-detail');
    expect(card.textContent).not.toContain('300.00');
    expect(card.textContent).not.toContain('USD');
    expect(card.textContent).not.toContain('fictional-login-gamma');
    expect(card.textContent).not.toContain(uiI18n.global.t('orders.drawer.createdAt'));
    expect(card.textContent).toContain(uiI18n.global.t('orders.notReturned'));
    expect(detailElement('iop-order-public-products-empty').textContent).toContain(
      uiI18n.global.t('orders.documentNotReturned')
    );
    expect(detailElement('order-logistics').textContent).toContain(
      uiI18n.global.t('orders.drawer.apiUnavailable')
    );
  });

  it('distinguishes an explicitly empty product list and preserves a real zero total', async () => {
    const wrapper = mountIop();
    await openFixtureOrder(wrapper, iopDetailFixture.emptyProducts.order.id);
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="iop-order-public-detail"]')).not.toBeNull();
    });
    expect(detailElement('iop-order-public-detail').textContent).toContain('GBP 0');
    expect(detailElement('iop-order-public-products-empty').textContent).toContain(
      uiI18n.global.t('common.data.empty')
    );
    expect(detailElement('iop-order-public-detail').querySelector('table')).toBeNull();
  });

  it('removes the previous order detail while the next native request is pending', async () => {
    const waiting = Promise.withResolvers<undefined>();
    const wrapper = mountIop(iopDetailGateway(waiting.promise));
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Fictional Buyer Alpha');
    });
    bodyButton(uiI18n.global.t('orders.drawer.nextLabel')).click();
    await flushPromises();
    expect(document.body.querySelector('[data-testid="iop-order-public-detail"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="iop-order-public-source"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Fictional Buyer Alpha');
    expect(document.body.textContent).not.toContain('FICTIONAL-TRACK-ALPHA');
    waiting.resolve(undefined);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('FICTIONAL-TRACK-BETA');
    });
    expect(document.body.querySelector('[data-testid="iop-order-public-detail-error"]')).not.toBeNull();
    bodyButton(uiI18n.global.t('common.dialog.closeDetails')).click();
    await flushPromises();
    expect(document.body.querySelector('[data-testid="iop-order-public-detail-error"]')).toBeNull();
  });

  it('does not reveal a late native response after closing or attach it to another order', async () => {
    const waiting = Promise.withResolvers<undefined>();
    const wrapper = mountIop(iopDetailGateway(waiting.promise));
    await openFixtureOrder(wrapper, iopDetailFixture.failed.order.id);
    bodyButton(uiI18n.global.t('common.dialog.closeDetails')).click();
    await flushPromises();
    waiting.resolve(undefined);
    await flushPromises();
    expect(document.body.querySelector('[data-testid="iop-order-public-detail-error"]')).toBeNull();
    expect(document.body.textContent).not.toContain('FICTIONAL-TRACK-BETA');
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Fictional Buyer Alpha');
    });
    expect(document.body.querySelector('[data-testid="iop-order-public-detail-error"]')).toBeNull();
    expect(detailElement('order-logistics').textContent).toContain('FICTIONAL-TRACK-ALPHA');
  });
});

function roleGateway(options: { listWait?: Promise<void>; detailWait?: Promise<void> } = {}) {
  const gateway = new MockGatewayClient(0);
  const original = gateway.request.bind(gateway);
  const request = vi
    .spyOn(gateway, 'request')
    .mockImplementation(
      async <K extends OperationId>(operation: K, payload: RequestOf<K>): Promise<ResponseOf<K>> => {
        if (operation === 'listTradeOrders') {
          const query = payload as RequestOf<'listTradeOrders'>;
          const aggregate = roleAggregate(query.role);
          if (aggregate.order.role === 'seller') await options.listWait;
          return {
            items: [aggregate.order],
            page: query.page,
            pageSize: query.pageSize ?? 20,
            total: 45
          } as ResponseOf<K>;
        }
        if (operation === 'getTradeOrderAggregate') {
          const order = (payload as RequestOf<'getTradeOrderAggregate'>).order;
          const role = order.role ?? 'seller';
          if (role === 'seller') await options.detailWait;
          return roleAggregate(role) as ResponseOf<K>;
        }
        return original(operation, payload);
      }
    );
  return { gateway, request };
}

function roleAggregate(role: 'seller' | 'buyer' = 'seller') {
  const aggregate = structuredClone(iopDetailFixture.ready);
  return {
    ...aggregate,
    order: { ...aggregate.order, role, status: `${role}-status`, buyerLoginId: `${role}-buyer` },
    publicDetail: { ...aggregate.publicDetail, buyerName: `${role}-detail` },
    logistics: { ...aggregate.logistics, trackingNumber: `${role}-tracking` }
  };
}

describe('OrdersView sales and purchase isolation', () => {
  const wrappers: ReturnType<typeof mountView>[] = [];
  function mountRoles(gateway: MockGatewayClient) {
    const wrapper = mountView('mock', gateway);
    wrappers.push(wrapper);
    return wrapper;
  }
  beforeEach(() => {
    localStorage.clear();
    globalThis.history.replaceState(null, '', '#/orders');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected live call')));
  });
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    uiI18n.global.locale.value = 'zh-CN';
    document.documentElement.classList.remove('dark');
  });

  it.each(['zh-CN', 'en-US'] as const)(
    'keeps purchase orders readonly, clears hidden buyer search and supports requery in %s dark mode',
    async (locale) => {
      localStorage.setItem(
        APP_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ uiLocale: locale, alibabaLanguage: 'en_US', theme: 'dark' })
      );
      const { gateway, request } = roleGateway();
      const wrapper = mountRoles(gateway);
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('seller-status');
      });
      expect(request).toHaveBeenCalledWith('listTradeOrders', { role: 'seller', page: 1, pageSize: 20 });
      const searchInput = wrapper.get('[data-testid="order-toolbar"] input');
      await searchInput.setValue('old-sales-buyer');
      await wrapper.get('form').trigger('submit');
      await vi.waitFor(() => {
        expect(request).toHaveBeenCalledWith('listTradeOrders', {
          role: 'seller',
          page: 1,
          pageSize: 20,
          buyerLoginId: 'old-sales-buyer'
        });
      });
      await button(wrapper, uiI18n.global.t('orders.roles.buyer')).trigger('click');
      await vi.waitFor(() => {
        expect(wrapper.text()).toContain('buyer-status');
      });
      expect(wrapper.find('[data-testid="order-toolbar"] input').exists()).toBe(false);
      expect(wrapper.get('[data-testid="purchase-search-notice"]').text()).toBe(
        uiI18n.global.t('orders.filters.purchaseSearchNotice')
      );
      expect(wrapper.find('[data-testid="order-workspaces"]').exists()).toBe(false);
      expect(request).toHaveBeenCalledWith('listTradeOrders', { role: 'buyer', page: 1, pageSize: 20 });
      const activeRole = wrapper.get('[data-testid="order-role-tabs"] button[aria-pressed="true"]');
      expect(activeRole.text()).toBe(uiI18n.global.t('orders.roles.buyer'));
      expect(activeRole.classes()).toContain('bg-secondary');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      const before = request.mock.calls.length;
      await wrapper.get('form').trigger('submit');
      await vi.waitFor(() => {
        expect(request.mock.calls).toHaveLength(before + 1);
      });
      await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain('buyer-detail');
      });
      expect(document.body.textContent).not.toContain(uiI18n.global.t('orders.drawer.payment'));
      expect(
        request.mock.calls.some(([op]) =>
          [
            'createTradeOrder',
            'getTradeTtAccount',
            'getTradeAddressSchema',
            'getTradeServiceCharge'
          ].includes(op)
        )
      ).toBe(false);
      bodyButton(uiI18n.global.t('common.dialog.closeDetails')).click();
      await flushPromises();
      await button(wrapper, uiI18n.global.t('orders.roles.seller')).trigger('click');
      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="order-toolbar"] input').exists()).toBe(true);
      });
      expect((wrapper.get('[data-testid="order-toolbar"] input').element as HTMLInputElement).value).toBe('');
      const purchaseQueries = request.mock.calls.filter(
        ([op, payload]) =>
          op === 'listTradeOrders' && (payload as RequestOf<'listTradeOrders'>).role === 'buyer'
      );
      expect(purchaseQueries.length).toBeGreaterThan(1);
      expect(
        purchaseQueries.every(([, payload]) => payload !== undefined && !('buyerLoginId' in payload))
      ).toBe(true);
    }
  );

  it('isolates late sales list responses from the purchase query with the same order ID', async () => {
    const waiting = Promise.withResolvers<undefined>();
    const { gateway } = roleGateway({ listWait: waiting.promise });
    const wrapper = mountRoles(gateway);
    await button(wrapper, '采购订单').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('buyer-status');
    });
    waiting.resolve(undefined);
    await flushPromises();
    expect(wrapper.text()).toContain('buyer-status');
    expect(wrapper.text()).not.toContain('seller-status');
  });

  it('resets paging and selection and rejects a late sales drawer aggregate for the same ID', async () => {
    const waiting = Promise.withResolvers<undefined>();
    const { gateway, request } = roleGateway({ detailWait: waiting.promise });
    const wrapper = mountRoles(gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('seller-status');
    });
    await wrapper.get('button[aria-label="下一页"]').trigger('click');
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith('listTradeOrders', { role: 'seller', page: 2, pageSize: 20 });
      expect(wrapper.find('tbody input[type="checkbox"]').exists()).toBe(true);
    });
    await wrapper.get('tbody input[type="checkbox"]').setValue(true);
    expect(wrapper.get('tbody input[type="checkbox"]').element).toHaveProperty('checked', true);
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await button(wrapper, '采购订单').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('buyer-status');
    });
    expect(document.body.querySelector('[data-testid="order-summary"]')).toBeNull();
    expect(wrapper.findComponent({ name: 'DataTable' }).props('page')).toBe(1);
    expect(wrapper.findComponent({ name: 'DataTable' }).props('selectionScope')).toContain('buyer');
    expect(wrapper.get('tbody input[type="checkbox"]').element).toHaveProperty('checked', false);
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('buyer-detail');
    });
    waiting.resolve(undefined);
    await flushPromises();
    expect(detailElement('iop-order-public-detail').textContent).toContain('buyer-detail');
    expect(document.body.textContent).not.toContain('seller-detail');
    expect(detailElement('order-logistics').textContent).toContain('buyer-tracking');
  });

  it('masks TT data again after switching roles and preserves the original sales hash route', async () => {
    const { gateway } = roleGateway();
    const wrapper = mountRoles(gateway);
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    bodyButton('TT 汇款').click();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')).not.toBeNull();
    });
    bodyButton('显示完整汇款账号').click();
    await flushPromises();
    const revealed = detailElement('tt-account-number').textContent;
    await button(wrapper, '采购订单').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('buyer-status');
    });
    expect(document.body.textContent).not.toContain(revealed);
    await button(wrapper, '销售订单').trigger('click');
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    expect(globalThis.location.hash).toBe(`#/orders/orders/${iopDetailFixture.ready.order.id}/overview`);
    bodyButton('TT 汇款').click();
    await vi.waitFor(() => {
      expect(document.body.querySelector('[data-testid="tt-account-number"]')).not.toBeNull();
    });
    expect(detailElement('tt-account-number').textContent).not.toBe(revealed);
    expect(detailElement('tt-account-number').textContent).toContain('•');
  });

  it('clears expanded column data and ignores a late sales page-detail result after a role change', async () => {
    localStorage.setItem(
      'one-vegetable:columns:v2:orders',
      JSON.stringify({
        version: 2,
        visible: ['select', 'id', 'status', 'trackingNumber', 'actions'],
        order: ['select', 'id', 'status', 'trackingNumber', 'actions']
      })
    );
    const waiting = Promise.withResolvers<undefined>();
    const { gateway, request } = roleGateway({ detailWait: waiting.promise });
    const wrapper = mountRoles(gateway);
    await vi.waitFor(() => {
      expect(request.mock.calls.some(([op]) => op === 'getTradeOrderAggregate')).toBe(true);
    });
    await button(wrapper, '采购订单').trigger('click');
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('buyer-status');
    });
    expect(wrapper.text()).not.toContain('seller-tracking');
    waiting.resolve(undefined);
    await vi.waitFor(() => {
      expect(wrapper.get('tbody').text()).toContain('buyer-tracking');
    });
    expect(wrapper.get('tbody').text()).not.toContain('seller-tracking');
    expect(request.mock.calls.filter(([op]) => op === 'getTradeOrderAggregate')).toHaveLength(2);
  });

  it('does not request business data when only the UI locale changes in either role', async () => {
    const { gateway, request } = roleGateway();
    const wrapper = mountRoles(gateway);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('seller-status');
    });
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('seller-detail');
    });
    const preferences = useAppPreferences();
    let before = request.mock.calls.length;
    preferences.uiLocale.value = 'en-US';
    await flushPromises();
    expect(wrapper.text()).toContain('Purchase orders');
    expect(request.mock.calls).toHaveLength(before);
    bodyButton('Close details').click();
    await flushPromises();
    await button(wrapper, 'Purchase orders').trigger('click');
    await openFixtureOrder(wrapper, iopDetailFixture.ready.order.id);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('buyer-detail');
    });
    before = request.mock.calls.length;
    preferences.uiLocale.value = 'zh-CN';
    await flushPromises();
    expect(wrapper.text()).toContain('采购订单');
    expect(request.mock.calls).toHaveLength(before);
  });
});

function settings() {
  return {
    appKey: '',
    appSecret: '',
    accessToken: '',
    endpoint: 'https://eco.taobao.com/router/rest',
    signMethod: 'hmac' as const
  };
}
