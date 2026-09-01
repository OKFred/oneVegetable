export type WebGatewayMode = 'mock' | 'bff';

export function readWebGatewayMode(value: string | undefined): WebGatewayMode {
  if (value === undefined || value === '') return 'mock';
  if (value === 'mock' || value === 'bff') return value;
  throw new Error(`Invalid VITE_GATEWAY_MODE: ${value}; only mock or bff is supported.`);
}

export function resolveWebBffBaseUrl(configuredBaseUrl: string | undefined, currentOrigin: string): string {
  const normalizedBaseUrl = configuredBaseUrl?.trim();
  if (normalizedBaseUrl === undefined || normalizedBaseUrl === '') return currentOrigin;
  return normalizedBaseUrl;
}
