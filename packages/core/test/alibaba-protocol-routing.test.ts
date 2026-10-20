import { describe, expect, it } from 'vitest';
import { authorizationBindingMatches, selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';

const both = { top: true, iop: true, defaultProtocol: 'top' as const, bindingConfirmed: true };
describe('Alibaba protocol routing before dispatch', () => {
  it.each([false, true])(
    'routes a configured pair independently of legacy confirmation (%s)',
    (bindingConfirmed) => {
      const available = { ...both, bindingConfirmed };
      expect(selectAlibabaOperationProtocol('listProducts', {}, available)).toBe('iop');
      expect(selectAlibabaOperationProtocol('listPhotos', {}, available)).toBe('top');
      expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1' }, available)).toBe('top');
      expect(selectAlibabaOperationProtocol('updateProduct', {}, available)).toBe('iop');
      expect(selectAlibabaOperationProtocol('updateProductDisplay', {}, available)).toBe('iop');
    }
  );
  it('preserves single-profile behavior and uses the remaining profile when the default is absent', () => {
    expect(selectAlibabaOperationProtocol('listProducts', {}, { ...both, iop: false })).toBe('top');
    expect(selectAlibabaOperationProtocol('listProducts', {}, { ...both, top: false })).toBe('iop');
    expect(
      selectAlibabaOperationProtocol('listProducts', {}, { ...both, iop: false, defaultProtocol: 'iop' })
    ).toBe('top');
    expect(
      selectAlibabaOperationProtocol('listPhotos', {}, { ...both, top: false, defaultProtocol: 'iop' })
    ).toBe('iop');
  });
  it.each(['top', 'iop'] as const)(
    'routes all paired photo queries to TOP before dispatch with default %s',
    (defaultProtocol) => {
      const available = { ...both, defaultProtocol };
      for (const query of [{}, { groupId: '-1' }, { groupId: '1', ungrouped: true }, { groupId: '1' }])
        expect(selectAlibabaOperationProtocol('listPhotos', query, available)).toBe('top');
      for (const parameters of [
        { location_type: 'ALL_GROUP' },
        { location_type: 'UNGROUP' },
        { location_type: 'SUB_GROUP', group_id: '1', current_page: 1, page_size: 1 }
      ])
        expect(
          selectAlibabaOperationProtocol(
            'callCapability',
            { method: 'alibaba.icbu.photobank.list', parameters },
            available
          )
        ).toBe('top');
    }
  );
  it('preserves IOP-only selection for dedicated and generic scoped photo queries', () => {
    const available = { ...both, top: false };
    expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1' }, available)).toBe('iop');
    expect(
      selectAlibabaOperationProtocol(
        'callCapability',
        {
          method: 'alibaba.icbu.photobank.list',
          parameters: { location_type: 'SUB_GROUP', group_id: '1', current_page: 1, page_size: 1 }
        },
        available
      )
    ).toBe('iop');
  });
  it('does not claim unsupported composites, SKU or category markets are equivalent', () => {
    for (const operation of ['getDashboard', 'getTradeOrderAggregate', 'getProduct', 'listRfqs'] as const)
      expect(selectAlibabaOperationProtocol(operation, {}, both)).toBe('top');
    expect(selectAlibabaOperationProtocol('getProductInventory', { source: 'sku' }, both)).toBe('top');
    expect(selectAlibabaOperationProtocol('getProductInventory', { source: 'product' }, both)).toBe('iop');
    expect(selectAlibabaOperationProtocol('getProductSchema', { market: 'retail' }, both)).toBe('top');
  });
  it('routes only individually verified capabilities and never inherits TOP write approval', () => {
    expect(
      selectAlibabaOperationProtocol('callCapability', { method: 'alibaba.icbu.product.list' }, both)
    ).toBe('iop');
    expect(
      selectAlibabaOperationProtocol('callCapability', { method: 'alibaba.icbu.product.id.encrypt' }, both)
    ).toBe('top');
    expect(
      selectAlibabaOperationProtocol(
        'callCapability',
        { method: 'alibaba.icbu.photobank.list', parameters: { location_type: 'ALL_GROUP' } },
        both
      )
    ).toBe('top');
    expect(selectAlibabaOperationProtocol('publishProduct', {}, both)).toBe('iop');
    expect(selectAlibabaOperationProtocol('updateProductDisplay', {}, both)).toBe('iop');
  });
  it('retains TOP-only draft/category request semantics before dispatch', () => {
    expect(selectAlibabaOperationProtocol('getProductDraft', { productId: '123' }, both)).toBe('top');
    expect(
      selectAlibabaOperationProtocol('getProductDraft', { productId: '123', categoryId: 456 }, both)
    ).toBe('iop');
    expect(
      selectAlibabaOperationProtocol(
        'callCapability',
        {
          method: 'alibaba.icbu.product.schema.get',
          parameters: {
            param_product_top_publish_request: { cat_id: 456, product_id: 123 }
          }
        },
        both
      )
    ).toBe('top');
    expect(
      selectAlibabaOperationProtocol(
        'callCapability',
        {
          method: 'alibaba.icbu.product.schema.get',
          parameters: {
            param_product_top_publish_request: { cat_id: 456, market: 'wholesale' }
          }
        },
        both
      )
    ).toBe('iop');
  });
  it('retains legacy confirmation matching without treating it as a routing prerequisite', () => {
    const binding = {
      topConfigurationId: 'top-config',
      iopConfigurationId: 'iop-config',
      confirmedAtUtc: 1000
    };
    expect(authorizationBindingMatches(binding, { top: 'top-config', iop: 'iop-config' })).toBe(true);
    expect(authorizationBindingMatches(binding, { top: 'changed', iop: 'iop-config' })).toBe(false);
    expect(authorizationBindingMatches(binding, { top: 'top-config', iop: null })).toBe(false);
    expect(authorizationBindingMatches(undefined, { top: 'top-config', iop: 'iop-config' })).toBe(false);
  });
});
