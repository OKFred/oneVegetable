import * as standalone from './generated/validators-gateway-credentials';
import type { components } from './generated/api';

export function validateGatewayCredentialSummary(
  value: unknown
): value is components['schemas']['GatewayCredentialSummary'] {
  return standalone.validateGatewayCredentialSummary(value);
}
export function validateGatewayCredentialTestResult(
  value: unknown
): value is components['schemas']['GatewayCredentialTestResult'] {
  return standalone.validateGatewayCredentialTestResult(value);
}
export function validateManualGatewayCredentialInput(
  value: unknown
): value is components['schemas']['ManualGatewayCredentialInput'] {
  return standalone.validateManualGatewayCredentialInput(value);
}
export function validateGatewayCredentialSaveRequest(
  value: unknown
): value is components['schemas']['GatewayCredentialSaveRequest'] {
  return standalone.validateGatewayCredentialSaveRequest(value);
}
