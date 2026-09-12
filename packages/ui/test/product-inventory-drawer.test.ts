// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PRODUCT_MOCK_DATA } from '../../core/src/generated/mock-data';
import ProductInventoryDrawer from '../src/components/ProductInventoryDrawer.vue';

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
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(['—', '—', '—', '0']);
    await wrapper.get('input').setValue(' RED ');
    expect(wrapper.findAll('tbody td')).toHaveLength(1);
    expect(wrapper.get('tbody td').attributes('colspan')).toBe('4');
    await wrapper.get('input').setValue('  ');
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toEqual(['—', '—', '—', '0']);
    wrapper.unmount();
  });
});
