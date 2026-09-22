import type { ApiCapability, CapabilityDefinition } from '@one-vegetable/core';

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
  documentation: CapabilityMatrixCell;
  replay: CapabilityMatrixCell;
  account: CapabilityMatrixCell;
  current: CapabilityMatrixCell;
}

export function capabilityMatrix(
  capability: ApiCapability,
  dataSource: DataSourcePresentation,
  definition?: CapabilityDefinition | null
): CapabilityMatrix {
  return {
    contract: contractCell(capability),
    documentation: localizedCell(
      `capabilities.matrix.documentation.${capability.verification === 'account-verified' ? 'accountRecorded' : 'documented'}`,
      'secondary'
    ),
    replay: replayCell(capability),
    account: accountCell(capability),
    current: currentCell(capability, dataSource, definition)
  };
}

function contractCell(capability: ApiCapability): CapabilityMatrixCell {
  if (capability.requestSchema && capability.responseSchema) {
    return localizedCell('capabilities.matrix.contract.typed', 'success');
  }
  if (!capability.enabled) {
    return localizedCell('capabilities.matrix.contract.unavailable', 'outline');
  }
  return localizedCell('capabilities.matrix.contract.incomplete', 'destructive');
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

// Shared by the status matrix and the call action. Only an explicitly resolved
// mock source bypasses real-call gates; metadata never grants permission.
export function capabilityCallBlock(
  capability: ApiCapability,
  dataSource: DataSourcePresentation,
  definition?: CapabilityDefinition | null
): CapabilityMatrixCell | null {
  const restrictionReason = [capability.restrictionReason, definition?.restrictionReason]
    .map((reason) => reason?.trim())
    .find((reason) => Boolean(reason));
  if (capability.restricted || capability.jushitaOnly || definition?.restricted) {
    return cell(
      translateUi('capabilities.matrix.current.restricted.0'),
      restrictionReason ?? translateUi('capabilities.matrix.current.restricted.1'),
      'warning'
    );
  }
  if (!capability.enabled) {
    return cell(
      translateUi('capabilities.matrix.current.unavailable.0'),
      restrictionReason ?? translateUi('capabilities.matrix.current.unavailable.1'),
      'outline'
    );
  }
  if (!capability.requestSchema || !capability.responseSchema) {
    return localizedCell('capabilities.matrix.contract.incomplete', 'destructive');
  }
  if (dataSource.id === 'unavailable') {
    return cell(
      translateUi('capabilities.matrix.current.unavailableGateway'),
      dataSource.description,
      'destructive'
    );
  }
  if (dataSource.id === 'unknown') {
    return cell(translateUi('capabilities.matrix.current.detecting'), dataSource.description, 'outline');
  }
  if (dataSource.id === 'mock') return null;
  // Lifecycle is advisory for retained reads, matching the shared security policy.
  // Real generic-debugger writes remain closed even if a dedicated workflow is enabled.
  if (capability.risk !== 'read' || (definition && definition.risk !== 'read')) {
    return localizedCell(
      dataSource.id === 'replay'
        ? 'capabilities.matrix.current.replayReadOnly'
        : 'capabilities.matrix.current.mutationClosed',
      'warning'
    );
  }
  if (!capability.realCallEnabled || (definition && !definition.realCallEnabled))
    return localizedCell('capabilities.matrix.current.realClosed', 'warning');
  return null;
}

function currentCell(
  capability: ApiCapability,
  dataSource: DataSourcePresentation,
  definition?: CapabilityDefinition | null
): CapabilityMatrixCell {
  const blocked = capabilityCallBlock(capability, dataSource, definition);
  if (blocked) return blocked;

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
