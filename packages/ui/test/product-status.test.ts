import { describe, expect, it } from 'vitest';

import { productStatusLabel } from '../src/lib/product-status';

describe('product status labels', () => {
  it('localizes every Alibaba product status for the user interface', () => {
    expect(productStatusLabel('online')).toBe('在线');
    expect(productStatusLabel('offline')).toBe('已下架');
    expect(productStatusLabel('draft')).toBe('草稿');
    expect(productStatusLabel('auditing')).toBe('审核中');
    expect(productStatusLabel('rejected')).toBe('已驳回');
  });
});
