import { describe, expect, it } from 'vitest';
import typeFixture from '../../mock/data/product-type-available.json';
import inventory from '../../mock/data/product-inventory.json';
import showcase from '../../mock/data/showcase-list.json';
import { assessStockRead, responseShape, STOCK_SHOWCASE_METHODS } from './product-stock-smoke';

describe('controlled stock read assessment', () => {
  it('accepts proven success but never counts missing success as empty inventory', () => {
    expect(assessStockRead(typeFixture.method, typeFixture.response, true).status).toBe('passed');
    expect(assessStockRead(inventory.method, inventory.response, true).status).toBe('passed');
    expect(assessStockRead(showcase.method, showcase.response, true).recordCount).toBe(1);
    expect(assessStockRead(inventory.method, { result: { success: true, data_list: [] } }, true).status).toBe(
      'no-data'
    );
    for (const method of STOCK_SHOWCASE_METHODS)
      expect(assessStockRead(method, {}, true).status).toBe('provider-error');
    expect(assessStockRead(inventory.method, { result: { success: true } }, true).status).toBe(
      'provider-error'
    );
  });
  it('separates business rejection and contract drift from success', () => {
    expect(
      assessStockRead(typeFixture.method, { ...typeFixture.response, msg_code: 'SYS_ERROR' }, true).status
    ).toBe('provider-error');
    expect(
      assessStockRead(inventory.method, { result: { success: false, msg_code: 'NOT_SUPPORTED' } }, true)
    ).toMatchObject({ status: 'provider-error', reasonCode: 'NOT_SUPPORTED' });
    expect(assessStockRead(showcase.method, showcase.response, false).status).toBe('contract-drift');
  });
  it('diagnostics only describe types, never values or dynamic identifiers', () => {
    const shape = JSON.stringify(
      responseShape({
        subject: 'private-title',
        access_token: 'private-token',
        '1600000000123': 'private-data',
        list: [inventory.response]
      })
    );
    expect(shape).not.toMatch(/private|1600000000123/);
    expect(shape).toContain('<dynamic-key>');
  });
});
