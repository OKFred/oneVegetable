import { executeCapabilityCall, type AlibabaClient } from '@one-vegetable/core';
import {
  validateCapabilityRequest,
  validateCapabilityResponse
} from '@one-vegetable/core/capability-validation-worker';

export function executeExtensionCapabilityCall(
  client: Pick<AlibabaClient, 'call'>,
  payload: Record<string, unknown>,
  requestId: string
): Promise<unknown> {
  return executeCapabilityCall(
    client,
    payload,
    { validateCapabilityRequest, validateCapabilityResponse },
    requestId
  );
}
