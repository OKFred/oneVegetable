import { describe, expect, it, vi } from 'vitest';
import { BffControlClient } from '../src/control-client';
import { validateProductMaintenanceServiceResult } from '../src/product-maintenance-control';
import { parseProductMaintenanceRecord } from '../src/product-maintenance-service';
import type { NetworkTransport } from '../src/network';
import records from '../../../mock/data/product-maintenance-repository.json';
import fixture from '../../../mock/data/product-maintenance-bridge.json';

const task = () => {
  const value = parseProductMaintenanceRecord(records.records.inventory).task;
  value.requestId = fixture.requestId;
  return value;
};
function transport(data: unknown) {
  return vi.fn<NetworkTransport['send']>((input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    expect(url.pathname).toBe('/api/v1/product-maintenance/call');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('fixture-csrf');
    if (typeof init.body !== 'string') throw new Error('Expected JSON');
    const body = JSON.parse(init.body) as { requestId: string };
    return Promise.resolve(Response.json({ requestId: body.requestId, ok: true, data }));
  });
}
describe('BFF maintenance validation boundary', () => {
  it('refuses before sending if a lazy UI validator has not been provided', async () => {
    const send = transport({ tasks: [] });
    const client = new BffControlClient({ baseUrl: 'https://workbench.example.test', transport: { send } });
    await expect(client.productMaintenance({ action: 'list' }, task().context)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_VALIDATION_UNAVAILABLE'
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('validates once and preserves the request identity without an automatic retry', async () => {
    const record = task();
    const send = transport({ tasks: [record] });
    const validate = vi.fn(validateProductMaintenanceServiceResult);
    const client = new BffControlClient({
      baseUrl: 'https://workbench.example.test',
      transport: { send },
      csrfToken: () => 'fixture-csrf',
      productMaintenanceResultValidator: validate
    });
    const result = await client.productMaintenance({ action: 'list' }, record.context, fixture.requestId);
    expect(result.tasks[0]?.id).toBe(record.id);
    expect(validate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(new Headers(send.mock.calls[0]?.[1].headers).get('X-Request-ID')).toBe(fixture.requestId);
  });
  it('does not expose a malformed response as a verified maintenance result', async () => {
    const send = transport({ tasks: [null] });
    const client = new BffControlClient({
      baseUrl: 'https://workbench.example.test',
      transport: { send },
      csrfToken: () => 'fixture-csrf',
      productMaintenanceResultValidator: validateProductMaintenanceServiceResult
    });
    await expect(client.productMaintenance({ action: 'list' }, task().context)).rejects.toThrow(
      'PRODUCT_MAINTENANCE_RESPONSE_INVALID'
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
