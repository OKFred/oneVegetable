import { describe, expect, it } from 'vitest';

import { describeProductExportDisabled, retainCurrentPageSelection } from '../src/lib/product-selection';

describe('product selection', () => {
  it('removes selected identifiers that are no longer on the current page', () => {
    expect(retainCurrentPageSelection(['1001', '1002', 'stale'], ['1002', '1003'])).toEqual(['1002']);
  });

  it('describes empty, busy and over-limit export states', () => {
    expect(describeProductExportDisabled(0, false)).toBe('请先选择要导出的商品');
    expect(describeProductExportDisabled(1, true)).toBe('商品传输任务正在执行');
    expect(describeProductExportDisabled(20, false)).toBe('');
    expect(describeProductExportDisabled(21, false)).toBe('单次最多导出 20 个商品');
  });
});
