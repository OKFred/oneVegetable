// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { MockGatewayClient } from '@one-vegetable/core/mock';
import { PRODUCT_MOCK_DATA } from '../../core/src/generated/mock-data';
import ProductInventoryDrawer from '../src/components/ProductInventoryDrawer.vue';
import { provideServices } from '../src/lib/services';
import { uiI18n } from '../src/i18n';
import { formatDateTime } from '../src/lib/date-time';

describe('inventory partial response display', () => {
  it('keeps rows with missing identifiers visible until an explicit search is entered', async () => {
    const wrapper = mount(ProductInventoryDrawer, {
      props: {
        product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
        source: 'product',
        busy: false,
        snapshot: {
          ...PRODUCT_MOCK_DATA.responses.getProductInventory,
          status: 'drift',
          issues: ['records/0:missing-fields'],
          records: [{ skuId: null, skuOuterId: null, inventoryCode: null, inventory: 0 }]
        }
      },
      global: { stubs: { Sheet: { template: '<div><slot /></div>' } } }
    });
    expect(
      wrapper
        .findAll('tbody td')
        .slice(1, -1)
        .map((cell) => cell.text())
    ).toEqual(['—', '—', '—', '0']);
    expect(wrapper.get('[data-testid="platform-readback-notice"]').text()).toContain('同步可能有延迟');
    await wrapper.get('input').setValue(' RED ');
    expect(wrapper.findAll('tbody td')).toHaveLength(1);
    expect(wrapper.get('tbody td').attributes('colspan')).toBe('6');
    await wrapper.get('input').setValue('  ');
    expect(
      wrapper
        .findAll('tbody td')
        .slice(1, -1)
        .map((cell) => cell.text())
    ).toEqual(['—', '—', '—', '0']);
    wrapper.unmount();
  });
  it.each(['product', 'absolute'] as const)(
    'shows %s refresh errors alongside the dated snapshot and clears them after successful retry',
    async (source) => {
      const state = reactive<{ busy: boolean; error: unknown }>({ busy: false, error: undefined });
      const snapshot = {
        ...PRODUCT_MOCK_DATA.responses.getProductInventory,
        source,
        protocol: 'iop' as const,
        ...(source === 'absolute'
          ? {
              records: [],
              quantityEvidence: [
                {
                  scope: 'spu' as const,
                  skuId: null,
                  status: 'available' as const,
                  quantity: '0',
                  reasonCode: null
                }
              ]
            }
          : {})
      };
      const wrapper = mount(
        defineComponent({
          setup() {
            provideServices({
              gateway: new MockGatewayClient(0),
              mode: 'mock',
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
              h(ProductInventoryDrawer, {
                product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
                snapshot,
                source,
                ...state
              });
          }
        }),
        { global: { stubs: { Sheet: { template: '<div><slot /></div>' } } } }
      );
      try {
        const cells = wrapper.findAll('tbody td').map((cell) => cell.text());
        state.error = new Error('Inventory refresh timed out');
        await nextTick();
        expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.failed'));
        expect(wrapper.get('[role="alert"]').text()).toContain('Inventory refresh timed out');
        expect(wrapper.text()).toContain('mock-inventory');
        expect(wrapper.text()).toContain(uiI18n.global.t('inventory.previousSnapshot'));
        expect(wrapper.text()).toContain(formatDateTime(snapshot.queriedAt));
        expect(wrapper.text()).toContain('IOP');
        expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(cells);
        state.busy = true;
        await nextTick();
        expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.loading'));
        state.busy = false;
        state.error = undefined;
        await nextTick();
        expect(wrapper.get('[aria-live="polite"]').text()).toBe(
          uiI18n.global.t(source === 'absolute' ? 'inventory.evidenceReady' : 'inventory.ready')
        );
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      } finally {
        wrapper.unmount();
      }
    }
  );
  it.each(['zh-CN', 'en-US'] as const)(
    'keeps SPU/SKU quantities separate, exact and read-only in %s',
    async (locale) => {
      const previous = uiI18n.global.locale.value;
      uiI18n.global.locale.value = locale;
      const wrapper = mount(ProductInventoryDrawer, {
        props: {
          product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
          source: 'absolute',
          busy: false,
          snapshot: {
            ...PRODUCT_MOCK_DATA.responses.getProductInventory,
            source: 'absolute',
            protocol: 'iop',
            records: [],
            quantityEvidence: [
              { scope: 'spu', skuId: null, status: 'available', quantity: '0', reasonCode: null },
              {
                scope: 'sku',
                skuId: '9223372036854775807',
                status: 'available',
                quantity: '9223372036854775807',
                reasonCode: null
              },
              {
                scope: 'sku',
                skuId: '2',
                status: 'unavailable',
                quantity: null,
                reasonCode: 'QUANTITY_MISSING'
              }
            ]
          }
        },
        global: { stubs: { Sheet: { template: '<div><slot name="toolbar" /><slot /></div>' } } }
      });
      try {
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0]?.text()).toContain(uiI18n.global.t('inventory.spuScope'));
        expect(rows[0]?.findAll('td').map((cell) => cell.text())).toContain('0');
        expect(rows[1]?.findAll('td').filter((cell) => cell.text() === '9223372036854775807')).toHaveLength(
          2
        );
        expect(rows[1]?.text()).toContain('SKU');
        expect(rows[2]?.find('[title="QUANTITY_MISSING"]').exists()).toBe(true);
        expect(rows[2]?.text()).toContain(uiI18n.global.t('inventory.unavailable'));
        expect(rows[2]?.findAll('td').map((cell) => cell.text())).not.toContain('0');
        expect(wrapper.get('[data-testid="inventory-evidence-count"]').text()).toContain('2/3');
        expect(wrapper.text()).toContain(uiI18n.global.t('inventory.absoluteNote'));
        expect(wrapper.findAll('thead th').map((cell) => cell.text())).not.toContain(
          uiI18n.global.t('inventory.inventoryCode')
        );
        expect(
          wrapper
            .get('select')
            .findAll('option')
            .map((option) => option.attributes('value'))
        ).toEqual(['product', 'sku', 'absolute']);
        expect(
          wrapper.findAll('button').some((button) => /写入|保存库存|Write|Save inventory/.test(button.text()))
        ).toBe(false);
        await wrapper.get('select').setValue('absolute');
        expect(wrapper.emitted('source')).toEqual([['absolute']]);
      } finally {
        wrapper.unmount();
        uiI18n.global.locale.value = previous;
      }
    }
  );
  it.each([false, true])('does not call missing absolute quantities zero or ready (empty=%s)', (empty) => {
    const wrapper = mount(ProductInventoryDrawer, {
      props: {
        product: PRODUCT_MOCK_DATA.responses.listProducts.items[0] ?? null,
        source: 'absolute',
        busy: false,
        snapshot: {
          ...PRODUCT_MOCK_DATA.responses.getProductInventory,
          source: 'absolute',
          status: 'no-data',
          records: [],
          quantityEvidence: empty
            ? []
            : [
                {
                  scope: 'spu',
                  skuId: null,
                  status: 'unavailable',
                  quantity: null,
                  reasonCode: 'QUANTITY_MISSING'
                }
              ]
        }
      },
      global: { stubs: { Sheet: { template: '<div><slot /></div>' } } }
    });
    try {
      expect(wrapper.get('[aria-live="polite"]').text()).toBe(uiI18n.global.t('inventory.noQuantity'));
      expect(wrapper.findAll('tbody td').map((cell) => cell.text())).not.toContain('0');
      expect(wrapper.text()).not.toContain(uiI18n.global.t('inventory.evidenceReady'));
      expect(wrapper.text()).not.toContain('IOP');
    } finally {
      wrapper.unmount();
    }
  });
});
