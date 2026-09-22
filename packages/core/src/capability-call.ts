import { authorizeCapabilityCall } from './capability-policy';
import { GatewayException } from './errors';
import type { AlibabaClient } from './alibaba-client';
import type { CapabilityContractIssue } from './types';

export interface CapabilityCallValidation {
  validateCapabilityRequest(method: string, value: unknown): Promise<CapabilityContractIssue[]>;
  validateCapabilityResponse(method: string, value: unknown): Promise<CapabilityContractIssue[]>;
}

// Restricted to generic debugger output: credential acquisition/refresh keeps raw tokens internally.
export function redactCapabilityResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCapabilityResponse);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /token$|^(?:app[_-]?secret|client[_-]?secret|session|authorization|password)$/i.test(key)
          ? '[redacted]'
          : redactCapabilityResponse(child)
      ])
    );
  }
  // Some TOP APIs return JSON nested inside a string result.
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      const redacted = JSON.stringify(redactCapabilityResponse(parsed));
      return redacted === JSON.stringify(parsed) ? value : redacted;
    } catch {
      return value;
    }
  }
  return value;
}

/** One execution boundary for BFF and MV3, with caller-supplied lazy/static validators. */
export async function executeCapabilityCall(
  client: Pick<AlibabaClient, 'call'>,
  payload: Record<string, unknown>,
  validation: CapabilityCallValidation,
  fallbackTraceId?: string
): Promise<unknown> {
  const decision = authorizeCapabilityCall(payload);
  if (!decision.allowed) {
    throw new GatewayException({ code: decision.reasonCode, message: decision.reasonCode, retryable: false });
  }
  const method = payload.method as string;
  const parameters = payload.parameters as Record<string, unknown>;
  const issues = await validation.validateCapabilityRequest(method, parameters);
  if (issues.length > 0) {
    throw new GatewayException({
      code: 'REQUEST_CONTRACT_INVALID',
      message: issues.map((issue) => `${issue.instancePath} ${issue.message}`).join('；'),
      retryable: false
    });
  }
  const call = await client.call(method, parameters);
  const raw = asRecord(call.data);
  const wrapper = `${method.replaceAll('.', '_')}_response`;
  const data = Object.hasOwn(raw, wrapper) ? raw[wrapper] : call.data;
  // Only remove the TOP root, never nested result/value/typed-array wrappers.
  // contractValid means shape only, not business success: preserve explicit failure flags/errors.
  // Validate raw provider data first; redaction must not disguise contract drift.
  const contractIssues = await validation.validateCapabilityResponse(method, data);
  return {
    method,
    traceId: traceId(raw) ?? traceId(asRecord(data)) ?? fallbackTraceId ?? crypto.randomUUID(),
    data: redactCapabilityResponse(data),
    contractValid: contractIssues.length === 0,
    contractIssues
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function traceId(record: Record<string, unknown>): string | undefined {
  for (const key of ['request_id', 'trace_id']) {
    if (Object.hasOwn(record, key) && typeof record[key] === 'string') return record[key];
  }
  return undefined;
}
