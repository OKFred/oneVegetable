import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingConfiguration, shippingQuote, shippingQuoteResult } from './shipping-services-fixture';

const mocks = vi.hoisted(() => ({ send: vi.fn(), permission: vi.fn() }));
vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: mocks.send }, permissions: { request: mocks.permission } }
}));
import { extensionShippingServices as client } from '../lib/shipping-services-client';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(true);
  mocks.send.mockImplementation((message: { action: string; requestId: string }) =>
    Promise.resolve({
      requestId: message.requestId,
      ok: true,
      data:
        message.action === 'quote'
          ? shippingQuoteResult(message.requestId)
          : message.action === 'clear'
            ? null
            : {
                provider: 'freightos',
                configured: true,
                revision: 1,
                updatedAtUtc: Date.now()
              }
    })
  );
});

describe('extension shipping control client', () => {
  it('requests only the exact host directly in the save/quote gesture, never on reads or clear', async () => {
    expect(mocks.permission).not.toHaveBeenCalled();
    await client.configuration('freightos');
    await client.clearConfiguration('freightos', 1);
    expect(mocks.permission).not.toHaveBeenCalled();
    const save = client.saveConfiguration(shippingConfiguration);
    expect(mocks.permission).toHaveBeenCalledOnce();
    await save;
    await client.quote(shippingQuote());
    expect(mocks.permission).toHaveBeenCalledTimes(2);
    expect(mocks.permission).toHaveBeenLastCalledWith({ origins: ['https://ship.freightos.com/*'] });
    expect(mocks.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'shipping-services-request', action: 'quote' })
    );
  });

  it('sends neither keys nor quote data when host permission is denied', async () => {
    mocks.permission.mockResolvedValue(false);
    await expect(client.saveConfiguration(shippingConfiguration)).rejects.toMatchObject({
      code: 'SHIPPING_PERMISSION_REQUIRED'
    });
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({
      code: 'SHIPPING_PERMISSION_REQUIRED'
    });
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.permission.mockRejectedValueOnce(new Error('private browser error'));
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({
      code: 'SHIPPING_PERMISSION_REQUIRED',
      message: 'SHIPPING_PERMISSION_REQUIRED'
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects unsupported provider and missing consent before permissions or messaging', async () => {
    await expect(
      client.saveConfiguration({ ...shippingConfiguration, provider: 'easyship' as 'freightos' })
    ).rejects.toMatchObject({ code: 'SHIPPING_REQUEST_INVALID' });
    await expect(
      client.quote({ ...shippingQuote(), consent: { dataSharing: true, costAcknowledged: false } })
    ).rejects.toMatchObject({ code: 'SHIPPING_CONSENT_REQUIRED' });
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uses shared result validation, rejects mismatched IDs and never returns a key-bearing summary', async () => {
    mocks.send.mockResolvedValue({ requestId: crypto.randomUUID(), ok: true, data: {} });
    await expect(client.configuration('freightos')).rejects.toMatchObject({
      code: 'SHIPPING_RESPONSE_INVALID'
    });
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({
        requestId: message.requestId,
        ok: true,
        data: {
          provider: 'freightos',
          configured: true,
          revision: 1,
          updatedAtUtc: Date.now(),
          apiKey: shippingConfiguration.apiKey
        }
      })
    );
    await expect(client.configuration('freightos')).rejects.toMatchObject({
      code: 'SHIPPING_RESPONSE_INVALID'
    });
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({
        requestId: message.requestId,
        ok: true,
        data: shippingQuoteResult(crypto.randomUUID())
      })
    );
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({ code: 'SHIPPING_RESPONSE_INVALID' });
  });

  it('propagates stable safe error codes only and never retries an unknown runtime failure', async () => {
    mocks.send.mockImplementation((message: { requestId: string }) =>
      Promise.resolve({
        requestId: message.requestId,
        ok: false,
        error: { code: 'SHIPPING_LOCAL_DAILY_LIMIT', message: shippingConfiguration.apiKey }
      })
    );
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({
      code: 'SHIPPING_LOCAL_DAILY_LIMIT',
      message: 'SHIPPING_LOCAL_DAILY_LIMIT'
    });
    mocks.send.mockRejectedValueOnce(new Error(shippingConfiguration.apiKey));
    await expect(client.quote(shippingQuote())).rejects.toMatchObject({
      code: 'SHIPPING_RUNTIME_FAILED',
      message: 'SHIPPING_RUNTIME_FAILED'
    });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
