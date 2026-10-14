import { describe, expect, it } from 'vitest';
import { authorizationBindingMatches, selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';

const both = { top: true, iop: true, defaultProtocol: 'top' as const, bindingConfirmed: true };
describe('Alibaba protocol routing before dispatch', () => {
  it('preserves single-profile behavior and never silently activates an unconfirmed pair', () => {
    expect(selectAlibabaOperationProtocol('listProducts', {}, { ...both, bindingConfirmed: false })).toBe(
      'top'
    );
    expect(selectAlibabaOperationProtocol('listProducts', {}, { ...both, iop: false })).toBe('top');
    expect(
      selectAlibabaOperationProtocol('listPhotos', {}, { ...both, top: false, defaultProtocol: 'iop' })
    ).toBe('iop');
  });
  it('routes whole-bank and ungrouped queries to TOP while verified specific groups use IOP', () => {
    for (const query of [{}, { groupId: '-1' }, { groupId: '1', ungrouped: true }])
      expect(selectAlibabaOperationProtocol('listPhotos', query, both)).toBe('top');
    expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1' }, both)).toBe('iop');
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
    expect(selectAlibabaOperationProtocol('updateProductDisplay', {}, both)).toBe('top');
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
  it('invalidates a confirmation when either configuration changes, not on token refresh', () => {
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
