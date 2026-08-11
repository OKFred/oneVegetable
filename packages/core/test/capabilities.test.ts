import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { API_CAPABILITIES } from '../src/generated/capabilities';

describe('Alibaba API audit snapshot', () => {
  it('contains the audited 84 free non-Jushita APIs', () => {
    const methods = new Set<string>(API_CAPABILITIES.map((item) => item.method));
    expect(API_CAPABILITIES).toHaveLength(84);
    expect(new Set(API_CAPABILITIES.map((item) => item.jushitaOnly))).toEqual(new Set([false]));
    expect(methods.has('alibaba.seller.order.get')).toBe(false);
  });

  it('keeps restricted ISV APIs disabled', () => {
    const restricted = API_CAPABILITIES.filter((item) => item.restricted);
    expect(restricted.length).toBeGreaterThan(0);
    expect(new Set(restricted.map((item) => item.enabled))).toEqual(new Set([false]));
  });

  it('keeps the generated catalog synchronized with the checked-in audit count', async () => {
    const raw = await readFile(resolve(import.meta.dirname, '../../../docs/alibaba-api-audit.json'), 'utf8');
    const snapshot = JSON.parse(raw) as { count: number };
    expect(snapshot.count).toBe(API_CAPABILITIES.length);
  });
});
