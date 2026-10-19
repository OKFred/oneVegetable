import type { ExtensionAlibabaCredentialAcquisitionRepository } from '@one-vegetable/core';

/** Call directly from the choice click; do not await a vault or metadata read before requesting permission. */
export function openAlibabaAuthorizationTool(
  repository: ExtensionAlibabaCredentialAcquisitionRepository,
  protocol: 'top' | 'iop'
): Promise<void> | undefined {
  if (repository.openTool) return repository.openTool(protocol);
  if (protocol === 'iop' && repository.openIopTool) return repository.openIopTool();
  return undefined;
}
