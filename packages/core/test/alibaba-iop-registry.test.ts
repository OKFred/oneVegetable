import { describe, expect, it } from 'vitest';
import { OPERATION_IDS } from '../src/operation-id';
import {
  getIopMethod,
  getIopOperationSupport,
  iopRegisteredOperationReason,
  listIopOperationCoverage,
  IOP_METHODS
} from '../src/alibaba-iop-registry';
import report from '../../../docs/alibaba-iop-feature-coverage.json';
import { selectAlibabaOperationProtocol } from '../src/alibaba-protocol-routing';

describe('shared IOP coverage registry', () => {
  it('keeps the checked-in coverage report synchronized with the shared registry', () => {
    expect(report.methods).toEqual(IOP_METHODS);
    expect(report.operations).toEqual(listIopOperationCoverage());
  });
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
    expect(getIopMethod('alibaba.icbu.product.inventory.update')).toMatchObject({
      adapted: true,
      accountVerified: true,
      risk: 'mutation'
    });
    expect(getIopMethod('alibaba.icbu.photobank.upload')).toMatchObject({
      risk: 'mutation',
      adapted: true,
      accountVerified: true
    });
    expect(getIopOperationSupport('updateProductDisplay')).toMatchObject({
      state: 'supported',
      verification: 'account-verified'
    });
    expect(iopRegisteredOperationReason('updateProductDisplay')).toBeNull();
    expect(getIopOperationSupport('operatePhotoGroup')).toMatchObject({
      state: 'partial',
      constraints: ['photo-group-delete-unverified']
    });
    expect(getIopOperationSupport('listVideos')).toMatchObject({
      state: 'supported',
      verification: 'documented'
    });
    expect(getIopMethod('toString')).toBeUndefined();
  });
  it('retains historical defaults and chooses only fully verified dependencies before dispatch', () => {
    const pool = { top: true, iop: true, defaultProtocol: 'top', bindingConfirmed: true } as const;
    expect(selectAlibabaOperationProtocol('getProduct', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('getTradeOrderAggregate', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('uploadPhoto', {}, pool)).toBe('iop');
    expect(selectAlibabaOperationProtocol('operatePhotoGroup', { operation: 'add' }, pool)).toBe('iop');
    expect(selectAlibabaOperationProtocol('operatePhotoGroup', { operation: 'delete' }, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('listPhotoGroups', { parentId: '1001' }, pool)).toBe('iop');
    expect(selectAlibabaOperationProtocol('listPhotos', {}, pool)).toBe('top');
    expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1001' }, pool)).toBe('top');
    expect(getIopOperationSupport('listPhotos')).toMatchObject({
      state: 'partial',
      verification: 'documented',
      constraints: ['photo-group-required', 'photo-group-scope-unverified']
    });
    expect(selectAlibabaOperationProtocol('listPhotos', { groupId: '1001' }, { ...pool, top: false })).toBe(
      'iop'
    );
  });
  it('checks the exact generic-call suboperation before choosing a protocol', () => {
    const pool = { top: true, iop: true, defaultProtocol: 'top', bindingConfirmed: true } as const;
    const input = (operation: string) => ({
      method: 'alibaba.icbu.photobank.group.operate',
      parameters: { photo_group_operation_request: { operation, group_id: 1001, group_name: 'fixture' } }
    });
    expect(selectAlibabaOperationProtocol('callCapability', input('add'), pool)).toBe('iop');
    expect(selectAlibabaOperationProtocol('callCapability', input('rename'), pool)).toBe('iop');
    expect(selectAlibabaOperationProtocol('callCapability', input('delete'), pool)).toBe('top');
  });
});
