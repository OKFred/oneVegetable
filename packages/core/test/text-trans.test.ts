import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  findCapability,
  getCapabilityDefinition,
  validateCapabilityRequest,
  validateCapabilityResponse
} from '../src/capability-registry';
import { createAlibabaRequest } from '../src/signing';

const method = 'alibaba.icbu.text.trans';
const fixture = JSON.parse(
  readFileSync(new URL('../../../mock/data/text-trans.json', import.meta.url), 'utf8')
) as {
  request: { icbu_translate_task_dto: Record<string, string>[] };
  response: { result: Record<string, unknown>[] };
};
describe('ICBU translation', () => {
  it('is documented, free, token-free and not claimed account-verified', () => {
    expect(findCapability(method)).toMatchObject({
      auth: 'none',
      chargeLabel: '￥免费',
      verification: 'documented',
      enabled: true
    });
    expect(getCapabilityDefinition(method)?.docUrl).toContain('docId=67157');
  });
  it('validates a batch and rejects malformed tasks and query HTML', async () => {
    expect(await validateCapabilityRequest(method, fixture.request)).toEqual([]);
    for (const value of [
      [],
      {},
      [{ ...fixture.request.icbu_translate_task_dto[0], field_type: 'query', format: 'html' }],
      [{ ...fixture.request.icbu_translate_task_dto[0], source_text: '' }]
    ]) {
      expect(await validateCapabilityRequest(method, { icbu_translate_task_dto: value })).not.toEqual([]);
    }
  });
  it('preserves per-item failures and reports response drift', async () => {
    expect(await validateCapabilityResponse(method, fixture.response)).toEqual([]);
    expect(
      await validateCapabilityResponse(method, {
        result: [{ success: false, error_code: { code: '10001', display_text: 'Params is illegal' } }]
      })
    ).toEqual([]);
    expect(await validateCapabilityResponse(method, { result: [{}] })).not.toEqual([]);
  });
  it('serializes arrays once and signs without a session while preserving other methods', () => {
    const credentials = {
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      endpoint: 'https://eco.taobao.com/router/rest',
      signMethod: 'hmac' as const
    };
    const signed = createAlibabaRequest(credentials, method, fixture.request);
    expect(signed.session).toBeUndefined();
    expect(signed.icbu_translate_task_dto).toBe(JSON.stringify(fixture.request.icbu_translate_task_dto));
    expect(signed.sign).toBeTruthy();
    expect(createAlibabaRequest(credentials, 'alibaba.icbu.product.list', {}).session).toBe('token');
  });
});
