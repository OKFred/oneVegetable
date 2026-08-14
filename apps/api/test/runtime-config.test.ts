import { describe, expect, it } from 'vitest';

import { readRuntimeConfiguration } from '../src/runtime-config';

describe('runtime configuration', () => {
  it('provides safe local defaults and normalizes configured values', () => {
    expect(readRuntimeConfiguration({}, 'local-node')).toMatchObject({
      apiPrefix: '/api/v1',
      environment: 'local-node',
      gatewayMode: 'mock',
      allowedOrigins: [],
      requestEventRetentionDays: 30
    });
    expect(
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_API_PREFIX: '/internal/v2',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://a.example,https://b.example',
          ONE_VEGETABLE_REQUEST_RETENTION_DAYS: '14'
        },
        'local-worker'
      )
    ).toMatchObject({
      apiPrefix: '/internal/v2',
      allowedOrigins: ['https://a.example', 'https://b.example'],
      requestEventRetentionDays: 14
    });
  });

  it('rejects unsafe staging and production settings', () => {
    expect(
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_ENVIRONMENT: 'staging',
          ONE_VEGETABLE_GATEWAY_MODE: 'replay',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://staging.example.com'
        },
        'local-worker'
      ).gatewayMode
    ).toBe('replay');
    expect(() =>
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_ENVIRONMENT: 'staging',
          ONE_VEGETABLE_GATEWAY_MODE: 'real',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://staging.example.com'
        },
        'local-worker'
      )
    ).toThrow('真实 Alibaba');
    expect(() =>
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_ENVIRONMENT: 'production',
          ONE_VEGETABLE_GATEWAY_MODE: 'mock',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://app.example.com'
        },
        'local-worker'
      )
    ).toThrow('disabled');
    expect(() =>
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_ENVIRONMENT: 'staging',
          ONE_VEGETABLE_GATEWAY_MODE: 'mock',
          ONE_VEGETABLE_CORS_ORIGINS: 'http://localhost:5173'
        },
        'local-worker'
      )
    ).toThrow('HTTPS');
    expect(() =>
      readRuntimeConfiguration(
        {
          ONE_VEGETABLE_ENVIRONMENT: 'staging',
          ONE_VEGETABLE_GATEWAY_MODE: 'mock',
          ONE_VEGETABLE_CORS_ORIGINS: 'https://staging.example.com',
          ONE_VEGETABLE_MUTATION_FLAGS: 'operation:publishProduct'
        },
        'local-worker'
      )
    ).toThrow('mutation');
  });

  it('rejects malformed prefixes, origins, modes and retention values', () => {
    expect(() => readRuntimeConfiguration({ ONE_VEGETABLE_API_PREFIX: 'api/v1' }, 'local-node')).toThrow();
    expect(() =>
      readRuntimeConfiguration({ ONE_VEGETABLE_CORS_ORIGINS: 'https://example.com/path' }, 'local-node')
    ).toThrow('Origin');
    expect(() =>
      readRuntimeConfiguration({ ONE_VEGETABLE_GATEWAY_MODE: 'unexpected' }, 'local-node')
    ).toThrow('GATEWAY_MODE');
    expect(() =>
      readRuntimeConfiguration({ ONE_VEGETABLE_REQUEST_RETENTION_DAYS: '0' }, 'local-node')
    ).toThrow('1–90');
  });
});
