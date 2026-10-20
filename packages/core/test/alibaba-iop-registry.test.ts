import { describe, expect, it } from 'vitest';
import { OPERATION_IDS } from '../src/operation-id';
import {
  getIopMethod,
  getIopOperationSupport,
  iopRegisteredOperationReason,
  listIopOperationCoverage
} from '../src/alibaba-iop-registry';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';

describe('shared IOP coverage registry', () => {
  it('provides a conclusion for every current operation without claiming application permissions', () => {
    const coverage = listIopOperationCoverage();
    expect(coverage.map((entry) => entry.operation)).toEqual(OPERATION_IDS);
    expect(new Set(coverage.map((entry) => entry.operation)).size).toBe(OPERATION_IDS.length);
    expect(getIopOperationSupport('listRfqs')).toMatchObject({
      state: 'not-public',
      fallbackProtocol: 'top'
    });
    expect(getIopOperationSupport('getTradeOrderAggregate')).toMatchObject({
      state: 'partial',
      constraints: ['paid-amount-unavailable']
    });
    expect(iopRegisteredOperationReason('getTradeOrderAggregate')).toBeNull();
  });
  it.each(['downloadProductAsset', 'getDiagnostics', 'clearDiagnostics', 'listCapabilities'] as const)(
    'does not require TOP for local operation %s',
    (operation) => {
      expect(getIopOperationSupport(operation)).toMatchObject({ state: 'local', fallbackProtocol: null });
      expect(iopRegisteredOperationReason(operation)).toBeNull();
    }
  );
  it('does not promote public candidate writes before protocol-specific live acceptance', () => {
    expect(getIopMethod('alibaba.icbu.photobank.upload')).toMatchObject({
      risk: 'mutation',
      adapted: false,
      accountVerified: false
    });
    expect(getIopOperationSupport('uploadPhoto')).toMatchObject({
      state: 'unverified-write',
      verification: 'documented'
    });
    expect(iopRegisteredOperationReason('uploadPhoto')).toBe('ALIBABA_IOP_MUTATION_UNVERIFIED');
    expect(getIopOperationSupport('listVideos').state).toBe('not-adapted');
    expect(getIopMethod('toString')).toBeUndefined();
  });
  it('retains historical defaults and chooses only fully verified dependencies before dispatch', () => {
    const pool = { top: true, iop: true, defaultProtocol: 'top', bindingConfirmed: true } as const;
    expect(selectAlibabaOperationProtocol('getProduct', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('getTradeOrderAggregate', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('uploadPhoto', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('listPhotos', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1001' }, pool)).toBe('iop');
  });
});
