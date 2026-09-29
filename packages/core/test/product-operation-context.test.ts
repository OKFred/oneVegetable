import { describe, expect, it } from 'vitest';
import {
  assertProductOperationContext,
  createProductOperationContext,
  isProductOperationContext,
  requireProductOperationContext
} from '../src/product-operation-context';

describe('product operation context', () => {
  const credentials = {
    endpoint: 'https://eco.taobao.com/router/rest',
    appKey: 'test',
    appSecret: 'secret',
    accessToken: 'initial',
    galleryAccountGeneration: 'bundle-1',
    signMethod: 'hmac' as const
  };
  it('is independent from token refresh and contains no raw identities or credentials', async () => {
    const context = await createProductOperationContext('admin', credentials);
    expect(isProductOperationContext(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual(['gateway', 'identity']);
    expect(JSON.stringify(context)).not.toContain('secret');
    expect(await createProductOperationContext('admin', { ...credentials, accessToken: 'renewed' })).toEqual(
      context
    );
  });
  it('rejects identity or credential replacement', async () => {
    const current = await createProductOperationContext('admin', credentials);
    const other = await createProductOperationContext('other', credentials);
    expect(() => {
      assertProductOperationContext(current, other);
    }).toThrow('PRODUCT_CONTEXT_CHANGED');
    const changed = await createProductOperationContext('admin', {
      ...credentials,
      galleryAccountGeneration: 'bundle-2'
    });
    expect(() => {
      assertProductOperationContext(current, changed);
    }).toThrow('PRODUCT_CONTEXT_CHANGED');
    expect(() => {
      assertProductOperationContext(current, current);
    }).not.toThrow();
  });
  it('rejects malformed and credential-bearing objects', () => {
    for (const value of [
      null,
      [],
      {},
      { identity: 'a', gateway: 'b' },
      { identity: 'a'.repeat(64), gateway: 'b'.repeat(64), token: 'secret' }
    ]) {
      expect(() => requireProductOperationContext(value)).toThrow('PRODUCT_CONTEXT_INVALID');
    }
  });
});
