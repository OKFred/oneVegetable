import { describe, expect, it } from 'vitest';

import { findCapabilityWithAccountVerification, type ApiCapability } from '@one-vegetable/core';

import { capabilityCallBlock, capabilityMatrix } from '../src/lib/capability-matrix';
import { resolveDataSource } from '../src/lib/data-source';

describe('capabilityMatrix', () => {
  it('separates typed contract, replay coverage, account snapshot and current source', () => {
    const capability = requiredCapability('alibaba.icbu.product.list');
    const matrix = capabilityMatrix(capability, resolveDataSource('mock'));

    expect(matrix.contract.label).toBe('已类型化');
    expect(matrix.documentation.label).toBe('已有文档');
    expect(matrix.replay.label).toBe('Replay 候选');
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

  it('allows explicit mock examples but keeps business restrictions blocked', () => {
    const base = requiredCapability('alibaba.icbu.quotation.post');
    expect(capabilityMatrix(base, resolveDataSource('mock')).current.label).toBe('Mock 数据');
    expect(capabilityCallBlock(base, resolveDataSource('mock'))).toBeNull();

    const restricted: ApiCapability = {
      ...base,
      restricted: true,
      restrictionReason: '需要专用业务上下文'
    };
    const matrix = capabilityMatrix(restricted, resolveDataSource('mock'));
    expect(matrix.current.label).toBe('能力受限');
    expect(matrix.current.detail).toBe('需要专用业务上下文');
  });

  const gates: { overrides: Partial<ApiCapability>; label: string }[] = [
    { overrides: { realCallEnabled: false, risk: 'read' }, label: '真实关闭' },
    { overrides: { realCallEnabled: false, risk: 'mutation' }, label: '写入关闭' },
    { overrides: { restricted: true }, label: '能力受限' },
    { overrides: { risk: 'mutation', realCallEnabled: true }, label: '写入关闭' },
    { overrides: { jushitaOnly: true }, label: '能力受限' },
    { overrides: { enabled: false }, label: '调用关闭' },
    { overrides: { requestSchema: null }, label: '契约不完整' }
  ];
  it('keeps disabled restricted contracts typed and gives the specific permission reason', () => {
    const capability: ApiCapability = {
      ...requiredCapability('alibaba.icbu.product.list'),
      enabled: false,
      restricted: true,
      restrictionReason: 'Requires seller group and approved business qualification'
    };
    const matrix = capabilityMatrix(capability, resolveDataSource('extension'));
    expect(matrix.contract.label).toBe('已类型化');
    expect(matrix.current.label).toBe('能力受限');
    expect(matrix.current.detail).toBe(capability.restrictionReason);
  });
  for (const mode of ['bff', 'extension'] as const) {
    it.each(['deprecated', 'unlisted'] as const)(
      `${mode} treats %s as advisory for retained reads`,
      (lifecycle) => {
        const capability = { ...requiredCapability('alibaba.icbu.product.list'), lifecycle };
        const source = resolveDataSource(mode, { metaStatus: 'ready', backendMeta: backendMeta('real') });
        expect(capabilityCallBlock(capability, source)).toBeNull();
      }
    );
    it.each(gates)(`${mode} shares the $label call and presentation gate`, ({ overrides, label }) => {
      const capability = { ...requiredCapability('alibaba.icbu.product.list'), ...overrides };
      const source = resolveDataSource(mode, { metaStatus: 'ready', backendMeta: backendMeta('real') });
      const block = capabilityCallBlock(capability, source);
      expect(block?.label).toBe(label);
      expect(capabilityMatrix(capability, source).current).toEqual(block);
    });
  }

  it.each(['loading', 'error'] as const)('fails closed while BFF metadata is %s', (metaStatus) => {
    const capability = requiredCapability('alibaba.icbu.product.list');
    const source = resolveDataSource('bff', { metaStatus, backendMeta: null });
    expect(capabilityCallBlock(capability, source)).not.toBeNull();
    expect(capabilityMatrix(capability, source).current.label).not.toBe('Mock 数据');
  });

  it('allows a BFF mock example without opening the same capability in replay', () => {
    const capability = { ...requiredCapability('alibaba.icbu.product.list'), realCallEnabled: false };
    const source = (gatewayMode: 'mock' | 'replay') =>
      resolveDataSource('bff', { metaStatus: 'ready', backendMeta: { ...backendMeta('real'), gatewayMode } });
    expect(capabilityCallBlock(capability, source('mock'))).toBeNull();
    expect(capabilityCallBlock(capability, source('replay'))?.label).toBe('真实关闭');
    expect(
      capabilityCallBlock({ ...capability, realCallEnabled: true, risk: 'mutation' }, source('replay'))?.label
    ).toBe('Replay 只读');
  });

  it('does not turn a catalog verification tag into an account or environment result', () => {
    const capability: ApiCapability = {
      ...requiredCapability('alibaba.icbu.product.list'),
      verification: 'account-verified',
      accountVerificationStatus: 'not-tested'
    };
    const matrix = capabilityMatrix(capability, resolveDataSource('extension'));
    expect(matrix.documentation.label).toBe('有验证记录');
    expect(matrix.account.label).toBe('未测试');
    expect(matrix.current.label).toBe('扩展入口开放');
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
