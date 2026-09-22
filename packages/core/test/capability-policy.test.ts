import { afterEach, describe, expect, it, vi } from 'vitest';
import * as registry from '../src/capability-registry';
import { authorizeCapabilityCall, capabilityCallRisk } from '../src/capability-policy';
import { capabilityRequiresSession } from '../src/transport-security';
import { executeCapabilityCall, redactCapabilityResponse } from '../src/capability-call';
import { createAlibabaRequest, createAlibabaSyncRequest } from '../src/signing';

const method = 'alibaba.icbu.product.list';
const capability = requireValue(registry.findCapability(method));
const definition = requireValue(registry.getCapabilityDefinition(method));
function requireValue<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test capability');
  return value;
}
const credentials = {
  appKey: 'app-key',
  appSecret: 'secret',
  accessToken: 'private-token',
  endpoint: 'https://eco.taobao.com/router/rest',
  signMethod: 'hmac' as const
};
afterEach(() => vi.restoreAllMocks());

describe('generic capability security policy', () => {
  it('requires both catalog and definition to permit a real read', () => {
    expect(authorizeCapabilityCall({ method, parameters: {} }).allowed).toBe(true);
    const catalog = vi.spyOn(registry, 'findCapability');
    const typed = vi.spyOn(registry, 'getCapabilityDefinition');
    for (const patch of [
      { enabled: false },
      { restricted: true },
      { jushitaOnly: true },
      { realCallEnabled: false },
      { risk: 'mutation' as const }
    ]) {
      catalog.mockReturnValue({ ...capability, ...patch });
      expect(authorizeCapabilityCall({ method, parameters: {} }).allowed).toBe(false);
    }
    catalog.mockReturnValue(capability);
    for (const patch of [{ restricted: true }, { realCallEnabled: false }, { risk: 'mutation' as const }]) {
      typed.mockReturnValue({ ...definition, ...patch });
      expect(authorizeCapabilityCall({ method, parameters: {} }).allowed).toBe(false);
    }
    typed.mockReturnValue(null);
    expect(capabilityCallRisk(method)).toBe('mutation');
    expect(authorizeCapabilityCall({ method, parameters: {} }).reasonCode).toBe('CAPABILITY_UNKNOWN');
  });

  it('retains deprecated reads with an advisory warning, still honoring the explicit disable flags', () => {
    const catalog = vi
      .spyOn(registry, 'findCapability')
      .mockReturnValue({ ...capability, lifecycle: 'deprecated' });
    vi.spyOn(registry, 'getCapabilityDefinition').mockReturnValue({ ...definition, lifecycle: 'deprecated' });
    expect(authorizeCapabilityCall({ method, parameters: {} })).toMatchObject({
      allowed: true,
      warningCode: 'CAPABILITY_DEPRECATED'
    });
    catalog.mockReturnValue({ ...capability, lifecycle: 'deprecated', realCallEnabled: false });
    expect(authorizeCapabilityCall({ method, parameters: {} }).allowed).toBe(false);
    catalog.mockReturnValue({ ...capability, lifecycle: 'deprecated', enabled: false });
    expect(authorizeCapabilityCall({ method, parameters: {} }).allowed).toBe(false);
  });

  it('fails closed on unknown, inherited and conflicting target risk metadata', () => {
    for (const target of ['', 'constructor', '__proto__', 'toString', 'unknown', null]) {
      expect(capabilityCallRisk(target)).toBe('mutation');
      expect(authorizeCapabilityCall({ method: target, parameters: {} }).allowed).toBe(false);
      if (typeof target === 'string') expect(registry.getCapabilityDefinition(target)).toBeNull();
    }
    vi.spyOn(registry, 'findCapability').mockReturnValue({ ...capability, risk: 'mutation' });
    expect(capabilityCallRisk(method)).toBe('mutation');
    expect(
      authorizeCapabilityCall(Object.create({ method, parameters: {} }) as Record<string, unknown>).allowed
    ).toBe(false);
  });

  it.each([null, [], 'raw', undefined])('rejects malformed business parameters %j', (parameters) => {
    expect(authorizeCapabilityCall({ method, parameters }).reasonCode).toBe('REQUEST_CONTRACT_INVALID');
  });

  it.each(['method', 'session', 'app_key', 'sign', 'sign_method', 'format', 'simplify', 'timestamp', 'v'])(
    'rejects transport override %s in the debugger and both signing protocols',
    (key) => {
      const parameters = { [key]: 'attacker-controlled' };
      expect(authorizeCapabilityCall({ method, parameters }).reasonCode).toBe(
        'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN'
      );
      for (const sign of [createAlibabaRequest, createAlibabaSyncRequest]) {
        expect(() => sign(credentials, method, parameters)).toThrow();
      }
    }
  );

  it('uses generated no-session metadata without consulting the heavy registry or changing credentials', () => {
    const entries = registry.listCapabilities();
    const lookup = vi.spyOn(registry, 'findCapability').mockImplementation(() => {
      throw new Error('Signing must not consult the capability registry');
    });
    for (const entry of entries) {
      expect(capabilityRequiresSession(entry.method), entry.method).toBe(entry.auth !== 'none');
      for (const sign of [createAlibabaRequest, createAlibabaSyncRequest]) {
        // Showcase mutation signing requires IDs, unrelated to session selection.
        const parameters =
          entry.method === 'alibaba.scbp.showcase.addproduct'
            ? { product_id_list: ['1'] }
            : entry.method === 'alibaba.scbp.showcase.deleteproduct'
              ? { window_id_list: ['1'] }
              : {};
        const result = sign(credentials, entry.method, parameters);
        expect(result.session, entry.method).toBe(
          entry.auth === 'none' ? undefined : credentials.accessToken
        );
        expect(result.sign).toBeTruthy();
      }
    }
    expect(capabilityRequiresSession('unknown')).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    expect(credentials.accessToken).toBe('private-token');
  });

  it('omits session for every catalog auth:none method in TOP and sync requests', () => {
    const methods = registry.listCapabilities().filter((entry) => entry.auth === 'none');
    expect(methods.length).toBeGreaterThan(0);
    for (const entry of methods) {
      for (const sign of [createAlibabaRequest, createAlibabaSyncRequest]) {
        expect(Object.hasOwn(sign(credentials, entry.method, {}), 'session'), entry.method).toBe(false);
      }
    }
  });

  it('redacts nested and JSON-string token responses without modifying credential/provider objects', async () => {
    const raw = {
      result: {
        access_token: 'access-secret',
        refreshToken: 'refresh-secret',
        token: 'token-secret',
        ecology_token: 'ecology-secret',
        dropshipping_token: 'dropshipping-secret',
        customToken: 'custom-secret',
        expires_in: 3600,
        nested: [{ app_secret: 'app-secret', count: 1 }],
        json: JSON.stringify({ accessToken: 'json-secret', success: true })
      }
    };
    const call = vi.fn().mockResolvedValue({ method, data: raw });
    const validateCapabilityResponse = vi.fn().mockResolvedValue([]);
    const result = await executeCapabilityCall(
      { call },
      { method, parameters: {} },
      {
        validateCapabilityRequest: vi.fn().mockResolvedValue([]),
        validateCapabilityResponse
      },
      'trace'
    );
    expect(validateCapabilityResponse).toHaveBeenCalledWith(method, raw);
    expect(result).toMatchObject({
      data: {
        result: {
          access_token: '[redacted]',
          refreshToken: '[redacted]',
          token: '[redacted]',
          ecology_token: '[redacted]',
          dropshipping_token: '[redacted]',
          customToken: '[redacted]',
          expires_in: 3600
        }
      },
      contractValid: true
    });
    expect(JSON.stringify(result)).not.toContain('-secret');
    expect(raw.result.access_token).toBe('access-secret');
    expect(redactCapabilityResponse({ description: 'normal text', total: 0 })).toEqual({
      description: 'normal text',
      total: 0
    });
  });

  it.each([
    { result: { value: { success: false, error_code: 'BUSINESS_DENIED' } } },
    {
      result: { call_success: false, values: { value: [{ biz_success: false, error_code: { code: 'E1' } }] } }
    },
    { result: { error_code: 'BUSINESS_DENIED' } },
    { result: { values: { value: [{ id: '1' }, { id: '2' }] } } }
  ])('unwraps only the TOP root and never promotes shape validity to business success (%j)', async (data) => {
    const call = vi
      .fn()
      .mockResolvedValue({ method, data: { [`${method.replaceAll('.', '_')}_response`]: data } });
    const validateCapabilityResponse = vi.fn().mockResolvedValue([]);
    const result = await executeCapabilityCall(
      { call },
      { method, parameters: {} },
      {
        validateCapabilityRequest: vi.fn().mockResolvedValue([]),
        validateCapabilityResponse
      },
      'trace'
    );
    expect(validateCapabilityResponse).toHaveBeenCalledWith(method, data);
    expect(result).toEqual({ method, traceId: 'trace', data, contractValid: true, contractIssues: [] });
  });
});
