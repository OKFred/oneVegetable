import { describe, expect, it } from 'vitest';

import { findCapabilityWithAccountVerification, type ApiCapability } from '@one-vegetable/core';

import { capabilityMatrix } from '../src/lib/capability-matrix';
import { resolveDataSource } from '../src/lib/data-source';

describe('capabilityMatrix', () => {
  it('separates typed contract, replay coverage, account snapshot and current source', () => {
    const capability = requiredCapability('alibaba.icbu.product.list');
    const matrix = capabilityMatrix(capability, resolveDataSource('mock'));

    expect(matrix.contract.label).toBe('已类型化');
    expect(matrix.replay.label).toBe('CI 已覆盖');
    expect(matrix.account.label).toBe('账号通过');
    expect(matrix.current.label).toBe('Mock 数据');
  });

  it('keeps a historical permission denial separate from an open real gateway', () => {
    const capability = requiredCapability('alibaba.icbu.rfq.search');
    const matrix = capabilityMatrix(
      capability,
      resolveDataSource('bff', {
        metaStatus: 'ready',
        backendMeta: backendMeta('real')
      })
    );

    expect(matrix.account.label).toBe('账号无权限');
    expect(matrix.account.detail).toContain('isv.permission-api-package-limit');
    expect(matrix.current.label).toBe('实时入口开放');
    expect(matrix.current.detail).toContain('仍可能被账号权限拒绝');
  });

  it('shows mutation and restriction gates before the runtime source', () => {
    const base = requiredCapability('alibaba.icbu.quotation.post');
    expect(capabilityMatrix(base, resolveDataSource('mock')).current.label).toBe('写入关闭');

    const restricted: ApiCapability = {
      ...base,
      restricted: true,
      restrictionReason: '需要专用业务上下文'
    };
    const matrix = capabilityMatrix(restricted, resolveDataSource('mock'));
    expect(matrix.current.label).toBe('能力受限');
    expect(matrix.current.detail).toBe('需要专用业务上下文');
  });

  it('falls back to not tested when a capability has no account snapshot', () => {
    const capability: ApiCapability = {
      ...requiredCapability('alibaba.icbu.product.list'),
      accountVerificationStatus: 'not-tested',
      accountVerificationReasonCode: null,
      accountVerificationCheckedAt: null
    };
    expect(capabilityMatrix(capability, resolveDataSource('mock')).account.label).toBe('未测试');
  });
});

function requiredCapability(method: string): ApiCapability {
  const capability = findCapabilityWithAccountVerification(method);
  if (!capability) throw new Error(`Missing capability ${method}`);
  return capability;
}

function backendMeta(gatewayMode: 'real') {
  return {
    apiPrefix: '/api/v1',
    runtime: 'node' as const,
    environment: 'local-node',
    database: 'sqlite' as const,
    gatewayMode,
    version: '2.0.1'
  };
}
