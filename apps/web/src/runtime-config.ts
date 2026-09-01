export type WebGatewayMode = 'mock' | 'bff';

export function readWebGatewayMode(value: string | undefined): WebGatewayMode {
  if (value === undefined || value === '') return 'mock';
  if (value === 'mock' || value === 'bff') return value;
  throw new Error(`VITE_GATEWAY_MODE 无效：${value}；仅允许 mock 或 bff`);
}

export function resolveWebBffBaseUrl(configuredBaseUrl: string | undefined, currentOrigin: string): string {
  const normalizedBaseUrl = configuredBaseUrl?.trim();
  if (normalizedBaseUrl === undefined || normalizedBaseUrl === '') return currentOrigin;
  return normalizedBaseUrl;
}
