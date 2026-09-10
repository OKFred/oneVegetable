import { describe, expect, it } from 'vitest';
import fixture from '../../mock/data/top-api-audit.json';
import { collectCatalog, documentData, related, summarize, markdownTable } from './top-api-inventory';

describe('TOP documentation inventory', () => {
  const item = {
    docId: 58734,
    method: 'alibaba.icbu.product.country.getcountrylist',
    title: '国家',
    categories: ['ICBU－商品']
  };
  it('deduplicates nested documents without losing categories', () => {
    expect(collectCatalog(fixture.catalog)).toEqual([
      { ...item, title: '国家列表', categories: ['ICBU－商品', '重复分类'] }
    ]);
  });
  it('selects international domains and known methods, not ordinary Taobao trading', () => {
    expect(related(item, new Set())).toBe(true);
    const domestic = { ...item, categories: ['交易API'], method: 'taobao.trade.get' };
    expect(related(domestic, new Set())).toBe(false);
    expect(related(domestic, new Set(['taobao.trade.get']))).toBe(true);
  });
  it('does not treat HTTP-success envelopes with expired sessions as documents', () => {
    expect(() => documentData(fixture.expired)).toThrow();
    expect(documentData(fixture.success)).toEqual(fixture.success.data);
  });
  it('keeps free and authorization separate', () => {
    expect(summarize(item, fixture.success.data, undefined)).toMatchObject({
      disposition: 'candidate',
      fee: '￥免费',
      auth: '必须用户授权',
      existing: null
    });
  });
  it('marks service-provider grants conditional and domestic grants out of scope', () => {
    expect(
      summarize(item, { ...fixture.success.data, applyScopes: { name: 'ACP小满' } }, undefined).disposition
    ).toBe('conditional-candidate');
    expect(
      summarize(item, { ...fixture.success.data, applyScopes: { name: '1688推客(交易相关)' } }, undefined)
        .disposition
    ).toBe('out-of-scope');
  });
  it('never treats free Jushita APIs or unknown prices as normal candidates', () => {
    expect(
      summarize(
        item,
        {
          ...fixture.success.data,
          labels: [...fixture.success.data.labels, { displayName: '聚石塔内调用' }]
        },
        undefined
      ).disposition
    ).toBe('jushita-review');
    expect(summarize(item, { ...fixture.success.data, labels: [] }, undefined).disposition).toBe(
      'fee-review'
    );
  });
  it('requires method identity and preserves existing deprecation', () => {
    expect(() => summarize(item, { ...fixture.success.data, name: 'wrong' }, undefined)).toThrow();
    expect(
      summarize(item, fixture.success.data, {
        ...item,
        docUrl: '',
        lifecycle: 'deprecated',
        enabled: false,
        realCallEnabled: false,
        jushitaOnly: false,
        restricted: false
      }).disposition
    ).toBe('lifecycle-review');
  });
  it('escapes table delimiters and uses token-free documentation links', () => {
    const text = markdownTable([summarize({ ...item, title: 'a|b' }, fixture.success.data, undefined)]);
    expect(text).toContain('a\\|b');
    expect(text).toContain('docId=58734&docType=2');
    expect(text).not.toContain('_tb_token_');
  });
});
