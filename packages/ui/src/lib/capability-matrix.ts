import type { ApiCapability } from '@one-vegetable/core';

import type { DataSourcePresentation } from './data-source';
import { formatDateTime } from './date-time';
import { translateUi } from '../i18n';

export type CapabilityMatrixVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline';

export interface CapabilityMatrixCell {
  label: string;
  detail: string;
  variant: CapabilityMatrixVariant;
}

export interface CapabilityMatrix {
  contract: CapabilityMatrixCell;
  replay: CapabilityMatrixCell;
  account: CapabilityMatrixCell;
  current: CapabilityMatrixCell;
}

export function capabilityMatrix(
  capability: ApiCapability,
  dataSource: DataSourcePresentation
): CapabilityMatrix {
  return {
    contract: contractCell(capability),
    replay: replayCell(capability),
    account: accountCell(capability),
    current: currentCell(capability, dataSource)
  };
}

function contractCell(capability: ApiCapability): CapabilityMatrixCell {
  if (!capability.enabled) {
    return localizedCell('capabilities.matrix.contract.unavailable', 'outline');
  }
  if (!capability.requestSchema || !capability.responseSchema) {
    return localizedCell('capabilities.matrix.contract.incomplete', 'destructive');
  }
  return localizedCell('capabilities.matrix.contract.typed', 'success');
}

function replayCell(capability: ApiCapability): CapabilityMatrixCell {
  const eligible =
    capability.enabled &&
    capability.lifecycle === 'active' &&
    capability.risk === 'read' &&
    capability.realCallEnabled &&
    !capability.restricted;
  return eligible
    ? localizedCell('capabilities.matrix.replay.covered', 'success')
    : localizedCell('capabilities.matrix.replay.ineligible', 'secondary');
}

function accountCell(capability: ApiCapability): CapabilityMatrixCell {
  switch (capability.accountVerificationStatus ?? 'not-tested') {
    case 'passed':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.passed', 'success');
    case 'no-data':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.noData', 'success');
    case 'permission-denied':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.denied', 'warning');
    case 'contract-drift':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.drift', 'destructive');
    case 'provider-error':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.provider', 'destructive');
    case 'skipped-prerequisite':
      return accountLocalizedCell(capability, 'capabilities.matrix.account.prerequisite', 'secondary');
    case 'not-tested':
      return localizedCell('capabilities.matrix.account.notTested', 'outline');
  }
}

function currentCell(capability: ApiCapability, dataSource: DataSourcePresentation): CapabilityMatrixCell {
  if (!capability.enabled) return localizedCell('capabilities.matrix.current.unavailable', 'outline');
  if (capability.restricted) {
    return cell(
      translateUi('capabilities.matrix.current.restricted.0'),
      capability.restrictionReason ?? translateUi('capabilities.matrix.current.restricted.1'),
      'warning'
    );
  }
  if (!capability.realCallEnabled) {
    return capability.risk === 'mutation'
      ? localizedCell('capabilities.matrix.current.mutationClosed', 'warning')
      : localizedCell('capabilities.matrix.current.realClosed', 'warning');
  }

  switch (dataSource.id) {
    case 'mock':
      return cell(translateUi('capabilities.matrix.current.mock'), dataSource.description, 'secondary');
    case 'replay':
      return cell(translateUi('capabilities.matrix.current.replay'), dataSource.description, 'secondary');
    case 'real':
      return localizedCell('capabilities.matrix.current.real', 'success');
    case 'extension':
      return localizedCell('capabilities.matrix.current.extension', 'success');
    case 'unavailable':
      return cell(
        translateUi('capabilities.matrix.current.unavailableGateway'),
        dataSource.description,
        'destructive'
      );
    case 'unknown':
      return cell(translateUi('capabilities.matrix.current.detecting'), dataSource.description, 'outline');
  }
}

function accountDetail(capability: ApiCapability, summary: string): string {
  const parts = [summary];
  if (capability.accountVerificationReasonCode) {
    parts.push(
      translateUi('capabilities.matrix.reasonCode', { code: capability.accountVerificationReasonCode })
    );
  }
  if (capability.accountVerificationCheckedAt) {
    parts.push(
      translateUi('capabilities.matrix.checkedAt', {
        time: formatDateTime(capability.accountVerificationCheckedAt)
      })
    );
  }
  return parts.join(' ');
}

function cell(label: string, detail: string, variant: CapabilityMatrixVariant): CapabilityMatrixCell {
  return { label, detail, variant };
}

function localizedCell(key: string, variant: CapabilityMatrixVariant): CapabilityMatrixCell {
  return cell(translateUi(`${key}.0`), translateUi(`${key}.1`), variant);
}

function accountLocalizedCell(
  capability: ApiCapability,
  key: string,
  variant: CapabilityMatrixVariant
): CapabilityMatrixCell {
  return cell(translateUi(`${key}.0`), accountDetail(capability, translateUi(`${key}.1`)), variant);
}
