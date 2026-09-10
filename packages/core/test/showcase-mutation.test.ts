import { describe, expect, it } from 'vitest';
import add from '../../../mock/data/showcase-add.json';
import remove from '../../../mock/data/showcase-remove.json';
import {
  findCapability,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { createAlibabaRequest, signAlibabaParameters } from '../src/signing';
import {
  mutationConfirmed,
  newShowcaseEntry,
  restorationConfirmed,
  showcaseEntries
} from '../../../scripts/lib/showcase-smoke';

const credentials = {
  appKey: 'test',
  appSecret: 'test',
  accessToken: 'test',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};
describe('controlled showcase mutations', () => {
  it.each([
    { method: 'alibaba.scbp.showcase.addproduct', key: 'product_id_list', fixture: add },
    { method: 'alibaba.scbp.showcase.deleteproduct', key: 'window_id_list', fixture: remove }
  ])('validates and signs $method as CSV without opening normal writes', async ({ method, key, fixture }) => {
    expect(findCapability(method)).toMatchObject({ risk: 'mutation', realCallEnabled: false });
    expect(await validateCapabilityRequest(method, fixture.request)).toEqual([]);
    expect(await validateCapabilityResponse(method, fixture.response)).toEqual([]);
    for (const value of [
      [],
      ['1', '1'],
      ['1,2'],
      [1],
      ['-1'],
      Array.from({ length: 21 }, (_, i) => String(i + 1))
    ]) {
      expect(await validateCapabilityRequest(method, { [key]: value })).not.toEqual([]);
      expect(() => createAlibabaRequest(credentials, method, { [key]: value })).toThrow(
        'INVALID_SHOWCASE_IDS'
      );
    }
    const { sign, ...parameters } = createAlibabaRequest(credentials, method, fixture.request);
    expect(parameters[key]).toBe('100,200');
    expect(sign).toBe(signAlibabaParameters(parameters, credentials.appSecret, credentials.signMethod));
    expect(createAlibabaRequest(credentials, 'other.method', { [key]: ['100', '200'] })[key]).toBe(
      '["100","200"]'
    );
  });
  it('requires an explicit true result', () => {
    for (const value of [{}, null, { result: false }, { result: 'true' }])
      expect(mutationConfirmed(value)).toBe(false);
    expect(mutationConfirmed({ result: true })).toBe(true);
  });
  it('only restores the unique new window, never an existing window or a product ID', () => {
    const before = [{ windowId: '100', productId: '200' }];
    const added = { windowId: '101', productId: '201' };
    expect(newShowcaseEntry(before, [...before, added], '201')).toEqual(added);
    expect(() => newShowcaseEntry(before, before, '200')).toThrow();
    expect(() => newShowcaseEntry(before, [{ windowId: '100', productId: '201' }], '201')).toThrow();
    expect(() => newShowcaseEntry(before, [added, { windowId: '102', productId: '201' }], '201')).toThrow();
    expect(restorationConfirmed(before, before, added)).toBe(true);
    expect(restorationConfirmed(before, [], added)).toBe(false);
    expect(restorationConfirmed(before, [...before, added], added)).toBe(false);
    expect(() => showcaseEntries({})).toThrow();
    expect(() =>
      showcaseEntries({ results: [{ id: Number.MAX_SAFE_INTEGER + 1, product_id: 1 }] })
    ).toThrow();
  });
});
