import { sanitizeDiagnosticMessage } from '@one-vegetable/core/diagnostics';
import { GatewayConfigurationError } from './credentials';

/** Read only documented error fields; never expose a token response or nested cause. */
export function tokenRefreshFailure(
  status: number,
  value: unknown,
  secrets: readonly string[]
): GatewayConfigurationError {
  const root = record(value);
  const source = record(root?.error_response) ?? root;
  const code = safeIdentifier(
    source?.sub_code ?? source?.error_code ?? source?.error ?? source?.code,
    secrets,
    128
  );
  const traceId = safeIdentifier(source?.trace_id ?? source?.request_id ?? root?.request_id, secrets, 128);
  const description = [
    source?.error_description,
    source?.error_msg,
    source?.sub_msg,
    source?.msg,
    source?.message
  ].find((candidate) => typeof candidate === 'string' && candidate.trim());
  const message = typeof description === 'string' ? redact(description, secrets) : '';
  const detail = [code, message].filter(Boolean).join(' — ');
  return new GatewayConfigurationError(
    code === 'param-refresh.token.expired' ? 'ALIBABA_REFRESH_TOKEN_EXPIRED' : 'ALIBABA_TOKEN_REFRESH_FAILED',
    `Alibaba Token 刷新失败（HTTP ${status}）${detail ? `：${detail}` : '；平台未返回可用的错误说明'}`,
    { ...(code ? { subCode: code } : {}), ...(traceId ? { traceId } : {}) }
  );
}

export function parseTokenBody(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function hasTokenError(value: unknown): boolean {
  const root = record(value);
  return (
    record(root?.error_response) !== null ||
    Boolean(typeof root?.error === 'string' && root.error.trim()) ||
    (typeof root?.error_code === 'string' && Boolean(root.error_code.trim()) && root.error_code !== '0') ||
    (typeof root?.error_code === 'number' && root.error_code !== 0)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeIdentifier(value: unknown, secrets: readonly string[], maximum: number): string | null {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  if (!new RegExp(`^[A-Za-z0-9._:-]{1,${maximum}}$`, 'u').test(text)) return null;
  return secrets.some((secret) => secret && text.includes(secret)) ? null : text;
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets.filter(Boolean).toSorted((left, right) => right.length - left.length)) {
    for (const representation of new Set([secret, encodeURIComponent(secret)])) {
      result = result.replaceAll(representation, '[redacted]');
    }
  }
  return sanitizeDiagnosticMessage(
    result
      .replace(/<[^>]*>/gu, '')
      .replace(/(refresh[_-]?token|client[_-]?secret|password|code)(\s*[:=]\s*)[^\s,;]+/giu, '$1$2[redacted]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted]')
      .replace(/\p{Cc}+/gu, ' ')
  ).trim();
}
