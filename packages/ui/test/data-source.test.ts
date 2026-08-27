import { describe, expect, it } from 'vitest';

import { resolveDataSource } from '../src/lib/data-source';

describe('runtime data source presentation', () => {
  it('distinguishes mock, replay, real and disabled BFF data', () => {
    expect(resolveDataSource('mock').id).toBe('mock');
    expect(resolveDataSource('bff', runtime('mock')).label).toBe('BFF Mock');
    expect(resolveDataSource('bff', runtime('replay')).id).toBe('replay');
    expect(resolveDataSource('bff', runtime('real')).label).toBe('Alibaba 实时数据');
    expect(resolveDataSource('bff', runtime('disabled')).id).toBe('unavailable');
  });

  it('does not describe an unreachable BFF as mock data', () => {
    const result = resolveDataSource('bff', { backendMeta: null, metaStatus: 'error' });
    expect(result.id).toBe('unavailable');
    expect(result.description).toContain('不会回退 Mock');
  });
});

function runtime(gatewayMode: 'mock' | 'replay' | 'disabled' | 'real') {
  return {
    backendMeta: {
      runtime: 'node' as const,
      database: 'sqlite' as const,
      environment: 'test',
      gatewayMode,
      apiPrefix: '/api/v1',
      version: '2.0.1'
    },
    metaStatus: 'ready' as const
  };
}
