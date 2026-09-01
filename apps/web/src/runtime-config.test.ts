import { describe, expect, it } from 'vitest';

import { readWebGatewayMode, resolveWebBffBaseUrl } from './runtime-config';

describe('Web runtime configuration', () => {
  it('keeps the standalone Web default explicit as mock', () => {
    expect(readWebGatewayMode(undefined)).toBe('mock');
    expect(readWebGatewayMode('')).toBe('mock');
  });

  it('accepts only the supported gateway modes', () => {
    expect(readWebGatewayMode('mock')).toBe('mock');
    expect(readWebGatewayMode('bff')).toBe('bff');
    expect(() => readWebGatewayMode('real')).toThrow('VITE_GATEWAY_MODE 无效');
    expect(() => readWebGatewayMode('BFF')).toThrow('VITE_GATEWAY_MODE 无效');
  });

  it('uses the current origin when the BFF base URL is not configured', () => {
    expect(resolveWebBffBaseUrl(undefined, 'https://one-vegetable.example')).toBe(
      'https://one-vegetable.example'
    );
    expect(resolveWebBffBaseUrl('', 'https://one-vegetable.example')).toBe('https://one-vegetable.example');
    expect(resolveWebBffBaseUrl('   ', 'https://one-vegetable.example')).toBe(
      'https://one-vegetable.example'
    );
  });

  it('keeps an explicitly configured BFF base URL', () => {
    expect(resolveWebBffBaseUrl(' https://api.example.com ', 'https://one-vegetable.example')).toBe(
      'https://api.example.com'
    );
  });
});
