import { describe, expect, it } from 'vitest';

import { readWebGatewayMode } from './runtime-config';

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
});
