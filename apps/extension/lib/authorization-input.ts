import { GatewayException } from '@one-vegetable/core/errors';
export { isRecord } from '@one-vegetable/core/alibaba-iop';

/** Pure input helpers shared by readers and controllers, without runtime registration. */
export function parseCallback(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw failure('CALLBACK_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.hostname === 'localhost' ||
    /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname) ||
    url.hostname.includes(':')
  )
    throw failure('CALLBACK_INVALID');
  return url;
}
export function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw failure('AUTH_INPUT_INVALID');
  return value.trim();
}
export function failure(code: string): GatewayException {
  return new GatewayException({ code, message: code, retryable: false });
}
