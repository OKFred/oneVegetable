import { GatewayException } from './errors';
import { CAPABILITY_AUTH_NONE_METHODS } from './generated/capability-auth';

// Keep this transport dependency free of registry, schema and validator imports.
const AUTH_NONE_METHODS: readonly string[] = CAPABILITY_AUTH_NONE_METHODS;
const TRANSPORT_PARAMETER = /^(?:method|session|app_key|sign|sign_method|format|simplify|timestamp|v)$/;

export function hasAlibabaTransportParameters(parameters: object): boolean {
  return Object.keys(parameters).some((key) => TRANSPORT_PARAMETER.test(key));
}

export function assertAlibabaBusinessParameters(parameters: Readonly<Record<string, unknown>>): void {
  if (hasAlibabaTransportParameters(parameters)) {
    throw new GatewayException({
      code: 'CAPABILITY_TRANSPORT_PARAMETER_FORBIDDEN',
      message: 'Business parameters cannot override Alibaba transport or authentication fields.',
      retryable: false
    });
  }
}

/** Alibaba session only; unknown methods require it, and BFF identity/CSRF remain mandatory. */
export function capabilityRequiresSession(method: string): boolean {
  return !AUTH_NONE_METHODS.includes(method);
}
